"""Regression checks for leakage and misleading metric behavior."""
import copy
import json
import unittest
from common import DATA, read_json, read_jsonl, score_output, validate_splits


class ProtocolTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.parts = {s: read_jsonl(DATA / f"{s}.jsonl") for s in ["train", "validation", "test"]}
        cls.lexicon = read_json(DATA / "lexicon.json")

    def test_all_reference_targets_satisfy_declared_contract(self):
        validate_splits(self.parts)
        for rows in self.parts.values():
            for row in rows:
                result = score_output(row, json.dumps(row["target"], ensure_ascii=False), self.lexicon)
                self.assertEqual(result["grounded_slot_pass"], 1, row["id"])

    def test_group_leakage_rejected(self):
        parts = copy.deepcopy(self.parts)
        parts["test"][0]["group"] = parts["train"][0]["group"]
        with self.assertRaises(AssertionError):
            validate_splits(parts)

    def test_json_scalar_empty_and_wrappers_rejected(self):
        row = self.parts["train"][0]
        for raw in ['null', '[]', '"text"', '{}', '{"description":""}', '{"description":"ok","extra":1}', '```json\n{"description":"x"}\n```']:
            result = score_output(row, raw, self.lexicon)
            self.assertEqual(result["json_valid"], 0)
            self.assertEqual(result["known_fact_pass"], 0)
            self.assertEqual(result["grounded_slot_pass"], 0)

    def test_detects_known_extra_ingredient(self):
        row = self.parts["train"][0]
        extra = next(x for x in self.lexicon[row["language"]]["ingredients"] if x not in row["recipe"]["ingredients"])
        raw = json.dumps({"description": row["target"]["description"] + " " + extra}, ensure_ascii=False)
        result = score_output(row, raw, self.lexicon)
        self.assertIn(extra, result["extra_ingredients"])
        self.assertEqual(result["known_fact_pass"], 0)

    def test_valid_json_is_not_fact_or_completeness_evidence(self):
        row = self.parts["train"][0]
        result = score_output(row, '{"description":"x"}', self.lexicon)
        self.assertEqual(result["json_valid"], 1)
        self.assertEqual(result["ingredient_recall"], 0)
        self.assertEqual(result["grounded_slot_pass"], 0)

    def test_excess_length_rejected(self):
        row = self.parts["train"][0]
        result = score_output(row, json.dumps({"description": "x" * (row["maxLength"] + 1)}), self.lexicon)
        self.assertEqual(result["constraint_pass"], 0)


if __name__ == "__main__":
    unittest.main()
