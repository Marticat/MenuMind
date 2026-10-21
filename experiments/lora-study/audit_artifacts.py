"""Recompute scores from raw generations and check saved study provenance, offline."""
import math
from common import ROOT, DATA, ART, METRICS, read_json, read_jsonl, score_output, summarize, sha256, validate_splits, write_json


def main():
    parts = {s: read_jsonl(DATA / f"{s}.jsonl") for s in ["train", "validation", "test"]}
    validate_splits(parts)
    manifest = read_json(DATA / "manifest.json")
    for name in parts:
        assert sha256(DATA / f"{name}.jsonl") == manifest["sha256"][name]
    assert sha256(DATA / "lexicon.json") == manifest["lexicon_sha256"]
    freeze = read_json(ART / "freeze.json")
    assert freeze["config_sha256"] == sha256(ROOT / "config.json")
    for name, digest in freeze["source_sha256"].items():
        assert sha256(ROOT / name) == digest, f"Frozen source modified: {name}"
    assert freeze["dataset"] == manifest
    selection = read_json(ART / "selection.json")
    chosen = selection["selected"]
    assert chosen["validation_response_token_nll"] == min(t["validation_response_token_nll"] for t in selection["trials"])
    assert chosen["adapter_weight_delta_l2"] > 0
    for trial in selection["trials"]:
        assert math.isfinite(trial["validation_response_token_nll"])
        assert trial["trainable_parameters"] < trial["total_parameters"]
        adapter = ROOT / trial["adapter_dir"] / "adapter_model.safetensors"
        if adapter.exists():
            assert sha256(adapter) == trial["adapter_sha256"]
    lexicon = read_json(DATA / "lexicon.json")
    expected = {r["id"]: r for r in parts["test"]}
    stored = read_json(ART / "llm_results.json")
    checked = 0
    for model in ["base_simple", "base_detailed", "lora_detailed"]:
        rows = read_jsonl(ART / f"predictions-{model}.jsonl")
        assert [r["id"] for r in rows] == list(expected)
        for row in rows:
            assert row["scores"] == score_output(expected[row["id"]], row["raw_output"], lexicon)
            checked += 1
        for language in ["all", "ru", "kk"]:
            calculated = summarize(rows if language == "all" else [r for r in rows if r["language"] == language])
            original = next(r for r in stored["rows"] if r["model"] == model and r["language"] == language)
            for key in METRICS + ["n", "mean_latency_seconds"]:
                assert abs(original[key] - calculated[key]) < 1e-12
    assert stored["human_review_completed"] is False
    classical = read_json(ART / "classical_results.json")
    source = ROOT.parent / "tags-midterm" / "artifacts" / "data"
    if not source.exists():
        source = ROOT / "classical-data"
    for split, hashes in classical["split_hashes"].items():
        assert sha256(source / f"X_{split}.jsonl") == hashes["X"]
        assert sha256(source / f"y_{split}.csv") == hashes["y"]
    result = {"passed": True, "raw_generations_recomputed": checked, "split_leakage_checked": True,
              "frozen_source_hashes_checked": True, "selection_uses_validation": True,
              "human_review_completed": False}
    write_json(ART / "verification.json", result)
    print(result)


if __name__ == "__main__":
    main()
