"""Versioned inference boundary; training and frozen evaluation remain untouched."""
import contextlib
import json
import re
import sys
import time
import unicodedata
from pathlib import Path
from common import ROOT, DATA, read_json, sha256, messages, score_output, contains_phrase

MANIFEST = ROOT / "final_model.json"


def _text(value, name, maximum):
    if not isinstance(value, str):
        raise ValueError(f"{name} must be a string")
    if any(unicodedata.category(c).startswith("C") for c in value):
        raise ValueError(f"{name} contains control or invisible characters")
    value = re.sub(r"\s+", " ", unicodedata.normalize("NFC", value)).strip()
    if not 1 <= len(value) <= maximum:
        raise ValueError(f"{name} must contain 1..{maximum} characters")
    return value


def validate_input(value):
    if not isinstance(value, dict):
        raise ValueError("Input must be a JSON object")
    allowed = {"recipe", "language", "channel", "tone", "maxLength"}
    if set(value) - allowed:
        raise ValueError("Unknown input fields: " + ", ".join(sorted(set(value) - allowed)))
    if value.get("language") not in ("ru", "kk"):
        raise ValueError("language must be ru or kk")
    if value.get("channel", "website") != "website" or value.get("tone", "neutral") != "neutral":
        raise ValueError("This model supports website/neutral only")
    length = value.get("maxLength", 250)
    if type(length) is not int or length != 250:
        raise ValueError("maxLength must be 250 (the evaluated model contract)")
    recipe = value.get("recipe")
    if not isinstance(recipe, dict) or set(recipe) != {"name", "ingredients", "method"}:
        raise ValueError("recipe must contain exactly name, ingredients and method")
    ingredients = recipe["ingredients"]
    if not isinstance(ingredients, list) or not 1 <= len(ingredients) <= 12:
        raise ValueError("recipe.ingredients must be a list of 1..12 strings")
    clean = {"name": _text(recipe["name"], "recipe.name", 120),
             "ingredients": [_text(x, "recipe.ingredients[]", 80) for x in ingredients],
             "method": _text(recipe["method"], "recipe.method", 120)}
    if len({x.casefold() for x in clean["ingredients"]}) != len(clean["ingredients"]):
        raise ValueError("recipe.ingredients must not contain duplicates")
    return {"recipe": clean, "language": value["language"], "channel": "website", "tone": "neutral", "maxLength": 250}


def verify_assets(manifest, root=ROOT):
    root = Path(root).resolve()
    for name, expected in manifest["assets"].items():
        path = (root / name).resolve()
        if not path.is_relative_to(root):
            raise ValueError(f"Unsafe model asset path: {name}")
        if not path.is_file():
            raise ValueError(f"Missing model asset: {name}; restore the submission archive first")
        if sha256(path) != expected:
            raise ValueError(f"Model asset hash mismatch: {name}")


def check_output(row, raw, lexicon, truncated):
    # The frozen study scorer assumed canonical ingredient spelling. New inputs
    # may contain 'Рис' or 'рис басмати'; neither makes the supplied rice extra.
    language = row["language"]
    scoped = {**lexicon, language: {**lexicon[language], "ingredients": [
        term for term in lexicon[language]["ingredients"]
        if not any(contains_phrase(item, term) for item in row["recipe"]["ingredients"])]}}
    scores = score_output(row, raw, scoped)
    errors = [metric for metric in ("json_valid", "constraint_pass", "method_match", "known_fact_pass") if not scores[metric]]
    if not contains_phrase(scores["description"], row["recipe"]["name"]):
        errors.append("missing_dish_name")
    if any(unicodedata.category(c).startswith("C") for c in scores["description"]):
        errors.append("control_characters")
    if scores["ingredient_recall"] != 1:
        errors.append("missing_ingredients")
    if truncated:
        errors.append("token_limit")
    return {"accepted": not errors, "validation_version": "final-v1", "description": scores["description"] if not errors else None,
            "raw_output": raw, "scores": scores, "validation_errors": errors,
            "requires_human_review": True,
            "review_notice": "Automatic checks cover format and literal slots only; they do not prove factual or linguistic quality."}


