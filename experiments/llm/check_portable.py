"""Run only the .ipynb in a fresh directory; no adjacent inputs or credentials."""
from pathlib import Path
import asyncio, sys, os, json, uuid, shutil
import nbformat
from nbclient import NotebookClient
if sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
root = Path(__file__).resolve().parent
os.environ['IPYTHONDIR'] = str(root.parent.parent / '.cache/ipython-llm')
Path(os.environ['IPYTHONDIR']).mkdir(parents=True, exist_ok=True)
target = root.parent.parent / '.cache' / ('llm-notebook-' + uuid.uuid4().hex)
target.mkdir(parents=True)
path = target / 'MenuMind_LLM_evaluation.ipynb'
shutil.copyfile(root / path.name, path)
nb = nbformat.read(path, as_version=4)
NotebookClient(nb, timeout=180, kernel_name='python3', resources={'metadata':{'path':str(target)}}).execute()
assert json.loads((target / 'analysis/metrics.json').read_text()) == json.loads((root / 'analysis/metrics.json').read_text())
assert len(list((target / 'analysis/figures').glob('*.png'))) == 8
report = {'fresh_kernel': 'passed', 'standalone_notebook_without_adjacent_data': 'passed',
          'metrics_equal': True, 'figure_count': 8,
          'note': 'Executed locally, not in hosted Google Colab. No LLM calls during notebook execution.'}
(root / 'analysis/portable_verification.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report))
