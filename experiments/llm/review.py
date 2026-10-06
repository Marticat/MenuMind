"""Materialize Codex's qualitative audit of the saved raw outputs, including rejections.

This is an AI-assisted reading, NOT independent human annotation, a Kazakh linguist
sign-off, or a complete factual verifier. Evidence is tied to each response hash.
"""
from pathlib import Path
import json, csv, hashlib, re

root = Path(__file__).resolve().parent
results = root / 'results'
expected = {
 'dev': '2ae438972eeacf16a862965232f623525994823f0cbda6a334c580adeb96ecac',
 'final': 'ffa58d2a2048864030ec7371930e527fcb9a5bcd5e07f43af182d4f126d0aea1',
}
for phase, checksum in expected.items():
 assert hashlib.sha256((results / f'{phase}.jsonl').read_bytes()).hexdigest() == checksum, 'New answers require a new qualitative review, not these annotations.'
# Notes were assigned after inspecting every raw answer (all four channels + variant).
simple = {
 'pumpkin': 'Adds texture, sweetness/lightness and serving warmth not supplied; RU invents puree.',
 'chicken': 'Adds texture, aroma, satiety and serving qualities absent from input.',
 'tomato': 'Adds freshness, ripeness/crunch, season or Mediterranean character.',
 'salmon': 'Adds juiciness, texture and freshness; KK additionally says slow baking.',
 'caesar': 'Invents chicken, lettuce, croutons, sauce (RU also parmesan) with no ingredients supplied.',
 'lagman': 'Invents noodles, vegetables, spices and culinary origin; RU also meat and broth.',
 'signature': 'Invents signature/special status and promised taste/experience without any facts.',
 'ramen': 'Invents Japanese origin, broth/noodles and sensory qualities from the dish name.',
 'buckwheat': 'Adds crumbly texture, aroma, freshness or satiety beyond supplied facts.',
 'tofu': 'Adds freshness and crispness/softness; KK invents slow cooking.',
 'fruit': 'Adds freshness, juiciness and lightness beyond supplied ingredients.',
 'porridge': 'Adds softness/satiety; RU describes creaminess, KK adds slow boiling.',
 'beshbarmak': 'Invents meat, dough, onion and broth and cultural origin from name alone.',
 'poke': 'Adds freshness, balanced/light qualities and serving claims without ingredients.',
 'smoothie': 'Infers fruit composition/texture; KK additionally berries, despite absent ingredients.',
 'cheesecake': 'Infers creamy texture, classic status and coffee/tea pairings; RU also a base.',
}
exceptions = {
 'tomato-kk': ('review', 'Website calls the salad «жеңіл» (light), not supplied. Mild subjective claim; needs editor review.'),
 'fruit-kk': ('review', 'Wolt adds «жеңіл» (light), not supplied. Mild subjective claim; needs editor review.'),
 'porridge-kk': ('fail', 'Yandex and variant specify «аз мөлшердегі тұз» (a small amount of salt), but no quantity was supplied.'),
 'buckwheat-kk': ('review', 'Website suggests adding mushrooms to already boiled buckwheat; preparation sequence was not supplied.'),
}
rows = []
for phase in ['dev', 'final']:
 for line in (results / f'{phase}.jsonl').read_text(encoding='utf-8').splitlines():
  r = json.loads(line)
  content = r['calls'][0].get('response', {}).get('choices', [{}])[0].get('message', {}).get('content', '')
  obj = json.loads(content) if content else {}
  texts = list(obj.get('texts', {}).values()) + [obj.get('variant', '')]
  name = r['input']['recipe']['name']
  only_name = all(t.strip(' .«»') == name for t in texts)
  latin = any(re.search(r'[a-zA-Z]{3,}', t) for t in texts)
  language = 'wrong_variant_language' if latin else 'not_assessable_name_only' if only_name else 'plausible_requested_language'
  if r['strategy'] == 'simple':
   grounded, note = 'fail', simple[r['input']['group']]
   tone = 'promotional_or_generic; some variants are style labels instead of descriptions'
  else:
   grounded, note = exceptions.get(r['input']['id'], ('pass', 'No unsupported ingredient or specific factual assertion found in this reading.'))
   if r['input']['id'] == 'buckwheat-kk' and r['repetition'] == 1:
    grounded, note = 'review', 'Website again suggests a cooking sequence not explicitly stated in source.'
   tone = 'neutral_restrained; requested tones often not distinguishable'
  rows.append(dict(phase=phase, id=r['id'], input_id=r['input']['id'], strategy=r['strategy'],
      repetition=r['repetition'], groundedness=grounded, language_review=language,
      tone_review=tone, note=note, reviewer='Codex qualitative audit; not independent human review',
      content_sha256=hashlib.sha256(content.encode()).hexdigest()))
with (results / 'qualitative_review.csv').open('w', newline='', encoding='utf-8') as f:
 writer = csv.DictWriter(f, fieldnames=rows[0].keys()); writer.writeheader(); writer.writerows(rows)
print(f'Saved {len(rows)} qualitative reviews, including rejected outputs.')
