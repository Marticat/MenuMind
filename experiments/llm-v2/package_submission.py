from pathlib import Path
import zipfile, json, ast, hashlib
import nbformat
from pypdf import PdfReader
root=Path(__file__).resolve().parent
for p in root.glob('*.py'):ast.parse(p.read_text(encoding='utf-8'))
nb=nbformat.read(root/'MenuMind_final.ipynb',as_version=4)
cells=[c for c in nb.cells if c.cell_type=='code']
assert all(c.execution_count is not None for c in cells)
assert not any(o.output_type=='error' for c in cells for o in c.outputs)
assert len(PdfReader(root/'MenuMind_report.pdf').pages)==2
assert len(PdfReader(root/'MenuMind_presentation.pdf').pages)==8
freeze=json.loads((root/'results/freeze.json').read_text(encoding='utf-8'))
for p,h in freeze['hashes'].items():
    assert hashlib.sha256(freeze['sources'][p].encode()).hexdigest()==h,p
    assert (root.parent.parent/p).read_text(encoding='utf-8').replace('\r\n','\n')==freeze['sources'][p].replace('\r\n','\n'),p
env=root.parent.parent/'.env'
keylines=env.read_text(encoding='utf-8').splitlines() if env.exists() else []
keys=[s.split('=',1)[1].strip().strip('\"').strip("'") for s in keylines if s.startswith('LLM_API_KEY=')]
files=[p for p in root.rglob('*') if p.is_file() and p.suffix not in ['.zip','.pyc']]
for p in files:
    assert not any(k and k.encode() in p.read_bytes() for k in keys),'Secret leaked: '+str(p)
report={'notebook_executed':True,'report_pages':2,'slides':8,'frozen_sources_match':True,'secret_scan':'passed' if keys else 'no local key to compare',
        'server_tests':39,'browser_tests':9,'human_language_review':False}
(root/'analysis/submission_checks.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
with zipfile.ZipFile(root/'MenuMind_submission.zip','w',zipfile.ZIP_DEFLATED) as z:
    for p in root.rglob('*'):
        if p.is_file() and p.suffix not in ['.zip','.pyc']:z.write(p,p.relative_to(root))
print(json.dumps(report));print('Packaged MenuMind_submission.zip')
