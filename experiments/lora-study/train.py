"""Real LoRA training and held-out evaluation. No paid API calls or fabricated scores."""
import os
os.environ.setdefault("CUBLAS_WORKSPACE_CONFIG", ":4096:8")
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
import argparse
import csv
import gc
import json
import math
import platform
import random
import subprocess
import sys
import time
from contextlib import nullcontext
import numpy as np
import torch
from torch.utils.data import Dataset, DataLoader
from transformers import AutoTokenizer, AutoModelForCausalLM, set_seed
from peft import LoraConfig, get_peft_model, PeftModel
from huggingface_hub import model_info
from common import ROOT, ART, DATA, METRICS, read_json, read_jsonl, write_json, write_jsonl, sha256, messages, score_output, summarize, validate_splits


class ResponseDataset(Dataset):
    def __init__(self, rows, tokenizer, maximum, strategy="detailed"):
        self.items = []
        for row in rows:
            prefix = tokenizer.apply_chat_template(messages(row, strategy), tokenize=True, add_generation_prompt=True)
            answer = tokenizer.encode(json.dumps(row["target"], ensure_ascii=False), add_special_tokens=False) + [tokenizer.eos_token_id]
            ids = prefix + answer
            if len(ids) > maximum:
                raise ValueError(f"Sequence {row['id']} has {len(ids)} tokens > {maximum}; no silent truncation")
            self.items.append({"input_ids": ids, "labels": [-100] * len(prefix) + answer})
    def __len__(self):
        return len(self.items)
    def __getitem__(self, index):
        return self.items[index]


def collator(tokenizer):
    def collate(items):
        width = max(len(item["input_ids"]) for item in items)
        return {
            "input_ids": torch.tensor([x["input_ids"] + [tokenizer.pad_token_id] * (width - len(x["input_ids"])) for x in items]),
            "attention_mask": torch.tensor([[1] * len(x["input_ids"]) + [0] * (width - len(x["input_ids"])) for x in items]),
            "labels": torch.tensor([x["labels"] + [-100] * (width - len(x["labels"])) for x in items]),
        }
    return collate


def seed_everything(seed):
    set_seed(seed)
    torch.use_deterministic_algorithms(True, warn_only=True)
    torch.backends.cudnn.benchmark = False
    torch.backends.cuda.matmul.allow_tf32 = False


def amp_context():
    return torch.autocast("cuda", dtype=torch.bfloat16) if torch.cuda.is_available() and torch.cuda.is_bf16_supported() else nullcontext()


def load_base(cfg):
    return AutoModelForCausalLM.from_pretrained(
        cfg["model_id"], revision=cfg["revision"], torch_dtype=torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float32,
        attn_implementation="sdpa", use_safetensors=True,
    ).to("cuda")


@torch.no_grad()
def response_nll(model, loader):
    model.eval()
    total, count = 0.0, 0
    for batch in loader:
        batch = {key: value.to(model.device) for key, value in batch.items()}
        tokens = int((batch["labels"][:, 1:] != -100).sum())
        with amp_context():
            loss = model(**batch).loss
        total += float(loss) * tokens
        count += tokens
    return total / count


