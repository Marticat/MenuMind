"""Final-model CLI. stdout is one JSON object; progress remains on stderr."""
import argparse
import json
import sys
from pathlib import Path
from common import DATA, read_jsonl
from inference import FinalModel, read_input, validate_input


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--example-id", help="Saved test fixture ID (not a new-input demonstration)")
    source.add_argument("--input", type=Path, help="UTF-8 JSON recipe")
    parser.add_argument("--device", choices=["auto", "cpu", "cuda"], default="auto")
    parser.add_argument("--offline", action="store_true", help="Use cached base weights only")
    parser.add_argument("--output", type=Path, help="Also save the result as UTF-8 JSON")
    args = parser.parse_args()
    try:
        if args.example_id:
            fixture = next((r for r in read_jsonl(DATA / "test.jsonl") if r["id"] == args.example_id), None)
            if fixture is None:
                raise ValueError(f"Unknown example ID: {args.example_id}")
            row = validate_input({key: fixture[key] for key in ("recipe", "language", "channel", "tone", "maxLength")})
        else:
            row = read_input(args.input)
    except (ValueError, OSError) as exc:
        print(json.dumps({"error": {"code": "invalid_input", "message": str(exc)}}, ensure_ascii=False))
        return 2
    try:
        runtime = FinalModel(args.device, args.offline)
        result = runtime.predict(row)
        result["load_seconds"] = runtime.load_seconds
    except ValueError as exc:
        print(json.dumps({"error": {"code": "validation_failed", "message": str(exc)}}, ensure_ascii=False))
        return 2
    except Exception as exc:
        print(json.dumps({"error": {"code": "model_unavailable", "message": str(exc)}}, ensure_ascii=False))
        return 1
    payload = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(payload, encoding="utf-8")
    print(payload, end="")
    return 0 if result["accepted"] else 3


if __name__ == "__main__":
    sys.exit(main())
