"""Package only experiment files, including both local adapters, never API keys or base weights."""
from zipfile import ZipFile, ZIP_DEFLATED
from common import ROOT, ART, sha256, read_json, write_json


def main():
    assert read_json(ART / "verification.json")["passed"]
    selected = read_json(ART / "selection.json")["selected"]
    assert (ROOT / selected["adapter_dir"] / "adapter_model.safetensors").is_file()
    files = [p for p in ROOT.iterdir() if p.suffix in {".py", ".json", ".md", ".txt", ".ipynb"}]
    for folder in [ROOT / "dataset", ART]:
        files += [p for p in folder.rglob("*") if p.is_file() and "__pycache__" not in p.parts and "checkpoints" not in p.parts and p.name != "submission_manifest.json"]
    files = sorted(set(files))
    entries = {str(p.relative_to(ROOT)).replace("\\", "/"): p for p in files}
    classic_source = ROOT.parent / "tags-midterm" / "artifacts" / "data"
    if not classic_source.exists():
        classic_source = ROOT / "classical-data"
    for split in ["train", "validation", "test"]:
        for name in [f"X_{split}.jsonl", f"y_{split}.csv"]:
            path = classic_source / name
            assert path.is_file(), f"Missing classical split: {path}"
            entries[f"classical-data/{name}"] = path
    source_manifest = ROOT.parent / "tags-midterm" / "source_manifest.json"
    if not source_manifest.exists():
        source_manifest = ROOT / "classical-data/source_manifest.json"
    if source_manifest.exists():
        entries["classical-data/source_manifest.json"] = source_manifest
    manifest = {name: {"sha256": sha256(p), "bytes": p.stat().st_size} for name, p in entries.items()}
    write_json(ART / "submission_manifest.json", manifest)
    path = ROOT / "MenuMind_LoRA_submission.zip"
    with ZipFile(path, "w", ZIP_DEFLATED) as archive:
        for name, file in entries.items():
            archive.write(file, "lora-study/" + name)
        archive.write(ART / "submission_manifest.json", "lora-study/artifacts/submission_manifest.json")
    with ZipFile(path) as archive:
        assert archive.testzip() is None
    print(f"{path.name}: {path.stat().st_size:,} bytes; {len(entries)+1} files")


if __name__ == "__main__":
    main()
