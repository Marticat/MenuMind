"""Offline EN publisher-tag prediction; probabilities are not verified recipe facts."""
from pathlib import Path
import argparse, json, joblib
parser=argparse.ArgumentParser()
parser.add_argument('--title',required=True)
parser.add_argument('--ingredients',nargs='*',default=[])
args=parser.parse_args()
bundle=joblib.load(Path(__file__).resolve().parent/'artifacts/models/tag_classifier.joblib')
p=bundle['pipeline'].predict_proba([args.title+' . '+' . '.join(args.ingredients)])[0]
print(json.dumps({'language':'en','task':bundle['task'],'threshold':bundle['threshold'],
 'predicted_tags':[tag for tag,score in zip(bundle['labels'],p) if score>=bundle['threshold']],
 'scores':dict(zip(bundle['labels'],map(float,p))),'verified_facts':False},ensure_ascii=False,indent=2))
