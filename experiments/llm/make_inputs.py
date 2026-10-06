"""Create a small authored acceptance corpus, not scraped restaurant facts."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
# Split is fixed before any model calls; both translations stay in the same group.
DISHES = [
    ('pumpkin', 'dev', 'editorial', 'Суп из тыквы', 'Асқабақ сорпасы', 'Суп', 'Сорпа',
     ['тыква', 'вода', 'соль'], ['асқабақ', 'су', 'тұз'], 'Варка.', 'Қайнату.'),
    ('chicken', 'dev', 'bistro', 'Курица с рисом', 'Күріш қосылған тауық', 'Горячее', 'Ыстық тағам',
     ['курица', 'рис', 'вода', 'соль'], ['тауық еті', 'күріш', 'су', 'тұз'], 'Варка.', 'Қайнату.'),
    ('tomato', 'dev', 'concierge', 'Салат из томатов', 'Қызанақ салаты', 'Салат', 'Салат',
     ['томаты', 'огурцы', 'оливковое масло'], ['қызанақ', 'қияр', 'зәйтүн майы'], '', ''),
    ('salmon', 'dev', 'editorial', 'Запечённый лосось', 'Пеште пісірілген албырт', 'Горячее', 'Ыстық тағам',
     ['лосось', 'лимон', 'соль'], ['албырт', 'лимон', 'тұз'], 'Запекание.', 'Пеште пісіру.'),
    ('caesar', 'dev', 'bistro', 'Цезарь', 'Цезарь', 'Салат', 'Салат', [], [], '', ''),
    ('lagman', 'dev', 'concierge', 'Лагман', 'Лағман', 'Горячее', 'Ыстық тағам', [], [], '', ''),
    ('signature', 'dev', 'editorial', 'Блюдо № 7', '№ 7 тағам', '', '', [], [], '', ''),
    ('ramen', 'dev', 'bistro', 'Рамен', 'Рамен', 'Суп', 'Сорпа', [], [], '', ''),
    ('buckwheat', 'final', 'concierge', 'Гречка с грибами', 'Саңырауқұлақ қосылған қарақұмық', 'Горячее', 'Ыстық тағам',
     ['гречка', 'шампиньоны', 'вода', 'соль'], ['қарақұмық', 'қозықұйрық', 'су', 'тұз'], 'Варка.', 'Қайнату.'),
    ('tofu', 'final', 'editorial', 'Тофу с брокколи', 'Брокколи қосылған тофу', 'Горячее', 'Ыстық тағам',
     ['тофу', 'брокколи', 'соевый соус'], ['тофу', 'брокколи', 'соя тұздығы'], 'Тушение.', 'Бұқтыру.'),
    ('fruit', 'final', 'bistro', 'Фруктовый салат', 'Жеміс салаты', 'Десерт', 'Десерт',
     ['яблоко', 'груша'], ['алма', 'алмұрт'], '', ''),
    ('porridge', 'final', 'concierge', 'Овсяная каша', 'Сұлы ботқасы', 'Завтрак', 'Таңғы ас',
     ['овсяные хлопья', 'молоко', 'соль'], ['сұлы үлпектері', 'сүт', 'тұз'], 'Варка.', 'Қайнату.'),
    ('beshbarmak', 'final', 'editorial', 'Бешбармак', 'Бешбармақ', 'Горячее', 'Ыстық тағам', [], [], '', ''),
    ('poke', 'final', 'bistro', 'Поке', 'Поке', 'Горячее', 'Ыстық тағам', [], [], '', ''),
    ('smoothie', 'final', 'concierge', 'Смузи', 'Смузи', 'Напиток', 'Сусын', [], [], '', ''),
    ('cheesecake', 'final', 'editorial', 'Чизкейк', 'Чизкейк', 'Десерт', 'Десерт', [], [], '', ''),
]
rows = []
for group, split, tone, ru, kk, cat_ru, cat_kk, ing_ru, ing_kk, method_ru, method_kk in DISHES:
    for language, name, category, ingredients, method in [
        ('ru', ru, cat_ru, ing_ru, method_ru), ('kk', kk, cat_kk, ing_kk, method_kk)
    ]:
        rows.append(dict(id=f'{group}-{language}', group=group, split=split,
                         language=language, tone=tone, maxLength=250,
                         completeness='complete' if ingredients else 'name_category_only',
                         source='authored acceptance fixture; supplied fields are the only ground truth',
                         recipe=dict(name=name, category=category, ingredients=ingredients, method=method)))
(ROOT / 'inputs.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(f'Wrote {len(rows)} examples, {len(DISHES)} dish groups.')
