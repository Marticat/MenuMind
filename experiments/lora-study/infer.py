"""Use the selected local adapter on one example without changing model weights."""
import argparse
import json
import sys
from pathlib import Path
from transformers import AutoTokenizer
from peft import PeftModel
from common import ROOT, DATA, ART, read_json, read_jsonl
from train import load_base, generate_rows, seed_everything


def main():
    # Windows legacy console encodings cannot represent Kazakh letters.
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--example-id", help="ID in the saved test fixture, e.g. dish-00-03-ru")
    source.add_argument("--input", type=Path, help="One UTF-8 JSON input with recipe, language, channel, tone, maxLength")
    args = parser.parse_args()
    from restore_assets import main as restore_assets
    restore_assets()
    cfg = read_json(ROOT / "config.json")
    selection = read_json(ART / "selection.json")["selected"]
    if args.example_id:
        row = next(r for r in read_jsonl(DATA / "test.jsonl") if r["id"] == args.example_id)
    else:
        row = read_json(args.input)
        row.setdefault("id", "manual")
        row.setdefault("group", "manual")
        row.setdefault("channel", "website")
        row.setdefault("tone", "neutral")
        row.setdefault("maxLength", 250)
    if row["language"] not in ["ru", "kk"]:
        raise ValueError("This study supports ru/kk only")
    if row["channel"] != "website" or row["tone"] != "neutral":
        raise ValueError("This adapter was studied only for website/neutral")
    if not isinstance(row["recipe"]["ingredients"], list):
        raise ValueError("recipe.ingredients must be a list of strings")
    seed_everything(cfg["seed"])
    tokenizer = AutoTokenizer.from_pretrained(cfg["model_id"], revision=cfg["revision"])
    model = PeftModel.from_pretrained(load_base(cfg), ROOT / selection["adapter_dir"])
    result = generate_rows(model, tokenizer, [row], cfg, "detailed", "lora_detailed", read_json(DATA / "lexicon.json"))[0]
    result["requires_human_review"] = True
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