class FinalModel:
    def __init__(self, device="auto", offline=False):
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer
        from peft import PeftModel
        from restore_assets import main as restore
        if device not in ("auto", "cpu", "cuda"):
            raise ValueError("device must be auto, cpu or cuda")
        if device == "cuda" and not torch.cuda.is_available():
            raise RuntimeError("CUDA is unavailable; choose --device cpu or install CUDA PyTorch")
        self.device = "cuda" if device == "auto" and torch.cuda.is_available() else ("cpu" if device == "auto" else device)
        started = time.perf_counter()
        with contextlib.redirect_stdout(sys.stderr):
            restore()
        self.manifest = read_json(MANIFEST)
        verify_assets(self.manifest)
        cfg = read_json(ROOT / "config.json")
        self.cfg = cfg
        torch.set_num_threads(4)
        torch.manual_seed(cfg["seed"])
        dtype = torch.bfloat16 if self.device == "cuda" and torch.cuda.is_bf16_supported() else torch.float32
        self.tokenizer = AutoTokenizer.from_pretrained(cfg["model_id"], revision=cfg["revision"], local_files_only=offline)
        if self.tokenizer.pad_token_id is None:
            self.tokenizer.pad_token = self.tokenizer.eos_token
        base = AutoModelForCausalLM.from_pretrained(cfg["model_id"], revision=cfg["revision"],
            torch_dtype=dtype, attn_implementation="sdpa", use_safetensors=True, local_files_only=offline).to(self.device)
        self.model = PeftModel.from_pretrained(base, ROOT / self.manifest["adapter_dir"], is_trainable=False)
        self.model.eval()
        self.model.requires_grad_(False)
        self.model.config.use_cache = True
        self.lexicon = read_json(DATA / "lexicon.json")
        self.load_seconds = time.perf_counter() - started
        self.dtype = str(dtype)

    def info(self):
        return {"model_version": self.manifest["model_version"], "base_model": self.cfg["model_id"],
                "base_revision": self.cfg["revision"], "adapter_sha256": self.manifest["adapter_sha256"],
                "device": self.device, "dtype": self.dtype, "load_seconds": self.load_seconds,
                "contract": self.manifest["contract"], "requires_human_review": True}

    def predict(self, value):
        import torch
        row = validate_input(value)
        started = time.perf_counter()
        prompt = self.tokenizer.apply_chat_template(messages(row, "detailed"), tokenize=False, add_generation_prompt=True)
        inputs = self.tokenizer(prompt, return_tensors="pt", add_special_tokens=False)
        input_tokens = inputs.input_ids.shape[1]
        if input_tokens > self.manifest["max_input_tokens"]:
            raise ValueError(f"Input uses {input_tokens} tokens; maximum is {self.manifest['max_input_tokens']}. Shorten the recipe; inputs are never silently truncated.")
        inputs = inputs.to(self.device)
        if self.device == "cuda":
            torch.cuda.synchronize()
        generation_started = time.perf_counter()
        with torch.inference_mode():
            out = self.model.generate(**inputs, max_new_tokens=self.cfg["max_new_tokens"], do_sample=False, num_beams=1,
                pad_token_id=self.tokenizer.pad_token_id, eos_token_id=self.tokenizer.eos_token_id)
        if self.device == "cuda":
            torch.cuda.synchronize()
        generation_seconds = time.perf_counter() - generation_started
        generated = out[0, input_tokens:].tolist()
        raw = self.tokenizer.decode(generated, skip_special_tokens=True)
        truncated = len(generated) >= self.cfg["max_new_tokens"] and generated[-1] != self.tokenizer.eos_token_id
        result = check_output(row, raw, self.lexicon, truncated)
        result.update(model_version=self.manifest["model_version"], base_revision=self.cfg["revision"],
                      adapter_sha256=self.manifest["adapter_sha256"], language=row["language"],
                      input_tokens=input_tokens, generated_tokens=len(generated), reached_token_limit=truncated,
                      generation_seconds=generation_seconds, latency_seconds=time.perf_counter() - started,
                      device=self.device)
        return result


def read_input(path):
    path = Path(path)
    if path.stat().st_size > 16384:
        raise ValueError("Input JSON exceeds 16 KiB")
    return validate_input(json.loads(path.read_text(encoding="utf-8-sig")))