def train_trial(cfg, lr, tokenizer, train_data, val_loader):
    seed_everything(cfg["seed"])
    model = load_base(cfg)
    model.config.use_cache = False
    model = get_peft_model(model, LoraConfig(
        task_type="CAUSAL_LM", r=cfg["lora_rank"], lora_alpha=cfg["lora_alpha"],
        lora_dropout=cfg["lora_dropout"], target_modules=cfg["target_modules"], bias="none",
    ))
    model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
    model.enable_input_require_grads()
    trainable, total = model.get_nb_trainable_parameters()
    trainable_names = [name for name, param in model.named_parameters() if param.requires_grad]
    assert trainable_names and all("lora_" in name for name in trainable_names)
    print(f"LoRA lr={lr}: {trainable:,}/{total:,} trainable parameters", flush=True)
    initial = {name: param.detach().float().cpu().clone() for name, param in model.named_parameters() if param.requires_grad}
    loader = DataLoader(train_data, batch_size=cfg["batch_size"], shuffle=True,
                        generator=torch.Generator().manual_seed(cfg["seed"]), collate_fn=collator(tokenizer), num_workers=0)
    optimizer = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=lr, weight_decay=cfg["weight_decay"])
    logs = []
    started = time.perf_counter()
    torch.cuda.reset_peak_memory_stats()
    accumulation = cfg["gradient_accumulation_steps"]
    optimizer_steps = 0
    for epoch in range(1, cfg["epochs"] + 1):
        model.train()
        optimizer.zero_grad(set_to_none=True)
        loss_sum, token_sum = 0.0, 0
        for step, batch in enumerate(loader):
            batch = {key: value.to(model.device) for key, value in batch.items()}
            # Correct normalization for a possibly short final accumulation window.
            window_size = min(accumulation, len(loader) - (step // accumulation) * accumulation)
            with amp_context():
                loss = model(**batch).loss
            if not torch.isfinite(loss):
                raise RuntimeError("Non-finite training loss")
            (loss / window_size).backward()
            tokens = int((batch["labels"][:, 1:] != -100).sum())
            loss_sum += float(loss.detach()) * tokens
            token_sum += tokens
            if (step + 1) % accumulation == 0 or step + 1 == len(loader):
                torch.nn.utils.clip_grad_norm_(model.parameters(), cfg["max_grad_norm"])
                optimizer.step()
                optimizer.zero_grad(set_to_none=True)
                optimizer_steps += 1
            if (step + 1) % 20 == 0:
                print(f"lr={lr} epoch={epoch} batch={step+1}/{len(loader)} nll={loss_sum/token_sum:.4f}", flush=True)
        val_nll = response_nll(model, val_loader)
        logs.append({"epoch": epoch, "train_response_token_nll": loss_sum / token_sum, "validation_response_token_nll": val_nll})
        print(f"lr={lr} epoch={epoch} validation NLL={val_nll:.5f}", flush=True)
    delta = sum(float((param.detach().float().cpu() - initial[name]).square().sum()) for name, param in model.named_parameters() if name in initial) ** 0.5
    assert delta > 0, "No adapter weight updates occurred"
    adapter_dir = ART / "adapters" / f"lr-{lr:g}"
    model.save_pretrained(adapter_dir, safe_serialization=True)
    tokenizer.save_pretrained(adapter_dir)
    result = {"learning_rate": lr, "validation_response_token_nll": logs[-1]["validation_response_token_nll"],
              "epochs": cfg["epochs"], "optimizer_steps": optimizer_steps, "logs": logs,
              "trainable_parameters": trainable, "total_parameters": total, "trainable_percent": 100 * trainable / total,
              "trainable_parameter_names": trainable_names, "adapter_weight_delta_l2": delta,
              "adapter_dir": str(adapter_dir.relative_to(ROOT)).replace("\\", "/"),
              "adapter_sha256": sha256(adapter_dir / "adapter_model.safetensors"),
              "seconds": time.perf_counter() - started, "peak_cuda_allocated_bytes": torch.cuda.max_memory_allocated()}
    write_json(ART / f"trial-{lr:g}.json", result)
    del model, optimizer, initial
    gc.collect()
    torch.cuda.empty_cache()
    return result


@torch.no_grad()
def generate_rows(model, tokenizer, rows, cfg, strategy, name, lexicon):
    model.eval()
    model.config.use_cache = True
    model.gradient_checkpointing_disable()
    results = []
    for idx, row in enumerate(rows):
        prompt = tokenizer.apply_chat_template(messages(row, strategy), tokenize=False, add_generation_prompt=True)
        inputs = tokenizer(prompt, return_tensors="pt", add_special_tokens=False).to(model.device)
        torch.cuda.synchronize()
        started = time.perf_counter()
        out = model.generate(**inputs, max_new_tokens=cfg["max_new_tokens"], do_sample=False, num_beams=1,
                             pad_token_id=tokenizer.pad_token_id, eos_token_id=tokenizer.eos_token_id)
        torch.cuda.synchronize()
        elapsed = time.perf_counter() - started
        generated = out[0, inputs.input_ids.shape[1]:].tolist()
        raw = tokenizer.decode(generated, skip_special_tokens=True)
        results.append({"id": row["id"], "group": row["group"], "language": row["language"], "model": name,
                        "strategy": strategy, "prompt": prompt, "raw_output": raw,
                        "generated_tokens": len(generated), "reached_token_limit": len(generated) >= cfg["max_new_tokens"] and generated[-1] != tokenizer.eos_token_id,
                        "latency_seconds": elapsed, "scores": score_output(row, raw, lexicon)})
        if (idx + 1) % 6 == 0:
            print(f"{name}: {idx+1}/{len(rows)} generated", flush=True)
    return results


def grouped_bootstrap(baseline, improved, metric, seed):
    assert [r["id"] for r in baseline] == [r["id"] for r in improved]
    groups = sorted({r["group"] for r in baseline})
    deltas = np.array([np.mean([b["scores"][metric] - a["scores"][metric] for a, b in zip(baseline, improved) if a["group"] == g]) for g in groups])
    rng = np.random.default_rng(seed)
    samples = rng.choice(deltas, size=(2000, len(deltas)), replace=True).mean(axis=1)
    return {"metric": metric, "delta": float(deltas.mean()), "ci95": np.quantile(samples, [0.025, 0.975]).tolist(), "resampling_unit": "dish (RU/KK paired)", "replicates": 2000}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--evaluate-only", action="store_true", help="Evaluate selected saved adapter; does not retrain")
    args = parser.parse_args()
    cfg = read_json(ROOT / "config.json")
    if not torch.cuda.is_available():
        raise RuntimeError("This reproducible training configuration requires a CUDA GPU; install CUDA PyTorch first")
    torch.set_num_threads(4)
    seed_everything(cfg["seed"])
    ART.mkdir(parents=True, exist_ok=True)
    if cfg["revision"] is None:
        cfg["revision"] = model_info(cfg["model_id"]).sha
        write_json(ROOT / "config.json", cfg)
    tokenizer = AutoTokenizer.from_pretrained(cfg["model_id"], revision=cfg["revision"])
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token = tokenizer.eos_token
    parts = {name: read_jsonl(DATA / f"{name}.jsonl") for name in ["train", "validation", "test"]}
    validate_splits(parts)
    lexicon = read_json(DATA / "lexicon.json")
    for name in parts:
        assert sha256(DATA / f"{name}.jsonl") == read_json(DATA / "manifest.json")["sha256"][name]
    assert sha256(DATA / "lexicon.json") == read_json(DATA / "manifest.json")["lexicon_sha256"]
    train_data = ResponseDataset(parts["train"], tokenizer, cfg["max_sequence_length"])
    val_data = ResponseDataset(parts["validation"], tokenizer, cfg["max_sequence_length"])
    maximum_target_tokens = max(len(tokenizer.encode(json.dumps(row["target"], ensure_ascii=False), add_special_tokens=False)) + 1
                                for rows in parts.values() for row in rows)
    assert maximum_target_tokens <= cfg["max_new_tokens"], "Generation cap cannot fit the longest reference; fix protocol before training"
    val_loader = DataLoader(val_data, batch_size=cfg["batch_size"], collate_fn=collator(tokenizer))
    metadata = {"python": platform.python_version(), "torch": torch.__version__, "cuda": torch.version.cuda,
                "gpu": torch.cuda.get_device_name(0), "bf16": torch.cuda.is_bf16_supported(),
                "config": cfg, "loss": "causal cross-entropy on response tokens only; prompt and padding masked with -100",
                "max_train_sequence_tokens": max(len(x["input_ids"]) for x in train_data.items),
                "max_reference_response_tokens": maximum_target_tokens,
                "effective_batch_size": cfg["batch_size"] * cfg["gradient_accumulation_steps"],
                "scheduler": "constant learning rate", "quantized": False,
                "deterministic_algorithms": "warn_only; exact bitwise identity across hardware not guaranteed"}
    if not args.evaluate_only:
        if (ART / "selection.json").exists():
            raise RuntimeError("Existing study found. Archive artifacts before retraining; test must not influence repeated tuning.")
        write_json(ART / "environment.json", metadata)
        (ART / "requirements-lock.txt").write_text(subprocess.check_output([sys.executable, "-m", "pip", "freeze"], text=True), encoding="utf-8")
        trials = [train_trial(cfg, lr, tokenizer, train_data, val_loader) for lr in cfg["learning_rates"]]
        selected = min(trials, key=lambda r: r["validation_response_token_nll"])
        write_json(ART / "selection.json", {"selection_metric": cfg["selection_metric"], "selected": selected, "trials": trials})
        write_json(ART / "freeze.json", {"frozen_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                   "config_sha256": sha256(ROOT / "config.json"), "dataset": read_json(DATA / "manifest.json"),
                   "source_sha256": {name: sha256(ROOT / name) for name in ["common.py", "prepare_data.py", "train.py"]},
                   "selected_learning_rate": selected["learning_rate"], "selection_before_test_generation": True})
    else:
        selected = read_json(ART / "selection.json")["selected"]
        frozen = read_json(ART / "freeze.json")
        assert frozen["config_sha256"] == sha256(ROOT / "config.json")
        for name, digest in frozen["source_sha256"].items():
            assert sha256(ROOT / name) == digest, f"Source changed after freeze: {name}"
    # Nothing below this point changes selected hyperparameters.
    all_results, summary = {}, []
    base = load_base(cfg)
    for strategy, name in [("simple", "base_simple"), ("detailed", "base_detailed")]:
        predictions = generate_rows(base, tokenizer, parts["test"], cfg, strategy, name, lexicon)
        write_jsonl(ART / f"predictions-{name}.jsonl", predictions)
        all_results[name] = predictions
        summary.append({"model": name, "language": "all", **summarize(predictions)})
        for lang in ["ru", "kk"]:
            summary.append({"model": name, "language": lang, **summarize([r for r in predictions if r["language"] == lang])})
    model = PeftModel.from_pretrained(base, ROOT / selected["adapter_dir"])
    predictions = generate_rows(model, tokenizer, parts["test"], cfg, "detailed", "lora_detailed", lexicon)
    write_jsonl(ART / "predictions-lora_detailed.jsonl", predictions)
    all_results["lora_detailed"] = predictions
    summary.append({"model": "lora_detailed", "language": "all", **summarize(predictions)})
    for lang in ["ru", "kk"]:
        summary.append({"model": "lora_detailed", "language": lang, **summarize([r for r in predictions if r["language"] == lang])})
    comparisons = [{"comparison": f"{b} minus {a}", **grouped_bootstrap(all_results[a], all_results[b], metric, cfg["seed"])}
                   for a, b in [("base_simple", "base_detailed"), ("base_detailed", "lora_detailed")]
                   for metric in ["constraint_pass", "ingredient_recall", "grounded_slot_pass"]]
    write_json(ART / "llm_results.json", {"rows": summary, "comparisons": comparisons,
               "human_review_completed": False, "scope": cfg["scope"], "test_dishes": len(parts["test"]) // 2,
               "latency_note": "Sequential local GPU generation, includes first-call warmup, no API or hosting cost comparison"})
    test_by_id = {r["id"]: r for r in parts["test"]}
    with (ART / "human_review.csv").open("w", encoding="utf-8-sig", newline="") as handle:
        fields = ["id", "model", "language", "recipe", "output", "facts_correct", "language_correct", "naturalness_1_to_5", "reviewer", "notes"]
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for name, rows in all_results.items():
            for row in rows:
                writer.writerow({"id": row["id"], "model": name, "language": row["language"],
                                 "recipe": json.dumps(test_by_id[row["id"]]["recipe"], ensure_ascii=False), "output": row["raw_output"]})
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
