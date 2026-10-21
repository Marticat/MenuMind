"""Sequential entry point. Default: verify saved experiment offline; --train: new study."""
from pathlib import Path
import argparse
import subprocess
import sys

ROOT = Path(__file__).resolve().parent


def execute_notebook():
    import nbformat
    from nbclient import NotebookClient
    from jupyter_client import KernelManager
    path = ROOT / "MenuMind_LoRA.ipynb"
    notebook = nbformat.read(path, as_version=4)
    manager = KernelManager(kernel_name="python3")
    manager.kernel_spec.argv = [sys.executable, "-m", "ipykernel_launcher", "-f", "{connection_file}"]
    NotebookClient(notebook, timeout=180, km=manager, resources={"metadata": {"path": str(ROOT)}}).execute()
    nbformat.write(notebook, path)
    print("Notebook executed successfully", flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--train", action="store_true", help="New GPU study, downloads pretrained model; refuses to overwrite an existing study")
    args = parser.parse_args()
    if args.train and (ROOT / "artifacts/selection.json").exists():
        raise SystemExit("An experiment already exists. Copy this folder to a new study and archive its artifacts before a new training run.")
    from restore_assets import main as restore_assets
    restore_assets()
    steps = (["prepare_data.py", "test_protocol.py", "classical.py", "train.py"] if args.train else ["test_protocol.py"])
    steps += ["audit_artifacts.py", "build_report.py"]
    for script in steps:
        subprocess.run([sys.executable, str(ROOT / script)], cwd=ROOT, check=True)
    execute_notebook()


if __name__ == "__main__":
    main()
