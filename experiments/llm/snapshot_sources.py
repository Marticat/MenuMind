"""Archive the exact evaluated source before any later formatting or maintenance."""
from pathlib import Path
import json, hashlib
root = Path(__file__).resolve().parent
freeze = json.loads((root / 'results/freeze.json').read_text())
sources = {}
for file, checksum in freeze['fingerprints'].items():
    content = (root.parent.parent / file).read_bytes()
    assert hashlib.sha256(content).hexdigest() == checksum, file
    sources[file] = content.decode('utf-8')
(root / 'results/frozen-sources.json').write_text(json.dumps(sources, ensure_ascii=False, indent=2), encoding='utf-8')
print('Archived the exact frozen source; later whitespace formatting does not change recorded provenance.')
