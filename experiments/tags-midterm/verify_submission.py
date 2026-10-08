"""Check actual outputs, model loading, notebook execution, PDF lengths and slide notes."""
from pathlib import Path
import json, sys
import nbformat, joblib, numpy as np
from pptx import Presentation
from pypdf import PdfReader

root=Path(__file__).resolve().parent
m=json.loads((root/'artifacts/metrics.json').read_text(encoding='utf-8'))
nb=nbformat.read(root/'MenuMind_tags.ipynb',as_version=4)
code=[c for c in nb.cells if c.cell_type=='code']
assert all(c.execution_count is not None for c in code)
assert not any(o.output_type=='error' for c in code for o in c.outputs)
assert len(PdfReader(root/'MenuMind_report.pdf').pages)==2
assert len(PdfReader(root/'MenuMind_presentation.pdf').pages)==7
slides=Presentation(root/'MenuMind_presentation.pptx').slides
assert len(slides)==7 and all(len(s.notes_slide.notes_text_frame.text)>100 for s in slides)
assert len(list((root/'artifacts/figures').glob('*.png')))>=5
bundle=joblib.load(root/'artifacts/models/tag_classifier.joblib')
prob=bundle['pipeline'].predict_proba(['Chicken . chicken . rice'])
assert prob.shape==(1,10) and np.isfinite(prob).all()
verification=json.loads((root/'artifacts/portable_verification.json').read_text(encoding='utf-8'))
assert verification['passed'] and verification['test_metrics']==m['test']
summary={'passed':True,'executed_code_cells':len(code),'report_pages':2,'slides':7,
 'plots':len(list((root/'artifacts/figures').glob('*.png'))),'model_load_and_predict':True,
 'portable_metrics_identical':True,'test_rows':next(s['n'] for s in m['split'] if s['split']=='test')}
(root/'artifacts/submission_verification.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
print(json.dumps(summary))
