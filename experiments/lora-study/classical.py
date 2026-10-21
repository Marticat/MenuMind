"""Re-run classical comparison on the existing, immutable tag splits."""
import csv
import json
import time
import platform
import importlib.metadata as metadata
import numpy as np
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.multiclass import OneVsRestClassifier
from sklearn.pipeline import Pipeline
from sklearn.metrics import f1_score
from common import ROOT, ART, read_jsonl, write_json, sha256


def metrics(y, pred):
    return {f"{avg}_f1": float(f1_score(y, pred, average=avg, zero_division=0)) for avg in ["micro", "macro"]}


def main():
    source = ROOT.parent / "tags-midterm" / "artifacts" / "data"
    if not source.exists():
        source = ROOT / "classical-data"  # Included in the portable submission ZIP.
    xs, ys, hashes = {}, {}, {}
    for split in ["train", "validation", "test"]:
        x_path, y_path = source / f"X_{split}.jsonl", source / f"y_{split}.csv"
        rows = read_jsonl(x_path)
        target = pd.read_csv(y_path)
        assert [r["source_id"] for r in rows] == target.source_id.tolist()
        xs[split] = [r["title"] + " . " + " . ".join(r["ingredients"]) for r in rows]
        ys[split] = target.drop(columns="source_id").to_numpy()
        hashes[split] = {"X": sha256(x_path), "y": sha256(y_path), "n": len(rows)}
    def fit(c):
        p = Pipeline([("tfidf", TfidfVectorizer(ngram_range=(1, 2), min_df=2, max_features=20000, sublinear_tf=True)),
                      ("classifier", OneVsRestClassifier(LogisticRegression(C=c, solver="liblinear", max_iter=1000, random_state=42)))])
        return p.fit(xs["train"], ys["train"])
    started = time.perf_counter()
    # Explicit default-parameter baseline, declared before this run's test evaluation.
    baseline = fit(1.0)
    candidates, best = [], None
    for c in [0.5, 2.0]:
        model = fit(c)
        prob = model.predict_proba(xs["validation"])
        for threshold in [0.2, 0.35, 0.5]:
            scores = metrics(ys["validation"], prob >= threshold)
            row = {"C": c, "threshold": threshold, **scores}
            candidates.append(row)
            if best is None or scores["micro_f1"] > best["micro_f1"]:
                best = {**row, "model": model}
    selected = {k: v for k, v in best.items() if k != "model"}
    write_json(ART / "classical_selection.json", {"selected_on": "validation micro-F1", "selected": selected, "candidates": candidates, "split_hashes": hashes})
    rows = []
    for name, model, threshold, c in [("classical_default", baseline, 0.5, 1.0), ("classical_tuned", best["model"], best["threshold"], best["C"])]:
        rows.append({"model": name, "C": c, "threshold": threshold, **metrics(ys["test"], model.predict_proba(xs["test"]) >= threshold)})
    frequency = np.tile(ys["train"].mean(axis=0), (len(ys["validation"]), 1))
    ft = max([0.05, 0.1, 0.2, 0.35, 0.5], key=lambda t: metrics(ys["validation"], frequency >= t)["micro_f1"])
    rows.insert(0, {"model": "frequency", "C": None, "threshold": ft,
                    **metrics(ys["test"], np.tile(ys["train"].mean(axis=0), (len(ys["test"]), 1)) >= ft)})
    write_json(ART / "classical_results.json", {
        "seed": 42, "rows": rows, "selection": selected, "search_space": {"C": [0.5, 2.0], "threshold": [0.2, 0.35, 0.5]},
        "split_hashes": hashes, "seconds": time.perf_counter() - started,
        "versions": {p: metadata.version(p) for p in ["numpy", "pandas", "scikit-learn"]},
        "python": platform.python_version(),
        "limitations": "Existing published test reused to add an explicit default baseline; not a newly sealed holdout. EN publisher-tag task, not RU/KK generation.",
    })
    print(json.dumps(rows, indent=2))


if __name__ == "__main__":
    main()
