"""Restore bundled model/data assets after git clone, with hash and path checks."""
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parent


def main():
    archive_path = ROOT / "MenuMind_LoRA_submission.zip"
    if not archive_path.exists():
        return  # A new study can instead use sibling tags-midterm data.
    restored = 0
    with ZipFile(archive_path) as archive:
        manifest = json.loads(archive.read("lora-study/artifacts/submission_manifest.json"))
        for name, record in manifest.items():
            if not name.startswith(("classical-data/", "artifacts/adapters/")):
                continue
            target = (ROOT / name).resolve()
            if not target.is_relative_to(ROOT):
                raise ValueError(f"Unsafe archive path: {name}")
            # Existing local training outputs belong to that local run; never overwrite them.
            if target.exists():
                continue
            payload = archive.read("lora-study/" + name)
            if hashlib.sha256(payload).hexdigest() != record["sha256"]:
                raise ValueError(f"Archive hash mismatch: {name}")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(payload)
            restored += 1
    if restored:
        print(f"Restored {restored} verified model/data assets from submission archive")


if __name__ == "__main__":
    main()
