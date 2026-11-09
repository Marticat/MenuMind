"""Behavioral checks for the final model boundary (no GPU/download required)."""
import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import inference
from common import DATA, ROOT, read_json


def request():
    return {"language": "ru", "recipe": {"name": "Курица с рисом", "ingredients": ["курица", "рис"], "method": "запекание"}}


class InferenceTests(unittest.TestCase):
    def test_normalizes_without_mutating_request(self):
        value = request()
        value["recipe"]["name"] = "  Курица   с рисом  "
        original = copy.deepcopy(value)
        row = inference.validate_input(value)
        self.assertEqual(row["recipe"]["name"], "Курица с рисом")
        self.assertEqual(row["channel"], "website")
        self.assertEqual(row["maxLength"], 250)
        self.assertEqual(value, original)

    def test_rejects_malformed_and_unsupported_inputs(self):
        bad = [None, [], {}, {**request(), "language": "en"},
               {**request(), "maxLength": True}, {**request(), "maxLength": 500},
               {**request(), "channel": "wolt"}, {**request(), "tone": "bistro"}]
        for field, values in {"name": [None, "", 3, "x" * 121], "method": [None, "", []],
                              "ingredients": ["rice", [], [3], [""], ["рис"] * 13]}.items():
            for val in values:
                item = request()
                item["recipe"][field] = val
                bad.append(item)
        for item in bad:
            with self.subTest(item=item), self.assertRaises(ValueError):
                inference.validate_input(item)

    def test_unknown_fields_rejected_to_catch_typos(self):
        item = request()
        item["recipe"]["methods"] = "варка"
        with self.assertRaises(ValueError):
            inference.validate_input(item)

    def test_accepts_kazakh_and_rejects_control_characters(self):
        item = {"language": "kk", "recipe": {"name": "Күріш пен тауық", "ingredients": ["күріш", "тауық"], "method": "пісіру"}}
        self.assertEqual(inference.validate_input(item)["recipe"]["name"], "Күріш пен тауық")
        item["recipe"]["name"] = "a\x00b"
        with self.assertRaises(ValueError):
            inference.validate_input(item)

    def test_invalid_output_is_never_publishable(self):
        row = inference.validate_input(request())
        lexicon = read_json(DATA / "lexicon.json")
        for raw, truncated in [('not json', False), ('{"description":"hello"}', False),
                                ('{"description":"Курица с рисом: курица, рис; запекание."}', True)]:
            result = inference.check_output(row, raw, lexicon, truncated)
            self.assertFalse(result["accepted"])
            self.assertIsNone(result["description"])
            self.assertTrue(result["requires_human_review"])
            self.assertTrue(result["validation_errors"])
        result = inference.check_output(row, '{"description":"Курица с рисом: курица, рис; запекание."}', lexicon, False)
        self.assertTrue(result["accepted"])
        self.assertTrue(result["requires_human_review"])

    def test_manifest_detects_corrupted_asset_and_path_escape(self):
        import hashlib
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "weights.bin").write_bytes(b"original")
            manifest = {"assets": {"weights.bin": hashlib.sha256(b"original").hexdigest()}}
            inference.verify_assets(manifest, root)
            (root / "weights.bin").write_bytes(b"changed")
            with self.assertRaisesRegex(ValueError, "hash"):
                inference.verify_assets(manifest, root)
            with self.assertRaises(ValueError):
                inference.verify_assets({"assets": {"../outside": "0"}}, root)

    def test_supplied_ingredient_case_and_qualifiers_are_not_extra_facts(self):
        for ingredient in ("Рис", "рис басмати"):
            row = inference.validate_input({"language": "ru", "recipe": {"name": "Плов", "ingredients": [ingredient], "method": "Варка"}})
            raw = json.dumps({"description": f"Плов: {ingredient}; Варка."})
            self.assertTrue(inference.check_output(row, raw, read_json(DATA / "lexicon.json"), False)["accepted"])

    def test_missing_title_and_control_characters_are_rejected(self):
        row = inference.validate_input({"language": "ru", "recipe": {"name": "Плов", "ingredients": ["рис"], "method": "варка"}})
        for description, error in [("рис; варка.", "missing_dish_name"), ("Плов: рис; варка.\x00", "control_characters")]:
            result = inference.check_output(row, json.dumps({"description": description}), read_json(DATA / "lexicon.json"), False)
            self.assertFalse(result["accepted"])
            self.assertIn(error, result["validation_errors"])

    def test_cli_invalid_input_returns_json_without_loading_model(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "bad.json"
            path.write_text('{"language":"en"}', encoding="utf-8")
            run = subprocess.run([sys.executable, str(ROOT / "infer.py"), "--input", str(path), "--offline"], capture_output=True, text=True, encoding="utf-8")
            self.assertEqual(run.returncode, 2)
            self.assertEqual(json.loads(run.stdout)["error"]["code"], "invalid_input")
            self.assertNotIn("Loading", run.stderr)


if __name__ == "__main__":
    unittest.main()
