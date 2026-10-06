from pathlib import Path
import asyncio, sys, os
import nbformat
from nbclient import NotebookClient
from nbconvert import HTMLExporter
if sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
root = Path(__file__).resolve().parent
os.environ['IPYTHONDIR'] = str(root.parent.parent / '.cache/ipython-llm')
Path(os.environ['IPYTHONDIR']).mkdir(parents=True, exist_ok=True)
path = root / 'MenuMind_LLM_evaluation.ipynb'
nb = nbformat.read(path, as_version=4)
NotebookClient(nb, timeout=180, kernel_name='python3', resources={'metadata':{'path':str(root)}}).execute()
nbformat.write(nb, path)
html, _ = HTMLExporter().from_notebook_node(nb)
(root / 'MenuMind_LLM_evaluation.html').write_text(html, encoding='utf-8')
print('Fresh-kernel execution passed; HTML exported.')
