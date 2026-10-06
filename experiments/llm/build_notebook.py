"""Build a self-contained, offline-reproducible notebook from immutable live evidence."""
from pathlib import Path
import json, hashlib, zlib, base64
import nbformat as nbf

root = Path(__file__).resolve().parent
files = ['inputs.json', 'results/dev.jsonl', 'results/final.jsonl', 'results/smoke.jsonl',
         'results/dev-manifest.json', 'results/final-manifest.json', 'results/freeze.json',
         'results/browser.json', 'results/browser-faults.json', 'results/contract.json',
         'results/qualitative_review.csv', 'results/frozen-sources.json']
bundle = {f: (root / f).read_text(encoding='utf-8') for f in files}
checksums = {f: hashlib.sha256(text.encode()).hexdigest() for f, text in bundle.items()}
embedded = base64.b64encode(zlib.compress(json.dumps(bundle, ensure_ascii=False).encode(), 9)).decode()
cells = []
def md(text): cells.append(nbf.v4.new_markdown_cell(text.strip()))
def code(text): cells.append(nbf.v4.new_code_cell(text.strip()))

md('''# MenuMind: проверка настоящей LLM и сравнение промптов

Это выполненный эксперимент с `gpt-5.6-luna`, а не демонстрация шаблонов.
32 авторских примера (16 блюд × RU/KK), два промпта, 64 первичных запроса и
8 попыток перегенерации. Отдельно сохранены живые проверки сайта и API.

**Воспроизводимость:** Restart Kernel → Run All воспроизводит очистку, таблицы,
проверки и графики из сохранённых ответов без ключа и платных запросов.
Снимок входов и результатов встроен в Notebook; соседние файлы, если присутствуют,
должны совпадать по SHA-256. Для нового живого эксперимента нужны Node.js, ключ в
`.env` и скрипты из `experiments/llm` — команды приведены в конце.

**RQ1:** уменьшает ли подробный промпт нарушения ограничений?
**RQ2:** как меняются время и токены? **RQ3:** где остаются ошибки при нехватке фактов,
перегенерации и переводе? **RQ4:** получает ли браузер именно текст провайдера?

Небольшой искусственный acceptance-набор не является случайной выборкой ресторанов.
Проверка смысла выполнена Codex и обозначена отдельно; независимой человеческой
оценки и проверки носителем казахского языка нет.''')
code('''# При необходимости установите зависимости (один раз):
# %pip install pandas==2.3.3 numpy==2.2.6 matplotlib==3.10.9 seaborn==0.13.2
from pathlib import Path
from io import StringIO
import json, hashlib, zlib, base64, re, unicodedata
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
from IPython.display import display, Markdown

pd.set_option('display.max_colwidth', 140)
sns.set_theme(style='whitegrid', palette='colorblind')
ROOT = Path.cwd()
if (ROOT / 'experiments/llm/inputs.json').exists():
    ROOT = ROOT / 'experiments/llm'
OUT = ROOT / 'analysis'
OUT.mkdir(exist_ok=True)
(OUT / 'figures').mkdir(exist_ok=True)
def savefig(name):
    plt.tight_layout()
    plt.savefig(OUT / 'figures' / (name + '.png'), dpi=160, bbox_inches='tight')
    plt.show()
''')
code(f'''EMBEDDED = {embedded!r}
EXPECTED_SHA256 = {checksums!r}
snapshot = json.loads(zlib.decompress(base64.b64decode(EMBEDDED)))
def read_evidence(name):
    local = ROOT / name
    text = local.read_text(encoding='utf-8') if local.exists() else snapshot[name]
    assert hashlib.sha256(text.encode()).hexdigest() == EXPECTED_SHA256[name], name + ': evidence changed'
    return text
raw = pd.DataFrame(json.loads(read_evidence('inputs.json')))
records = [json.loads(line) for phase in ['dev', 'final']
           for line in read_evidence(f'results/{{phase}}.jsonl').splitlines() if line.strip()]
print('Examples:', len(raw), '| Dish groups:', raw.group.nunique(), '| Recorded attempts:', len(records))
display(raw[['id', 'group', 'split', 'language', 'tone', 'completeness']].head(8))
''')
md('''## 1. Источник, структура и качество данных

Входы созданы специально для проверки ТЗ; они не извлечены из Epicurious или Zomato.
Единственный источник фактов — поля конкретного примера. Название знакомого блюда
не разрешает дописывать его обычный рецепт. Пустой состав оставляется пустым.
Текстовые эталоны не написаны: проверяется соблюдение ограничений, а не совпадение
с одной формулировкой. Пропуски состава, метода и категории здесь преднамеренные.
''')
code('''recipe = pd.json_normalize(raw.recipe)
quality = pd.DataFrame({
    'field': ['name', 'category', 'ingredients', 'method'],
    'missing_n': [(recipe[c].map(lambda v: v is None or v == '' or v == [])).sum()
                  for c in ['name', 'category', 'ingredients', 'method']]
})
quality['missing_pct'] = quality.missing_n / len(raw) * 100
print('Shape:', raw.shape, '| duplicate IDs:', raw.id.duplicated().sum())
print('Exact duplicate records:', pd.Series([json.dumps(r, sort_keys=True, ensure_ascii=False)
       for r in raw.to_dict('records')]).duplicated().sum())
display(raw.dtypes.to_frame('dtype'))
display(quality)
quality.to_csv(OUT / 'input_quality.csv', index=False)
plt.figure(figsize=(7, 3))
sns.barplot(data=quality, x='field', y='missing_n', color='#397a9b')
plt.title('1. Intentionally missing source fields'); plt.ylabel('Examples')
savefig('01_missing_fields')
''')
md('''## 2. Очистка без добавления фактов

Нормализуем Unicode и пробелы, удаляем точные повторы ID только после проверки,
что ID не скрывают разные записи. Состав не восстанавливается по названию.
Неудачные ответы модели не удаляются и участвуют в знаменателях метрик.
''')
code('''def normalize(value):
    if isinstance(value, str): return unicodedata.normalize('NFC', value).strip()
    if isinstance(value, list): return [normalize(v) for v in value]
    if isinstance(value, dict): return {k: normalize(v) for k, v in value.items()}
    return value
before = raw.to_dict('records')
normalized = [normalize(r) for r in before]
for item in normalized:
    assert item['language'] in ['ru', 'kk']
    assert item['split'] in ['dev', 'final']
    assert item['recipe']['name'] and isinstance(item['recipe']['ingredients'], list)
    assert 40 <= item['maxLength'] <= 2000
assert not raw.id.duplicated().any(), 'Investigate duplicate IDs instead of silently selecting one'
clean = pd.DataFrame(normalized).drop_duplicates('id').copy()
clean['ingredient_count'] = clean.recipe.map(lambda r: len(r['ingredients']))
clean['name_chars'] = clean.recipe.map(lambda r: len(r['name']))
cleaning = {'before': len(raw), 'after': len(clean), 'rows_normalized': sum(a != b for a,b in zip(before, normalized)),
            'duplicates_removed': len(raw)-len(clean), 'ingredients_imputed': 0}
print(cleaning)
(OUT / 'cleaning.json').write_text(json.dumps(cleaning, indent=2), encoding='utf-8')
clean.to_json(OUT / 'clean_inputs.json', orient='records', force_ascii=False, indent=2)
''')
md('''## 3. Разделение для разработки и итоговой проверки

Разбиение закреплено до запросов: 8 блюд / 16 языковых примеров в каждой части.
Оба перевода одного блюда находятся в одной части. В каждой части — 4 блюда с
составом и 4 без состава. Это разработка промпта и итоговая оценка, а не обучение
весов LLM; отдельный train для этого эксперимента не нужен.

После разработки оба промпта оставлены без изменений, хеши зафиксированы в
`freeze.json`. Порядок simple/detailed чередуется. Одна попытка на условие,
автоматических повторов нет. Перегенерации выделены отдельно и не увеличивают
число первичных примеров. Неудачи не исключаются из сравнения.
''')
code('''groups = clean.groupby('split').group.apply(set)
assert groups['dev'].isdisjoint(groups['final'])
assert clean.groupby('group').split.nunique().max() == 1
dev_manifest = json.loads(read_evidence('results/dev-manifest.json'))
final_manifest = json.loads(read_evidence('results/final-manifest.json'))
freeze = json.loads(read_evidence('results/freeze.json'))
assert dev_manifest['fingerprints'] == final_manifest['fingerprints'] == freeze['fingerprints']
frozen_sources = json.loads(read_evidence('results/frozen-sources.json'))
assert all(hashlib.sha256(frozen_sources[f].encode()).hexdigest() == digest
           for f,digest in freeze['fingerprints'].items())
assert pd.Timestamp(freeze['frozenAt']) < pd.Timestamp(final_manifest['startedAt'])
display(clean.groupby(['split', 'language', 'completeness']).size().rename('n').to_frame())
clean[['id', 'group', 'split', 'language']].to_csv(OUT / 'split_manifest.csv', index=False)
balance = pd.crosstab([clean.split, clean.language], clean.completeness)
plt.figure(figsize=(7, 3)); sns.heatmap(balance, annot=True, fmt='d', cmap='Blues')
plt.title('2. Grouped development / final split'); savefig('02_split_balance')
plt.figure(figsize=(7, 3))
sns.countplot(data=clean, x='ingredient_count', hue='split')
plt.title('3. Number of supplied ingredients'); savefig('03_ingredients')
''')
md('''## 4. Промпты, входы и наблюдаемые результаты

Простой промпт просит привлекательное описание и JSON, передаёт те же блюдо,
язык, тон, ограничения и предыдущий ответ. Подробный — настоящий промпт сервера:
только заданные факты, без обещаний пользы, превосходных степеней и выдуманного
состава, с пояснением тона. Оба возвращают 4 канала и дополнительный вариант.
Выбор модели, JSON-режим, reasoning effort и таймаут одинаковые.

**X:** поля блюда, язык, тон, лимит и версия промпта. **Наблюдаемые y:** принятый
или отклонённый ответ, длина, задержка, токены и отдельная качественная оценка.
Сырые ответы, включая отклонённые сервером, хранятся полностью; это позволяет
увидеть ошибки, которые иначе скрыла бы валидация.

Токены взяты из `usage` реального ответа, а не оценены по длине текста.
Поля `prompt_tokens`, `completion_tokens`, `total_tokens` описаны в
[официальной API-документации](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).
Лимит 250 считается с пробелами. Для проверки поведения JS дополнительно
считаются UTF-16 code units. Время включает запрос и серверную проверку,
но для сравнения промптов не включает путь браузер → сервер; он измерен отдельно.
''')
code('''attempt_rows, text_rows = [], []
for r in records:
    call = r['calls'][0]
    response = call.get('response', {})
    usage = response.get('usage', {})
    content = (response.get('choices') or [{}])[0].get('message', {}).get('content')
    try: parsed = json.loads(content) if content else {}
    except json.JSONDecodeError: parsed = {}
    texts = {**parsed.get('texts', {}), 'variant': parsed.get('variant', '')}
    valid = set(texts) == {'yandex', 'wolt', 'website', 'print', 'variant'} and all(isinstance(v, str) and v.strip() for v in texts.values())
    lengths = [len(t.encode('utf-16-le'))//2 for t in texts.values() if isinstance(t,str)]
    row = dict(id=r['id'], input_id=r['input']['id'], group=r['input']['group'], split=r['phase'],
               strategy=r['strategy'], repetition=r['repetition'], language=r['input']['language'],
               completeness=r['input']['completeness'], tone=r['input']['tone'], accepted=r['accepted'],
               error=r.get('error',{}).get('code'), seconds=r['elapsedMs']/1000,
               provider_seconds=call['durationMs']/1000, http_status=call.get('httpStatus'),
               prompt_tokens=usage.get('prompt_tokens'), completion_tokens=usage.get('completion_tokens'),
               total_tokens=usage.get('total_tokens'), max_chars=max(lengths, default=0),
               raw_length_ok=bool(valid and max(lengths)<=r['input']['maxLength']),
               schema_ok=bool(valid), response_id=response.get('id'), raw_content=content,
               under_10_seconds=r['elapsedMs']<10000)
    attempt_rows.append(row)
    for channel, text in texts.items():
        text_rows.append(dict(id=r['id'], split=r['phase'], strategy=r['strategy'], repetition=r['repetition'],
                         language=r['input']['language'], channel=channel, text=text,
                         chars=len(text), js_chars=len(text.encode('utf-16-le'))//2))
attempts = pd.DataFrame(attempt_rows)
texts = pd.DataFrame(text_rows)
assert len(attempts) == 72 and not attempts.id.duplicated().any()
assert attempts.http_status.eq(200).all() and attempts.response_id.notna().all()
assert attempts.total_tokens.notna().all()
assert (attempts.prompt_tokens + attempts.completion_tokens == attempts.total_tokens).all()
primary = attempts.query('repetition == 0').copy()
assert len(primary) == 64
assert primary.groupby(['split','input_id']).strategy.nunique().eq(2).all()
attempts.to_csv(OUT / 'attempts.csv', index=False)
texts.to_csv(OUT / 'texts.csv', index=False)
for strategy in ['simple','detailed']:
    sample = next(r for r in records if r['strategy']==strategy)
    display(Markdown('**' + strategy + ' — system prompt:**'))
    print(sample['calls'][0]['request']['messages'][0]['content'])
''')
md('''## 5. EDA ответов: длина, время, токены и прохождение проверки

На графиках первичные ответы; перегенерации анализируются отдельно.
`accepted` означает, что ответ прошёл текущие серверные правила. Это не метрика
полной фактической точности: словарь не охватывает все ингредиенты и свойства,
а родственные слова иногда дают ложные срабатывания.
''')
code('''summary = primary.groupby(['split','strategy']).agg(
    n=('id','size'), accepted=('accepted','sum'), acceptance_rate=('accepted','mean'),
    raw_length_rate=('raw_length_ok','mean'), latency_mean_s=('seconds','mean'),
    latency_p95_s=('seconds',lambda s:s.quantile(.95)), latency_max_s=('seconds','max'),
    prompt_tokens_mean=('prompt_tokens','mean'), completion_tokens_mean=('completion_tokens','mean'),
    tokens_total=('total_tokens','sum')).reset_index()
display(summary.round(3))
summary.to_csv(OUT / 'summary.csv', index=False)
plt.figure(figsize=(8, 3))
sns.boxplot(data=primary, x='strategy', y='max_chars', hue='language')
plt.axhline(250, color='red', linestyle='--', label='250 character limit')
plt.title('4. Longest raw text per request (including rejected responses)')
savefig('04_lengths')
plt.figure(figsize=(8, 3))
sns.boxplot(data=primary, x='strategy', y='seconds', hue='split')
plt.axhline(10, color='red', linestyle='--')
plt.title('5. Generator latency, one sequential call at a time')
savefig('05_latency')
primary.groupby('strategy')[['prompt_tokens','completion_tokens']].mean().plot.bar(stacked=True, figsize=(7,3))
plt.ylabel('Mean tokens per request'); plt.xticks(rotation=0)
plt.title('6. Real provider token usage'); savefig('06_tokens')
plt.figure(figsize=(7, 3))
sns.barplot(data=summary, x='split', y='acceptance_rate', hue='strategy')
plt.ylim(0,1.05); plt.title('7. API acceptance, not factual accuracy')
savefig('07_acceptance')
paired = primary.pivot(index=['split','group','input_id'], columns='strategy', values=['accepted','seconds','total_tokens'])
assert not paired.isna().any().any()
print('Paired final examples:')
display(paired.loc['final'].head())
''')
md('''## 6. Качественная проверка, язык и тон

Codex прочитал сырые ответы для всех 72 попыток, включая отклонённые.
Оценка `pass`: не найдено неподтверждённого факта; `review`: неоднозначная
формулировка; `fail`: конкретное неподтверждённое утверждение. Это не независимая
разметка и не доказательство отсутствия всех галлюцинаций. Хеш связывает каждую
оценку с точным прочитанным ответом.

У подробного промпта обнаружены «лёгкий» салат, подразумеваемая последовательность
приготовления и «небольшое количество соли» без заданного количества. Он часто
выдаёт только название при нехватке данных: это безопаснее догадки, но язык и тон
такого короткого ответа оценить невозможно. Запрошенные тона нередко сводятся к
одному нейтральному стилю. Простые промпты добавляют состав и сенсорные свойства.

Известные ограничения валидатора: RU «лапшой» не покрывается правилом «лапша»;
наименование ингредиента «овощи» может ложно считаться новым фактом; KK слово
«жеңілдіктің» о лёгкости пересекается со стоп-словом «жеңілдік» (скидка).
Не следует интерпретировать каждое отклонение как истинную галлюцинацию.
''')
code('''review = pd.read_csv(StringIO(read_evidence('results/qualitative_review.csv')))
for row in review.itertuples():
    content = attempts.loc[attempts.id.eq(row.id),'raw_content'].iloc[0]
    assert hashlib.sha256(content.encode()).hexdigest() == row.content_sha256
reviewed = primary.merge(review[['id','groundedness','language_review','tone_review','note']], on='id', validate='one_to_one')
display(pd.crosstab([reviewed.split,reviewed.strategy],reviewed.groundedness))
display(reviewed.query('strategy == "detailed" and groundedness != "pass"')[['split','input_id','groundedness','note']])
display(pd.crosstab(reviewed.strategy,reviewed.language_review))
reviewed.to_csv(OUT / 'reviewed_primary.csv', index=False)
counts = pd.crosstab(reviewed.strategy, reviewed.groundedness).reindex(columns=['pass','review','fail'], fill_value=0)
counts.plot.bar(stacked=True, figsize=(7,3), color=['#42836d','#dbb14e','#bf6a60'])
plt.xticks(rotation=0); plt.ylabel('Requests'); plt.title('8. AI-assisted qualitative audit; not human ground truth')
savefig('08_qualitative_review')
''')
md('''## 7. Перегенерация и проверка сайта

Для двух блюд каждой части (с составом и без), на обоих языках, передавался
предыдущий результат. Сравнивается точный текст Яндекс Еды; это минимальная
проверка изменения, а не мера смыслового разнообразия.

Браузерная проверка использует собранный фронтенд и настоящий маршрут Express.
Наблюдатель сохраняет ответ `fetch`, не заменяя его. Проверены ID ответа,
токены, совпадение всех четырёх текстов с API и видимого текста карточки.
Первый браузерный запуск успешно проверил три живых ответа, затем остановился
из-за неверного селектора уведомления в тесте (`alert` вместо `status`).
Этот результат сохранён; отдельно повторены только проверки ошибок с исправленным
селектором, без новых платных запросов.

Недоступность и таймаут воспроизведены **контролируемым локальным HTTP-сервером**.
Эти искусственные сбои не считаются живыми ответами LLM. Сайт показывает ошибку,
а новая генерация и шаблонная подмена не появляются.
''')
code('''regen = attempts.query('repetition == 1').copy()
regen['different_yandex'] = [
    json.loads(row.raw_content)['texts']['yandex'].strip() !=
    json.loads(attempts.loc[attempts.input_id.eq(row.input_id) & attempts.strategy.eq('detailed') & attempts.repetition.eq(0), 'raw_content'].iloc[0])['texts']['yandex'].strip()
    for row in regen.itertuples()]
display(regen[['split','input_id','accepted','different_yandex','error','seconds']])
browser = json.loads(read_evidence('results/browser.json'))
faults = json.loads(read_evidence('results/browser-faults.json'))
contract = json.loads(read_evidence('results/contract.json'))
assert len(browser['live']) == 3
assert all(item['visibleMatchesProvider'] for item in browser['live'])
assert faults['passed'] and len(faults['injectedFaults']) == 2
assert all(item['generationsBefore'] == item['generationsAfter'] for item in faults['injectedFaults'])
assert all(item['accepted'] and item['allWithinLimit'] for item in contract['checks'])
display(pd.DataFrame([dict(language=x['language'], regeneration=x['regeneration'],
    seconds=x['renderElapsedMs']/1000, visible_matches=x['visibleMatchesProvider'],
    response_id=x['response']['providerResponseId'], tokens=x['response']['usage']['totalTokens']) for x in browser['live']]))
display(pd.DataFrame([dict(fault=x['fault'],http=x['status'],message=x['visibleError'],seconds=x['elapsedMs']/1000) for x in faults['injectedFaults']]))
display(pd.DataFrame([dict(language=x['input']['language'],tone=x['input']['tone'],limit=x['input']['maxLength'],
    accepted=x['accepted'],seconds=x['elapsedMs']/1000,text=x['response']['texts']['yandex']) for x in contract['checks']]))
regen.to_csv(OUT / 'regeneration.csv', index=False)
''')
md('''## 8. Итог по ТЗ и ограничения вывода

* **Настоящая модель → сайт:** подтверждено для трёх живых браузерных запросов.
* **RU/KK:** развёрнутые ответы и перевод RU→KK получены; для названия без текста
  язык не оценивается. Проверка носителем казахского остаётся необходимой.
* **Длина:** новые настройки всех каналов — 250. Проверены 250 и явный лимит 60.
  Сохранённые настройки существующих ресторанов не переписывались.
* **Факты:** подробный промпт заметно осторожнее, но полного соответствия нет:
  обнаружены неподтверждённые свойства и количество соли. Серверный словарь неполон.
* **Перегенерация:** 6 из 8 попыток дали другой текст. Два повтора KK отклонены
  с понятной ошибкой; требование «всегда другой готовый вариант» не выполнено.
* **Тон:** запрет явных обещаний пользы и превосходных степеней соблюдён в прочитанных
  подробных ответах; различимость трёх тонов не подтверждена, стиль часто одинаков.
* **Ошибки:** HTTP 503 провайдера и таймаут превращаются в понятные сообщения,
  без подмены результатом шаблона. Проверка сбоя выполнена fault injection.
* **10 секунд:** наблюдаемое время всех вызовов и трёх отображений меньше 10 секунд.
  Это результат малой последовательной выборки, не нагрузочный SLA. Таймаут
  ограничивает ожидание, но не гарантирует успешный ответ под нагрузкой.

Требуется редакторская оценка RU/KK, более точная проверка фактов и работа с
перегенерацией коротких описаний. Не подгоняем эти исправления по финальной выборке:
следующий вариант требует нового holdout. Независимые единицы здесь — блюда,
а не пять текстов одного ответа и не два перевода одного блюда.
''')
code('''all_usage = []
for r in records:
    all_usage += [c['response']['usage'] for c in r['calls'] if c.get('response',{}).get('usage')]
smoke = [json.loads(line) for line in read_evidence('results/smoke.jsonl').splitlines() if line]
for r in smoke:
    all_usage += [c['response']['usage'] for c in r['calls'] if c.get('response',{}).get('usage')]
for evidence in [browser, contract]:
    all_usage += [c['response']['usage'] for c in evidence['calls'] if c.get('response',{}).get('usage')]
totals = {key:sum(u[key] for u in all_usage) for key in ['prompt_tokens','completion_tokens','total_tokens']}
result = dict(comparison_attempts=len(attempts), real_calls_with_usage=len(all_usage), tokens=totals,
    primary=summary.to_dict('records'), regeneration_attempts=len(regen), regeneration_different=int(regen.different_yandex.sum()),
    max_comparison_seconds=float(attempts.seconds.max()), browser_visible_matches=3,
    raw_length_compliant=int(primary.raw_length_ok.sum()), qualitative_human_verified=False)
(OUT / 'metrics.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(result, ensure_ascii=False, indent=2))
print('Artifacts:', OUT)
''')
md('''## 9. Как повторить живой эксперимент

Полный код находится в репозитории, в `experiments/llm`. Node запускается из корня
приложения, где лежит `.env`. Секреты не записываются в Notebook или журналы.
Настройки: `LLM_PROVIDER=openai-compatible`, `LLM_MODEL=gpt-5.6-luna`,
`LLM_REASONING_EFFORT=none`, `LLM_TIMEOUT_MS=8500`, свой `LLM_API_KEY`.

1. Установить зависимости: `npm ci`; Python — из `experiments/llm/requirements.txt`.
2. Сохранить существующую папку `experiments/llm/results` под другим именем:
   скрипты намеренно отказываются перезаписывать измерения.
3. `node experiments/llm/run.mjs smoke`
4. `node experiments/llm/run.mjs dev`
5. `python experiments/llm/freeze.py`
6. `node experiments/llm/run.mjs final`
7. `npm run build`, затем `node experiments/llm/browser.mjs` и
   `node experiments/llm/browser.mjs --faults-only` и `node experiments/llm/contract.mjs`.
8. Качественную разметку сделать заново: старые оценки действуют только для
   старых SHA-256 ответов. Не переносить выводы по ID блюда на новые ответы.

Этот Notebook фиксирует конкретный выполненный прогон. Для нового прогона нужно
обновить разметку и собрать новый Notebook, сохранив старые материалы.
Текст и задержка не обязаны повторяться побайтно: генерация стохастична, сеть и
версия модели могут меняться. Нагрузка здесь последовательная, регион и кэш
провайдера не контролировались. Полные raw JSON позволяют независимо пересчитать
все численные показатели. Тарифы не зафиксированы; токены не выдаются за стоимость.
''')
nb = nbf.v4.new_notebook(cells=cells, metadata={
    'kernelspec': {'name':'python3','display_name':'Python 3','language':'python'},
    'language_info': {'name':'python','version':'3.10'}})
nbf.write(nb, root / 'MenuMind_LLM_evaluation.ipynb')
print('Built self-contained notebook; execute it before submitting.')
