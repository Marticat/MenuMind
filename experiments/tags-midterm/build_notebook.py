"""Build a self-contained notebook; audit cells preserve the project's original cleaning."""
from pathlib import Path
import json, textwrap
import nbformat as nbf
from document_text import NOTEBOOK_SECTIONS

ROOT = Path(__file__).resolve().parent
audit = json.loads((ROOT/'audit_cells.json').read_text(encoding='utf-8'))
cells = []
def md(s): cells.append(nbf.v4.new_markdown_cell(textwrap.dedent(s).strip()))
def code(s): cells.append(nbf.v4.new_code_cell(textwrap.dedent(s).strip()))

md(NOTEBOOK_SECTIONS[0])
code('''
import sys, subprocess, importlib.metadata as metadata
PINS = {'numpy':'2.2.6','pandas':'2.3.3','scipy':'1.15.3','scikit-learn':'1.7.2',
        'matplotlib':'3.10.9','seaborn':'0.13.2','joblib':'1.6.0'}
missing = []
for package, version in PINS.items():
    try: metadata.version(package)
    except metadata.PackageNotFoundError: missing.append(f'{package}=={version}')
if missing: subprocess.check_call([sys.executable,'-m','pip','install',*missing])
print('Python:',sys.version)
print('Фактические версии:',{p:metadata.version(p) for p in PINS})
''')
code(audit['2'].replace("['figures', 'tables', 'data']", "['figures', 'tables', 'data', 'models']"))
code(audit['3'])
md(NOTEBOOK_SECTIONS[1])
code(audit['5'])
md(NOTEBOOK_SECTIONS[2])
code(audit['7'])
code(audit['8'])
clean_code = audit['11'].replace("(~clean.desc_missing) & clean.date.notna()", "clean.categories.str.len().gt(0) & clean.date.notna()")
clean_code = clean_code.replace("np.where(clean.desc_missing, 'missing_description', np.where(clean.date.isna(), 'missing_date', ''))", "np.where(clean.categories.str.len().eq(0), 'missing_categories', np.where(clean.date.isna(), 'missing_date', ''))")
code(clean_code)
code(audit['12'])
md(NOTEBOOK_SECTIONS[3])
code('''
TAG_MAP = {
 'beef': ['beef','beef tenderloin','ground beef','beef rib','beef shank'],
 'chicken': ['chicken'],
 'lamb': ['lamb','lamb shank','lamb chop','ground lamb','rack of lamb'],
 'fish': ['fish','salmon','tuna','swordfish'],
 'mushrooms': ['mushroom'],
 'rice': ['rice','brown rice','wild rice'],
 'vegetables': ['vegetable','root vegetable'],
 'roasted': ['roast','bake'],
 'braised': ['braise','stew'],
 'grilled': ['grill','grill/barbecue'],
}
LABELS = list(TAG_MAP)
tag_catalog = pd.DataFrame([{'tag':tag,'source_categories':'; '.join(values),
    'kind':'technique' if tag in ['roasted','braised','grilled'] else 'ingredient'}
    for tag, values in TAG_MAP.items()])
table(tag_catalog, 'tag_catalog')
(ROOT/'tag_catalog.json').write_text(json.dumps(TAG_MAP,ensure_ascii=False,indent=2),encoding='utf-8')
def labels_for(df):
    return np.array([[int(bool(set(xs)&set(TAG_MAP[tag]))) for tag in LABELS]
                     for xs in df.categories],dtype=np.int8)
def text_for(df):
    return (df.title + ' . ' + df.ingredients.map(' . '.join)).tolist()
''')
md(NOTEBOOK_SECTIONS[4])
code(audit['14'])
code('''
ys = {name:labels_for(df) for name,df in parts.items()}
xs = {name:text_for(df) for name,df in parts.items()}
for name, df in parts.items():
    pd.DataFrame(ys[name],columns=LABELS,index=df.source_id).to_csv(ART/'data'/f'y_{name}.csv')
    df[['source_id','title','ingredients']].to_json(ART/'data'/f'X_{name}.jsonl',orient='records',lines=True,force_ascii=False)
support = pd.DataFrame({name:y.sum(axis=0) for name,y in ys.items()},index=LABELS)
table(support.reset_index(names='tag'),'label_support')
assert ((ys['train'].sum(axis=0)>0)&(ys['train'].sum(axis=0)<len(train))).all()
''')
md(NOTEBOOK_SECTIONS[5])
code('''
q=quality.sort_values('missing_pct')
plt.figure(figsize=(9,4)); plt.barh(q.field,q.missing_pct,color='#167D8D')
plt.title('Пропуски в исходном корпусе'); plt.xlabel('Доля записей, %'); plt.ylabel('Поле')
savefig('01_missing')
print(f'В исходных данных отсутствует {raw.desc.isna().mean():.1%} описаний. При известных категориях эти строки можно оставить для обучения тегам.')
''')
code('''
freq=pd.Series(ys['train'].mean(axis=0),index=LABELS).sort_values()
plt.figure(figsize=(9,4)); (100*freq).plot.barh(color='#167D8D')
plt.title('Частоты целевых тегов на train'); plt.xlabel('Доля рецептов, %'); plt.ylabel('Тег')
savefig('02_tag_frequency')
print(f'На обучении частота тега {freq.index[-1]}={freq.iloc[-1]:.1%}, {freq.index[0]}={freq.iloc[0]:.1%}. Из-за этой разницы результат по частым тегам может скрыть ошибки редких, поэтому считаем обе F1-метрики.')
''')
code('''
plt.figure(figsize=(9,4)); plt.hist(train.n_ingredients,bins=range(0,int(train.n_ingredients.max())+2),color='#167D8D')
plt.title('Размер состава на train'); plt.xlabel('Строк ингредиентов'); plt.ylabel('Рецептов')
savefig('03_ingredients')
print(f'Медиана числа строк состава: {train.n_ingredients.median():.0f}, без состава {train.n_ingredients.eq(0).sum()} записей. Отдельная модель по названию позволит проверить сценарий без состава.')
''')
code('''
cardinality=ys['train'].sum(axis=1)
plt.figure(figsize=(9,4)); plt.hist(cardinality,bins=np.arange(-.5,len(LABELS)+1.5),color='#167D8D')
plt.title('Число целевых тегов у одного рецепта'); plt.xlabel('Количество тегов из словаря'); plt.ylabel('Рецептов')
savefig('04_cardinality')
print(f'Из обучающих записей {(cardinality==0).mean():.1%} не имеют ни одного из выбранных тегов; {(cardinality>1).mean():.1%} имеют несколько. Поэтому число предсказанных тегов не фиксируем.')
''')
code('''
y=ys['train'].astype(float); co=y.T@y; denom=np.maximum(np.diag(co)[:,None],1)
plt.figure(figsize=(9,6)); sns.heatmap(co/denom,xticklabels=LABELS,yticklabels=LABELS,cmap='Blues',vmin=0,vmax=1,cbar_kws={'label':'P(тег столбца | тег строки)'})
plt.title('Совместная встречаемость тегов на train'); plt.xlabel('Сопутствующий тег'); plt.ylabel('Известный тег')
savefig('05_cooccurrence')
masked=co/denom; np.fill_diagonal(masked,-1); i,j=np.unravel_index(masked.argmax(),masked.shape)
print(f'Самая высокая условная частота вне диагонали: P({LABELS[j]} | {LABELS[i]})={masked[i,j]:.1%}. Это показывает, какие теги часто встречаются вместе; причины такой связи здесь не проверяются.')
''')
code('''
counts=train.groupby('year').size()
plt.figure(figsize=(9,4)); counts.plot.bar(color='#167D8D')
plt.title('Даты записей в train'); plt.xlabel('Год метки записи'); plt.ylabel('Рецептов')
savefig('06_dates')
peak=train.date.dt.floor('D').value_counts().iloc[0]/len(train)
print(f'На самую частую дату приходится {peak:.1%} train; вероятен пакетный импорт. Эти даты не описывают сезонность спроса.')
outliers=[]
for field in numeric_fields+['n_ingredients','desc_chars']:
    s=train[field].dropna(); q1,q3=s.quantile([.25,.75]); lo=q1-1.5*(q3-q1); hi=q3+1.5*(q3-q1)
    outliers.append({'field':field,'lower':lo,'upper':hi,'outliers_n':int(((s<lo)|(s>hi)).sum()),'n':len(s)})
table(pd.DataFrame(outliers),'train_outliers')
print('Выбросы не удаляем автоматически: нутриенты не входят в X, а большие значения могут относиться к нескольким порциям.')
''')
code('''
label_relation=train[['n_ingredients']].copy(); label_relation['tag_count']=cardinality
plt.figure(figsize=(9,4)); sns.boxplot(data=label_relation,x='tag_count',y='n_ingredients',color='#8BC8CB',showfliers=False)
plt.title('Размер состава и количество целевых тегов'); plt.xlabel('Целевых тегов'); plt.ylabel('Строк ингредиентов (выбросы скрыты только на графике)')
savefig('07_feature_target')
corr=label_relation.corr(method='spearman').iloc[0,1]
print(f'Коэффициент Spearman между размером состава и числом тегов = {corr:.3f}; длина состава сама по себе не определяет семантическую категорию.')
''')
md(NOTEBOOK_SECTIONS[6])
code(r'''
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.multiclass import OneVsRestClassifier
from sklearn.pipeline import Pipeline
from sklearn.metrics import f1_score, average_precision_score, hamming_loss, accuracy_score, precision_recall_fscore_support
import joblib

PATTERNS={
 'beef':r'\b(beef|steak)\b','chicken':r'\bchicken\b','lamb':r'\blamb\b',
 'fish':r'\b(fish|salmon|tuna|swordfish|cod|halibut|trout)\b',
 'mushrooms':r'\b(mushrooms?|shiitake|porcini)\b','rice':r'\brice\b',
 'vegetables':r'\b(vegetables?|carrots?|tomatoes?|pumpkin|zucchini|broccoli)\b',
 'roasted':r'\b(roast\w*|bak\w*)\b','braised':r'\b(brais\w*|stew\w*)\b','grilled':r'\b(grill\w*|barbecu\w*)\b'}
def rule_predict(texts):
    return np.array([[bool(re.search(PATTERNS[tag],s,re.I)) for tag in LABELS] for s in texts],dtype=int)
def evaluate(name,y,p,threshold=.5,pred=None):
    pred=(p>=threshold).astype(int) if pred is None else pred
    return {'model':name,'micro_f1':float(f1_score(y,pred,average='micro',zero_division=0)),
      'macro_f1':float(f1_score(y,pred,average='macro',zero_division=0)),
      'micro_ap':float(average_precision_score(y,p,average='micro')),
      'hamming_loss':float(hamming_loss(y,pred)), 'exact_match':float(accuracy_score(y,pred))}

validation_rows=[]; fitted={}
for mode in ['title_and_ingredients','title_only']:
    tr=xs['train'] if mode=='title_and_ingredients' else train.title.tolist()
    va=xs['validation'] if mode=='title_and_ingredients' else val.title.tolist()
    best=None
    for C in [.5,2.]:
        pipeline=Pipeline([('tfidf',TfidfVectorizer(ngram_range=(1,2),min_df=2,max_features=20000,sublinear_tf=True)),
          ('classifier',OneVsRestClassifier(LogisticRegression(C=C,solver='liblinear',max_iter=1000,random_state=SEED)))])
        started=time.perf_counter(); pipeline.fit(tr,ys['train']); elapsed=time.perf_counter()-started
        p=pipeline.predict_proba(va)
        for threshold in [.2,.35,.5]:
            result=evaluate(mode,ys['validation'],p,threshold)
            validation_rows.append({**result,'C':C,'threshold':threshold,'fit_seconds':elapsed})
            if best is None or result['micro_f1']>best['score']:
                best={'pipeline':pipeline,'C':C,'threshold':threshold,'score':result['micro_f1']}
    fitted[mode]=best
table(pd.DataFrame(validation_rows),'validation_results')
prevalence=ys['train'].mean(axis=0)
frequency_p=np.tile(prevalence,(len(val),1))
frequency_threshold=max([.05,.1,.2,.35,.5],key=lambda t:evaluate('frequency',ys['validation'],frequency_p,t)['micro_f1'])
print('Порог частотного метода:',frequency_threshold)
''')
md(NOTEBOOK_SECTIONS[7])
code('''
results=[]; probabilities={}; predictions={}
for mode,best in fitted.items():
    texts=xs['test'] if mode=='title_and_ingredients' else test.title.tolist()
    probabilities[mode]=best['pipeline'].predict_proba(texts)
    predictions[mode]=(probabilities[mode]>=best['threshold']).astype(int)
    results.append(evaluate(mode,ys['test'],probabilities[mode],best['threshold']))
probabilities['frequency']=np.tile(prevalence,(len(test),1))
predictions['frequency']=(probabilities['frequency']>=frequency_threshold).astype(int)
results.append(evaluate('frequency',ys['test'],probabilities['frequency'],frequency_threshold))
predictions['dictionary']=rule_predict(xs['test']); probabilities['dictionary']=predictions['dictionary'].astype(float)
results.append(evaluate('dictionary',ys['test'],probabilities['dictionary']))
result_df=pd.DataFrame(results); table(result_df,'test_metrics')
selected=fitted['title_and_ingredients']
bundle={'pipeline':selected['pipeline'],'threshold':selected['threshold'],'labels':LABELS,
        'tag_map':TAG_MAP,'features':['title','ingredients'],'language':'en',
        'task':'publisher recipe tags; not description effectiveness','raw_sha256':EXPECTED_SHA}
joblib.dump(bundle,ART/'models/tag_classifier.joblib')
for mode in fitted:
    print(mode,'C=',fitted[mode]['C'],'threshold=',fitted[mode]['threshold'])
plt.figure(figsize=(9,4)); result_df.set_index('model')[['micro_f1','macro_f1']].plot.bar(ax=plt.gca(),color=['#167D8D','#EBA55D'])
plt.title('Качество определения тегов на test'); plt.xlabel('Метод'); plt.ylabel('F1'); plt.ylim(0,1); plt.xticks(rotation=15)
plt.legend(['micro-F1','macro-F1']); savefig('08_models')
precision,recall,fscore,count=precision_recall_fscore_support(ys['test'],predictions['title_and_ingredients'],zero_division=0)
per_label=pd.DataFrame({'tag':LABELS,'precision':precision,'recall':recall,'f1':fscore,'support':count})
table(per_label,'per_label_metrics')
plt.figure(figsize=(9,4)); plt.barh(LABELS,fscore,color='#167D8D'); plt.xlim(0,1)
plt.title('F1 отдельных тегов на test'); plt.xlabel('F1'); plt.ylabel('Тег'); savefig('09_per_tag')
''')
code('''
# Парный bootstrap по рецептам: одинаковые индексы для обоих методов.
# Интервал условен на одном fit и не учитывает вариативность обучения.
ytest=ys['test']; learned=predictions['title_and_ingredients']; base=predictions['frequency']
def contributions(pred):
    return np.column_stack(((pred*ytest).sum(axis=1), (pred*(1-ytest)).sum(axis=1), ((1-pred)*ytest).sum(axis=1)))
a,b=contributions(learned),contributions(base)
def micro_from(v):
    tp,fp,fn=v; return 2*tp/max(2*tp+fp+fn,1)
rng=np.random.default_rng(SEED); delta=[]
for _ in range(1000):
    idx=rng.integers(0,len(test),len(test)); delta.append(micro_from(a[idx].sum(axis=0))-micro_from(b[idx].sum(axis=0)))
ci=np.quantile(delta,[.025,.975]).tolist()
errors=[]
for pos,(_,row) in enumerate(test.iterrows()):
    wrong=np.flatnonzero(learned[pos]!=ytest[pos])
    if len(wrong):
        errors.append({'source_id':int(row.source_id),'title':row.title,'ingredients':row.ingredients,
          'true_tags':[LABELS[i] for i in np.flatnonzero(ytest[pos])],
          'predicted_tags':[LABELS[i] for i in np.flatnonzero(learned[pos])],
          'wrong_tags':[LABELS[i] for i in wrong],'error_count':len(wrong)})
errors_df=pd.DataFrame(errors).sort_values(['error_count','source_id'],ascending=[False,True])
errors_df.to_csv(ART/'tables/error_examples.csv',index=False,encoding='utf-8-sig')
display(errors_df.head(8))
pd.DataFrame({'source_id':test.source_id,'true_tags':[[LABELS[i] for i in np.flatnonzero(row)] for row in ytest],
              'predicted_tags':[[LABELS[i] for i in np.flatnonzero(row)] for row in learned]}).to_csv(ART/'tables/test_predictions.csv',index=False,encoding='utf-8-sig')
best_tag=per_label.sort_values('f1',ascending=False).iloc[0]; worst_tag=per_label.sort_values('f1').iloc[0]
by=result_df.set_index('model'); gain=float(by.loc['title_and_ingredients','micro_f1']-by.loc['frequency','micro_f1'])
title_loss=float(by.loc['title_and_ingredients','micro_f1']-by.loc['title_only','micro_f1'])
observations=[
 f'RQ1: {len(raw)} исходных → {len(clean)} после очистки → {len(supervised)} с категориями и датой. Полных дубликатов {exact_duplicates}.',
 f'RQ1: {raw.desc.isna().mean():.1%} исходных desc отсутствуют; они не нужны для target=категории. Частоты тегов train: {freq.iloc[0]:.1%}–{freq.iloc[-1]:.1%}.',
 f'RQ2: micro-F1 обученного метода {by.loc["title_and_ingredients","micro_f1"]:.3f}, частотного {by.loc["frequency","micro_f1"]:.3f}, словаря {by.loc["dictionary","micro_f1"]:.3f}.',
 f'H1: Δmicro-F1={gain:.3f}; 95% bootstrap [{ci[0]:.3f}; {ci[1]:.3f}]. Вывод относится к категориям этого корпуса.',
 f'RQ3: title-only micro-F1={by.loc["title_only","micro_f1"]:.3f}; разность full−title={title_loss:.3f}.',
 f'Лучший тег {best_tag.tag}: F1={best_tag.f1:.3f}; слабейший {worst_tag.tag}: F1={worst_tag.f1:.3f}. Редкость, неоднозначность и отсутствие метода в X затрудняют часть меток.',
 'Следующий эксперимент: ручная разметка тегов упоминаний на независимых RU/KK-описаниях. Для эффективности нужны реальные показы и реакция, а затем рандомизированное сравнение выдачи.'
]
for item in observations: display(Markdown('- '+item))
metrics={'raw_rows':len(raw),'raw_columns':len(raw.columns),'raw_bytes':len(payload),'raw_sha256':EXPECTED_SHA,
 'exact_duplicates':exact_duplicates,'clean_rows':len(clean),'labelled_rows':len(supervised),
 'missing_desc':int(raw.desc.isna().sum()),'split':split_summary.to_dict('records'),
 'tag_count':len(LABELS),'test':results,'selected_C':selected['C'],'selected_threshold':selected['threshold'],
 'micro_f1_gain_over_frequency':gain,'gain_ci95':ci,'full_minus_title':title_loss,
 'observations':observations,'best_tag':best_tag.to_dict(),'worst_tag':worst_tag.to_dict(),
 'peak_day_share_train':float(peak),'zero_label_share_train':float((cardinality==0).mean()),
 'package_versions':{p:metadata.version(p) for p in PINS},'python':platform.python_version(),
 'real_conversion_data':False,'scope':'EN publisher-tag baseline; RU/KK and business lift unverified'}
(ART/'metrics.json').write_text(json.dumps(metrics,ensure_ascii=False,indent=2),encoding='utf-8')
print('Сохранены реальные результаты обучения и модель:',ART/'models/tag_classifier.joblib')
''')
md(NOTEBOOK_SECTIONS[8])
nb=nbf.v4.new_notebook(cells=cells,metadata={'kernelspec':{'display_name':'Python 3','language':'python','name':'python3'}})
nbf.write(nb,ROOT/'MenuMind_tags.ipynb')
print('Built',len(cells),'cells')
