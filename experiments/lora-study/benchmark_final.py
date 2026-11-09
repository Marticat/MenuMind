"""Measure the final runtime on fresh demos, separately from the frozen test set."""
import argparse
import platform
import statistics
import time
from datetime import datetime, timezone
from common import ROOT, DATA, read_jsonl, write_json, sha256
from inference import FinalModel, read_input


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", choices=["auto", "cpu", "cuda"], default="auto")
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--output", default=str(ROOT / "artifacts/final-benchmark.json"))
    args = parser.parse_args()
    if not 1 <= args.repeats <= 100:
        parser.error("repeats must be between 1 and 100")
    started = time.perf_counter()
    runtime = FinalModel(args.device, args.offline)
    setup_seconds = time.perf_counter() - started
    import torch
    assert not runtime.model.training and not any(p.requires_grad for p in runtime.model.parameters())
    paths = sorted((ROOT / "examples").glob("*.json"))
    examples = [(p, read_input(p)) for p in paths]
    old = [row["recipe"] for part in ("train", "validation", "test") for row in read_jsonl(DATA / f"{part}.jsonl")]
    assert all(row["recipe"] not in old for _, row in examples), "Demo recipe duplicates study input"
    warmup = runtime.predict(examples[0][1])
    if runtime.device == "cuda":
        torch.cuda.reset_peak_memory_stats()
    rows = []
    for repeat in range(args.repeats):
        for path, row in examples:
            result = runtime.predict(row)
            result.update(example=path.name, input_sha256=sha256(path), repeat=repeat + 1)
            rows.append(result)
    latencies = [r["latency_seconds"] for r in rows]
    report = {"recorded_at_utc": datetime.now(timezone.utc).isoformat(), "model": runtime.info(),
              "environment": {"python": platform.python_version(), "torch": torch.__version__,
                              "device_name": torch.cuda.get_device_name(0) if runtime.device == "cuda" else platform.processor()},
              "setup_seconds_including_imports": setup_seconds, "warmup_seconds": warmup["latency_seconds"],
              "warmup_excluded": True, "unique_inputs": len(examples), "requests": len(rows),
              "accepted_requests": sum(r["accepted"] for r in rows),
              "mean_seconds": statistics.mean(latencies), "median_seconds": statistics.median(latencies),
              "min_seconds": min(latencies), "max_seconds": max(latencies),
              "peak_cuda_allocated_bytes": torch.cuda.max_memory_allocated() if runtime.device == "cuda" else None,
              "scope": "Sequential local demo, three authored inputs, repeated for timing; not a new quality benchmark or load test. Human review pending.",
              "results": rows}
    write_json(args.output, report)
    print(f"Saved {args.output}; {len(rows)} requests, median {report['median_seconds']:.3f}s, accepted {report['accepted_requests']}")


if __name__ == "__main__":
    main()
