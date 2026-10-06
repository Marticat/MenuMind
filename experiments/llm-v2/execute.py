from pathlib import Path
import os, sys, asyncio, json, uuid, shutil
import nbformat
from nbclient import NotebookClient
from nbconvert import HTMLExporter
if sys.platform=='win32':asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
root=Path(__file__).resolve().parent
cache=root.parent.parent/'.cache/llm-v2'; cache.mkdir(parents=True,exist_ok=True)
os.environ['IPYTHONDIR']=str(cache/'ipython');Path(os.environ['IPYTHONDIR']).mkdir(exist_ok=True)
portable='--portable' in sys.argv
target=cache/uuid.uuid4().hex if portable else root
target.mkdir(parents=True,exist_ok=True)
path=target/'MenuMind_final.ipynb'
if portable:shutil.copyfile(root/path.name,path)
nb=nbformat.read(path,as_version=4)
NotebookClient(nb,timeout=180,kernel_name='python3',resources={'metadata':{'path':str(target)}}).execute()
nbformat.write(nb,path)
if portable:
 assert json.loads((target/'analysis/metrics.json').read_text())==json.loads((root/'analysis/metrics.json').read_text())
 (root/'analysis/portable.json').write_text(json.dumps(dict(passed=True,isolated=True,identical_metrics=True,hosted_colab_tested=False),indent=2))
else:
 html,_=HTMLExporter().from_notebook_node(nb)
 (root/'MenuMind_final.html').write_text(html,encoding='utf-8')
print('Passed:', 'isolated standalone notebook' if portable else 'fresh kernel + HTML')
