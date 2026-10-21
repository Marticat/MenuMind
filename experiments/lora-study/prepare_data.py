"""Generate an authored synthetic protocol dataset, NOT customer or human-reviewed data."""
import random
from common import ROOT, DATA, read_json, write_json, write_jsonl, sha256, validate_splits, score_output

# Bilingual vocabulary authored for this experiment; Kazakh requires human review.
MAINS = [
    ("Курица", "Тауық еті"), ("Говядина", "Сиыр еті"), ("Баранина", "Қой еті"),
    ("Индейка", "Күркетауық еті"), ("Лосось", "Албырт"), ("Треска", "Нәлім"),
    ("Шампиньоны", "Қозықұйрық"), ("Тофу", "Тофу"), ("Фасоль", "Үрме бұршақ"),
    ("Нут", "Ноқат"), ("Чечевица", "Жасымық"), ("Картофель", "Картоп"),
]
SIDES = [
    ("рис", "күріш"), ("гречка", "қарақұмық"), ("морковь", "сәбіз"),
    ("кабачок", "кәді"), ("тыква", "асқабақ"), ("брокколи", "брокколи"),
    ("цветная капуста", "гүлді қырыққабат"), ("помидоры", "қызанақ"),
    ("сладкий перец", "тәтті бұрыш"), ("баклажан", "баялды"),
]
METHODS = [("Варка", "Қайнату"), ("Тушение", "Бұқтыру"),
           ("Запекание", "Пісіру"), ("Приготовление на пару", "Буға пісіру")]


def main():
    cfg = read_json(ROOT / "config.json")
    groups = [f"dish-{i:02d}-{j:02d}" for i in range(len(MAINS)) for j in range(len(SIDES))]
    random.Random(cfg["seed"]).shuffle(groups)
    split_for = {g: ("train" if n < 84 else "validation" if n < 102 else "test") for n, g in enumerate(groups)}
    lexicon = {lang: {"ingredients": [a[k].lower() for a in MAINS + SIDES], "methods": [a[k] for a in METHODS]} for k, lang in enumerate(["ru", "kk"])}
    parts = {s: [] for s in ["train", "validation", "test"]}
    for i, main_item in enumerate(MAINS):
        for j, side in enumerate(SIDES):
            group = f"dish-{i:02d}-{j:02d}"
            method = METHODS[(i + j) % len(METHODS)]
            for k, lang in enumerate(["ru", "kk"]):
                name = f"{main_item[k]} {'и' if lang == 'ru' else 'және'} {side[k]}"
                ingredients = [main_item[k].lower(), side[k]]
                # The literal construction keeps provenance inspectable; it is not human gold.
                desc = (f"{name}. Состав: {', '.join(ingredients)}. Способ приготовления: {method[k]}." if lang == "ru" else
                        f"{name}. Құрамы: {', '.join(ingredients)}. Дайындау тәсілі: {method[k]}.")
                row = {"id": f"{group}-{lang}", "group": group, "split": split_for[group],
                       "language": lang, "channel": "website", "tone": "neutral", "maxLength": 250,
                       "recipe": {"name": name, "ingredients": ingredients, "method": method[k]},
                       "target": {"description": desc},
                       "provenance": "authored_synthetic_composition_and_deterministic_target_v1",
                       "human_reviewed": False}
                import json
                assert score_output(row, json.dumps(row["target"], ensure_ascii=False), lexicon)["grounded_slot_pass"] == 1
                parts[row["split"]].append(row)
    validate_splits(parts)
    for name, rows in parts.items():
        write_jsonl(DATA / f"{name}.jsonl", rows)
    write_json(DATA / "lexicon.json", lexicon)
    write_json(DATA / "manifest.json", {
        "seed": cfg["seed"], "split_unit": "ingredient-pair dish; both languages stay together",
        "counts": {name: {"rows": len(rows), "dishes": len(rows) // 2} for name, rows in parts.items()},
        "sha256": {name: sha256(DATA / f"{name}.jsonl") for name in parts},
        "lexicon_sha256": sha256(DATA / "lexicon.json"),
        "source": "New authored synthetic teaching dataset, no API calls, no human annotations",
        "limitations": ["Shared vocabulary and target template across splits", "Held-out combinations, not unseen domains",
                        "No naturalness, native Kazakh, customer, safety or conversion claims", "Only one channel and neutral tone"],
        "human_review_completed": False,
    })
    print({name: len(rows) for name, rows in parts.items()})


if __name__ == "__main__":
    main()
