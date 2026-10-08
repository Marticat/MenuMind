"""Run all cells in a fresh kernel. --portable tests a standalone notebook + archive."""
from pathlib import Path
import asyncio, sys, json, tempfile, shutil, hashlib
import nbformat
from nbclient import NotebookClient
from nbconvert import HTMLExporter

if sys.platform=='win32': asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
root=Path(__file__).resolve().parent
portable='--portable' in sys.argv
work=Path(tempfile.mkdtemp(prefix='menumind-tags-')) if portable else root
if portable:
    shutil.copy2(root/'MenuMind_tags.ipynb',work/'MenuMind_tags.ipynb')
    (work/'data/raw').mkdir(parents=True)
    shutil.copy2(root/'data/raw/epirecipes-v2.zip',work/'data/raw/epirecipes-v2.zip')
nb=nbformat.read(work/'MenuMind_tags.ipynb',as_version=4)
for c in nb.cells:
    if c.cell_type=='code': c.outputs=[]; c.execution_count=None
client=NotebookClient(nb,timeout=900,kernel_name='python3',resources={'metadata':{'path':str(work)}})
client.execute()
assert not any(o.output_type=='error' for c in nb.cells if c.cell_type=='code' for o in c.outputs)
if not portable:
    nbformat.write(nb,root/'MenuMind_tags.ipynb')
    body,_=HTMLExporter().from_notebook_node(nb)
    (root/'MenuMind_tags.html').write_text(body,encoding='utf-8')
metrics=json.loads((work/'artifacts/metrics.json').read_text(encoding='utf-8'))
if portable:
    original=json.loads((root/'artifacts/metrics.json').read_text(encoding='utf-8'))
    assert metrics['test']==original['test'], 'Portable results differ'
result={'passed':True,'portable':portable,'code_cells':sum(c.cell_type=='code' for c in nb.cells),
        'test_metrics':metrics['test'],'workspace':str(work),'raw_sha256':metrics['raw_sha256']}
(root/'artifacts'/('portable_verification.json' if portable else 'verification.json')).write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(result,ensure_ascii=False))
