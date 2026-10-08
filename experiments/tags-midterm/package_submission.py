"""Create a portable academic bundle; never include account databases or API keys."""
from pathlib import Path
import zipfile, json, hashlib

root=Path(__file__).resolve().parent
target=root/'MenuMind_tags_submission.zip'
files=[]
for path in sorted(root.rglob('*')):
    if not path.is_file():continue
    rel=path.relative_to(root)
    if path.suffix=='.zip' and rel.as_posix()!='data/raw/epirecipes-v2.zip':continue
    if '__pycache__' in rel.parts or '.ipynb_checkpoints' in rel.parts:continue
    if rel.as_posix()=='data/raw/full_format_recipes.json':continue
    if rel.as_posix()=='artifacts/package_manifest.json':continue
    files.append(path)
manifest={str(p.relative_to(root)).replace('\\','/'):{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in files}
(root/'artifacts/package_manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
files.append(root/'artifacts/package_manifest.json')
with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for path in files:z.write(path,Path('MenuMind_tags')/path.relative_to(root))
with zipfile.ZipFile(target) as z:
    assert z.testzip() is None
    assert not any('/.env' in name or name.endswith('.sqlite') for name in z.namelist())
print(f'{target.name}: {len(files)} files, {target.stat().st_size/1e6:.1f} MB, CRC passed')
