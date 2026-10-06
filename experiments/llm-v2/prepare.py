from pathlib import Path
import json
root = Path(__file__).resolve().parent
root.mkdir(exist_ok=True)
old = json.loads((root.parent/'llm/inputs.json').read_text(encoding='utf-8'))
rows = [{**r, 'split':'dev'} for r in old if r['group'] in ['caesar','beshbarmak','porridge']]
dishes = [
 ('lentil','Чечевичный суп','Жасымық сорпасы','Суп','Сорпа',['чечевица','вода','соль'],['жасымық','су','тұз'],'Варка.','Қайнату.'),
 ('beet','Салат из свёклы','Қызылша салаты','Салат','Салат',['свёкла','растительное масло'],['қызылша','өсімдік майы'],'',''),
 ('potato','Картофельное пюре','Картоп езбесі','Гарнир','Гарнир',['картофель','молоко','соль'],['картоп','сүт','тұз'],'Варка.','Қайнату.'),
 ('compote','Грушевый компот','Алмұрт компоты','Напиток','Сусын',['груша','вода'],['алмұрт','су'],'Варка.','Қайнату.'),
 ('khachapuri','Хачапури','Хачапури','Выпечка','Пісірме',[],[],'',''),
 ('udon','Удон','Удон','Горячее','Ыстық тағам',[],[],'',''),
 ('shakshuka','Шакшука','Шакшука','Завтрак','Таңғы ас',[],[],'',''),
 ('manty','Манты','Мәнті','Горячее','Ыстық тағам',[],[],'',''),
]
for i,(group,ru,kk,cr,ck,ir,ik,mr,mk) in enumerate(dishes):
 for language,name,category,ingredients,method in [('ru',ru,cr,ir,mr),('kk',kk,ck,ik,mk)]:
  rows.append(dict(id=f'{group}-{language}',group=group,split='final',language=language,
    tone=['editorial','bistro','concierge'][i%3],maxLength=250,
    completeness='complete' if ingredients else 'name_category_only',
    source='authored acceptance fixture; only explicitly supplied fields are facts',
    recipe=dict(name=name,category=category,ingredients=ingredients,method=method)))
assert not {r['group'] for r in rows if r['split']=='final'} & {r['group'] for r in old}
(root/'inputs.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding='utf-8')
(root/'pricing.json').write_text(json.dumps(dict(model='gpt-5.6-luna',checked_on='2026-10-07',currency='USD',
    per_million=dict(input=0.20,cached_input=0.02,cache_write=0.25,output=1.20),
    source='https://developers.openai.com/api/docs/models/gpt-5.6-luna',
    scope='Standard short-context public list price; excludes hosting, taxes, regional premiums and negotiated rates.'),indent=2),encoding='utf-8')
print(f'{len(rows)} examples; 16 held-out language cases from 8 entirely new dish groups.')
