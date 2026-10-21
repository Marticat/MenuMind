"""Shared protocol and deliberately limited automatic quality checks."""
from pathlib import Path
from collections import Counter
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parent
ART = ROOT / "artifacts"
DATA = ROOT / "dataset"


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def read_jsonl(path):
    return [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]


def write_jsonl(path, rows):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8")


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def messages(row, strategy="detailed"):
    if strategy == "simple":
        system = 'Write a restaurant menu description in the requested language. Return only JSON: {"description":"..."}.'
    elif strategy == "detailed":
        system = (
            'You write factual restaurant menu descriptions. Return only one JSON object '
            'with exactly one key "description" containing a non-empty string. '
            'Use the language specified in the input (ru: Russian, kk: Kazakh). '
            'Include the dish name, every supplied ingredient and the supplied cooking method. '
            'Copy ingredient names and method literally from the source. '
            'Use only supplied facts; do not invent ingredients, taste, benefits, origin or serving details. '
            'Do not add markdown, emoji or commentary. Stay within maxLength characters. '
            'Use a neutral, concise style for the website channel.'
        )
    else:
        raise ValueError(strategy)
    payload = {key: row[key] for key in ["recipe", "language", "channel", "tone", "maxLength"]}
    return [{"role": "system", "content": system},
            {"role": "user", "content": json.dumps(payload, ensure_ascii=False)}]


def normalized(text):
    return re.sub(r"\s+", " ", text.lower().replace("ё", "е")).strip()


def contains_phrase(text, phrase):
    return bool(re.search(r"(?<!\w)" + re.escape(normalized(phrase)) + r"(?!\w)", normalized(text)))


def score_output(row, raw, lexicon):
    """Lexicon checks are proxies, never a general hallucination or language detector."""
    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        parsed = None
    valid = isinstance(parsed, dict) and set(parsed) == {"description"} and isinstance(parsed.get("description"), str) and bool(parsed["description"].strip())
    description = parsed["description"] if valid else ""
    ingredients = row["recipe"]["ingredients"]
    present = sum(contains_phrase(description, item) for item in ingredients)
    forbidden = [item for item in lexicon[row["language"]]["ingredients"] if item not in ingredients]
    # Facts already in the title are allowed, even if a future input has a partial ingredient list.
    forbidden = [item for item in forbidden if not contains_phrase(row["recipe"]["name"], item)]
    extra_ingredients = [item for item in forbidden if contains_phrase(description, item)]
    wrong_methods = [item for item in lexicon[row["language"]]["methods"]
                     if not contains_phrase(row["recipe"]["method"], item) and contains_phrase(description, item)]
    compliance = valid and len(description) <= row["maxLength"] and not re.search(r"[\U0001F300-\U0001FAFF]", description)
    recall = present / len(ingredients) if ingredients else float(valid)
    method_match = valid and contains_phrase(description, row["recipe"]["method"])
    known_fact_pass = valid and not extra_ingredients and not wrong_methods
    return {
        "json_valid": int(valid), "constraint_pass": int(compliance),
        "ingredient_recall": recall, "method_match": int(method_match),
        "known_fact_pass": int(known_fact_pass),
        "grounded_slot_pass": int(compliance and recall == 1 and method_match and known_fact_pass),
        "description": description, "extra_ingredients": extra_ingredients,
        "wrong_methods": wrong_methods, "characters": len(description),
    }


METRICS = ["json_valid", "constraint_pass", "ingredient_recall", "method_match", "known_fact_pass", "grounded_slot_pass"]


def summarize(rows):
    if not rows:
        raise ValueError("Cannot summarize an empty evaluation set")
    result = {key: sum(row["scores"][key] for row in rows) / len(rows) for key in METRICS}
    result.update(n=len(rows), mean_latency_seconds=sum(r["latency_seconds"] for r in rows) / len(rows))
    return result


def validate_splits(parts):
    names = ["train", "validation", "test"]
    seen_ids, seen_groups, seen_recipes = set(), set(), set()
    for name in names:
        rows = parts[name]
        ids = [r["id"] for r in rows]
        groups = {r["group"] for r in rows}
        recipes = {json.dumps(r["recipe"], ensure_ascii=False, sort_keys=True) for r in rows}
        assert len(ids) == len(set(ids)), f"Duplicate IDs in {name}"
        assert not seen_ids.intersection(ids), "Cross-split ID leakage"
        assert not seen_groups.intersection(groups), "Cross-split dish leakage"
        assert not seen_recipes.intersection(recipes), "Cross-split duplicate recipe"
        assert all(r["split"] == name for r in rows)
        assert all(Counter(r["language"] for r in rows if r["group"] == g) == {"ru": 1, "kk": 1} for g in groups)
        seen_ids.update(ids)
        seen_groups.update(groups)
        seen_recipes.update(recipes)
