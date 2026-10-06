"""Freeze the protocol after development and before requesting held-out dishes."""
from pathlib import Path
import hashlib
import json
from datetime import datetime, timezone

root = Path(__file__).resolve().parent
results = root / 'results'
assert not (results / 'final.jsonl').exists(), 'Cannot freeze after inspecting final results.'
assert not (results / 'freeze.json').exists(), 'Freeze is immutable.'
dev = json.loads((results / 'dev-manifest.json').read_text())
assert dev.get('completedAt'), 'Development run must finish.'
files = ['server/generation.mjs', 'server/tags.mjs', 'server/schemas.mjs',
         'server/db.mjs', 'experiments/llm/run.mjs', 'experiments/llm/inputs.json']
fingerprints = {f: hashlib.sha256((root.parent.parent / f).read_bytes()).hexdigest() for f in files}
assert fingerprints == dev['fingerprints'], 'This experiment keeps the same prompts in dev and final.'
freeze = dict(frozenAt=datetime.now(timezone.utc).isoformat(), fingerprints=fingerprints,
    decision='Keep both prompts unchanged. Detailed prompt selected before final inspection; dev exposed one repeated KK regeneration and limited rule-based fact coverage.',
    primary='Paired first-attempt API acceptance on 16 held-out examples (8 dish groups).',
    secondary=['Raw response length', 'Token usage', 'End-to-end generator latency',
               'Regeneration exact difference', 'AI-assisted semantic review, not an independent human assessment'],
    constraints='No retries, exclusions of failed generations or tuning on final; report all failures. Tiny curated corpus, no claim of population performance.')
(results / 'freeze.json').write_text(json.dumps(freeze, indent=2), encoding='utf-8')
print('Frozen before final requests; prompts unchanged from development.')
