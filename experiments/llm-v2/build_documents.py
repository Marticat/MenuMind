"""Generate a report and eight-slide deck from the executed notebook metrics."""
from pathlib import Path
from html import escape
import json, textwrap
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from docx import Document
from docx.shared import Pt as DPt
from reportlab.pdfgen import canvas
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from matplotlib import font_manager

root=Path(__file__).resolve().parent
m=json.loads((root/'analysis/metrics.json').read_text(encoding='utf-8'))
by={r['strategy']:r for r in m['final']}; d=by['detailed']; s=by['simple']
font=font_manager.findfont('DejaVu Sans')
pdfmetrics.registerFont(TTFont('Body',font))
pdfmetrics.registerFont(TTFont('Bold',font_manager.findfont(font_manager.FontProperties(family='DejaVu Sans',weight='bold'))))
authors='Adilzhan Kurmet · Nursultan Tolegenov · Zeiin Issakulov'
title='MenuMind — проверка генерации описаний RU/KK'
sections=[
 ('Цель и постановка', 'Разработан веб-сервис генерации описаний блюда для Яндекс Еды, Wolt, сайта и печати. Вход — название, категория, состав, метод, язык, тон и лимит. Проверяем, помогает ли подробный промпт соблюдать ограничения лучше простого, и какова цена одного логического запроса. Использована настоящая gpt-5.6-luna через API; веса модели не обучались.'),
 ('Данные и метод', 'Авторский acceptance-набор: 48 уникальных примеров, 24 блюда на RU/KK. 32 ранее просмотренных примера используются для разработки; 16 примеров восьми новых блюд — только для итоговой проверки. Переводы одного блюда не пересекают части. В объединённом источнике 54 строки: после проверки совпадения фактов удалены 6 повторов. Пропуски состава и метода намеренные; данные не дополняются догадками. Notebook содержит загрузку, аудит, очистку, EDA и 8 графиков.'),
 ('Реализация и воспроизводимость', 'React → Express → промпт → LLM → проверка → SQLite. Добавлены проверки неуказанных количеств, свойств и ряда ингредиентов; конкретизированы три тона. При отказе валидации или повторе допускается одна корректирующая попытка в общем бюджете 8,5 секунды. Учитываются токены обеих попыток. Код и промпты зафиксированы до holdout; все ответы, ошибки, request ID и usage сохранены. Самостоятельный Notebook повторяет анализ без ключа и соседних файлов.'),
 ('Результаты', f'Подробный промпт: {int(d["accepted"])}/16 первичных ответов приняты с первой попытки; простой: 0/16 с первой попытки, {int(s["accepted"])}/16 после разрешённого исправления. Это проверка серверных ограничений, не полная оценка точности. Перегенерация изменила все четыре канала в {m["regeneration_changed"]}/{m["final_regenerations"]} случаях. На одном блюде получены разные формулировки трёх тонов на обоих языках. Среднее время подробного запроса — {d["mean_s"]:.2f} с, простого с исправлением — {s["mean_s"]:.2f} с. Максимум основного эксперимента — {m["final_max_seconds"]:.3f} с.'),
 ('Сайт и обработка ошибок', 'Браузерная проверка подтвердила совпадение текста провайдера, JSON API и видимой карточки для RU, перегенерации RU и KK. HTTP 503 и таймаут проверены локальной инъекцией сбоя: понятное сообщение, без шаблонной подмены и новой записи. Лимит по умолчанию — 250 символов для новых профилей. При дополнительном лимите 60 один RU-запрос после исправления оставался слишком длинным и был отклонён; остальные три дополнительные проверки API успешны.'),
 ('Стоимость', f'По публичному тарифу модели [1] на 07.10.2026: $0,20/млн входных, $0,02/млн кэшированных входных, $0,25/млн записи кэша, $1,20/млн выходных токенов. Суммируем стоимость всех попыток и умножаем среднее на 1 000. Подробный первичный запрос: ${d["usd_per_1000"]:.3f}/1 000; простой с исправлением: ${s["usd_per_1000"]:.3f}/1 000; перегенерация: ${m["regeneration_usd_per_1000"]:.3f}/1 000. Один запрос возвращает 4 канала и вариант. Всего в этой итерации {m["total_model_calls"]} реальных вызовов, {m["total_tokens"]:,} токенов, оценка ${m["total_estimated_usd"]:.4f}. Хостинг, налоги и индивидуальный тариф не включены.'),
 ('Ограничения и интерпретация', 'Подробные финальные ответы не добавляли ингредиенты по прочтению Codex, но один ответ добавил «в бистро», хотя тип заведения не задавался. Он отмечен для редактора. Словарь не доказывает отсутствие всех галлюцинаций, а языковая естественность ещё не проверена человеком. Для RU/KK подготовлен лист рецензии. Восьми новых блюд недостаточно для широких выводов. Нагрузочный SLA и рост конверсии от LinUCB не измерялись. Полученные результаты подтверждают механику и пользу подробных инструкций в этой выборке, а не безошибочность модели.'),
 ('Материалы и источники', 'MenuMind_final.ipynb / .html; исходные входы и журналы в results; analysis/metrics.json, human_review.csv и графики; исходники эксперимента. [1] https://developers.openai.com/api/docs/models/gpt-5.6-luna — тариф и модель, проверено 07.10.2026. Предыдущая итерация сохранена отдельно в experiments/llm. Run All в Notebook не вызывает модель; новый live-прогон требует API-ключа и оплачивается отдельно.'),
]
doc=Document(); doc.add_heading(title,0); doc.add_paragraph('AAI-2602M · 7 октября 2026');doc.add_paragraph(authors)
for heading,body in sections:doc.add_heading(heading,level=1);doc.add_paragraph(body)
for style in ['Normal']:doc.styles[style].font.size=DPt(11)
doc.save(root/'MenuMind_report.docx')
styles={
 'title':ParagraphStyle('title',fontName='Bold',fontSize=16,leading=20,spaceAfter=9),
 'heading':ParagraphStyle('heading',fontName='Bold',fontSize=11.5,leading=15,spaceBefore=9,spaceAfter=4),
 'body':ParagraphStyle('body',fontName='Body',fontSize=10,leading=13.5,spaceAfter=5),
}
story=[Paragraph(escape(title),styles['title']),Paragraph('AAI-2602M · 07.10.2026<br/>'+escape(authors),styles['body'])]
for i,(heading,body) in enumerate(sections):
 if i==4:story.append(PageBreak())
 story += [Paragraph(escape(heading),styles['heading']),Paragraph(escape(body),styles['body'])]
SimpleDocTemplate(str(root/'MenuMind_report.pdf'),pagesize=A4,leftMargin=40,rightMargin=40,topMargin=35,bottomMargin=35).build(story)

slides=[
 dict(title='AI-powered dish descriptions',tag='MENUMIND / AAI-2602M',
      bullets=['Controlled generation in Russian and Kazakh','Live API verification and a reproducible prompt experiment',authors],
      note='Показываем работающий сервис и измеренный эксперимент. Не заявляем обучение LLM или доказанную конверсию.'),
 dict(title='The task: attractive, factual text',tag='01 / REQUIREMENTS',
      bullets=['Dish name + category + optional ingredients and method','Russian / Kazakh, three tones, default 250 characters','No invented ingredients, quantities or health claims','Regenerate, report errors clearly, respond within 10 seconds'],
      note='Пустой состав намеренно сохраняется пустым. Знакомое название не даёт права восстанавливать рецепт.'),
 dict(title='A working end-to-end service',tag='02 / IMPLEMENTATION',
      bullets=['React UI → Express API → prompt → real LLM → validation','SQLite stores recipes, generations and provider metadata','At most one repair call, within a shared 8.5-second budget','Browser checks: provider response = API response = visible text'],
      note='Во время проверки не было шаблонной подмены. Ошибки провайдера воспроизведены отдельно локальным fault injection.'),
 dict(title='A separate final evaluation',tag='03 / DATA & PROTOCOL',
      bullets=['48 authored examples: 24 dish groups × RU/KK','32 development examples; 16 final examples from 8 new dishes','Translations stay together; code frozen before held-out calls','Paired prompts, saved raw responses, tokens and elapsed time'],
      note='Финальные блюда не встречались в первой итерации. Это оценка промптов, а не train/test обучения весов.',image='02_split.png'),
 dict(title='Detailed prompts need fewer repairs',tag='04 / FINAL RESULTS',
      bullets=[f'Detailed: {int(d["first_pass"])}/16 first-pass; {int(d["accepted"])}/16 accepted',f'Simple: {int(s["first_pass"])}/16 first-pass; {int(s["accepted"])}/16 after repair','API acceptance is not proof of factual accuracy'],
      note='Обе ветки могли получить одно исправление. Поэтому разделены результат первой попытки и итог запроса.',image='06_acceptance.png'),
 dict(title='Regeneration, tone and remaining risk',tag='05 / QUALITY',
      bullets=[f'{m["regeneration_changed"]}/16 regenerations changed all four channel texts','Three distinguishable tone examples on the same dish, RU/KK','One unsupported venue claim: “in a bistro”','Human RU/KK review pending; one 60-character request rejected'],
      note='Не скрываем остаточную ошибку. Состав не выдуман в просмотренных подробных ответах, но общая точность не гарантирована. 60-символьный ответ не прошёл длину и не показан как успешный.'),
 dict(title='Measured latency and model cost',tag='06 / PERFORMANCE & COST',
      bullets=[f'Detailed: {d["mean_s"]:.2f}s mean; ${d["usd_per_1000"]:.3f} per 1,000 requests',f'Simple + repairs: {s["mean_s"]:.2f}s; ${s["usd_per_1000"]:.3f} per 1,000',f'Maximum final latency: {m["final_max_seconds"]:.3f}s','Public list price, 7 Oct 2026; hosting and taxes excluded'],
      note='Считаем все попытки по usage провайдера. Один запрос даёт четыре канала и вариант. Это оценка на малой последовательной выборке, не SLA.',image='07_cost.png'),
 dict(title='Reproducible submission',tag='07 / DELIVERABLES',
      bullets=['Executed Notebook + HTML: cleaning, EDA and eight figures','Full inputs, prompts, responses, usage and source snapshots','PDF report, editable slides and a human review worksheet','Run All reproduces analysis offline, without an API key'],
      note='Цель — управляемый генератор с измеренными ограничениями. Следующий шаг качества — редактор и носитель казахского; затем новая независимая выборка.'),
]
(root/'slides.json').write_text(json.dumps(slides,ensure_ascii=False,indent=2),encoding='utf-8')
prs=Presentation();prs.slide_width=Inches(13.333);prs.slide_height=Inches(7.5)
paper='F7F4EC'; ink='173D37'; muted='65726A'
def textbox(slide,x,y,w,h,text,size,color=ink,bold=False):
 box=slide.shapes.add_textbox(Inches(x),Inches(y),Inches(w),Inches(h));tf=box.text_frame;tf.word_wrap=True
 for i,line in enumerate(text.split('\n')):
  p=tf.paragraphs[0] if i==0 else tf.add_paragraph();p.text=line;p.font.name='Arial';p.font.size=Pt(size);p.font.bold=bold;p.font.color.rgb=RGBColor.from_string(color)
 return box
for i,data in enumerate(slides):
 slide=prs.slides.add_slide(prs.slide_layouts[6]);slide.background.fill.solid();slide.background.fill.fore_color.rgb=RGBColor.from_string(paper)
 textbox(slide,.65,.4,12,.35,data['tag'],12,muted,True)
 textbox(slide,.65,1.0,12,1.15,data['title'],34,bold=True)
 has_image='image' in data
 width=6 if has_image else 11.8
 for j,bullet in enumerate(data['bullets']):textbox(slide,.7,2.4+j*.84,width,.78,bullet,21 if has_image else 23)
 if has_image:slide.shapes.add_picture(str(root/'analysis/figures'/data['image']),Inches(7.0),Inches(2.55),width=Inches(5.6))
 textbox(slide,.65,7.0,11,.25,'MenuMind · Live LLM evaluation · 07 October 2026',10,muted)
 textbox(slide,12,7.0,.6,.25,f'{i+1:02}',10,muted)
 slide.notes_slide.notes_text_frame.text=data['note']+'\nPricing source: https://developers.openai.com/api/docs/models/gpt-5.6-luna'
prs.save(root/'MenuMind_presentation.pptx')
# PDF deck uses the same text and figure sources, suitable for sharing without PowerPoint.
pdf=canvas.Canvas(str(root/'MenuMind_presentation.pdf'),pagesize=(960,540))
for i,data in enumerate(slides):
 pdf.setFillColor(colors.HexColor('#'+paper));pdf.rect(0,0,960,540,fill=1,stroke=0)
 pdf.setFillColor(colors.HexColor('#'+muted));pdf.setFont('Bold',10);pdf.drawString(45,498,data['tag'])
 pdf.setFillColor(colors.HexColor('#'+ink));pdf.setFont('Bold',25);pdf.drawString(45,440,data['title'])
 width=48 if 'image' in data else 86
 y=365
 for bullet in data['bullets']:
  pdf.setFont('Body',15)
  for line in textwrap.wrap(bullet,width=width):pdf.drawString(49,y,line);y-=22
  y-=16
 if 'image' in data:pdf.drawImage(str(root/'analysis/figures'/data['image']),505,150,width=410,height=225,preserveAspectRatio=True,anchor='c')
 pdf.setFillColor(colors.HexColor('#'+muted));pdf.setFont('Body',9);pdf.drawString(45,28,'MenuMind · Live LLM evaluation · 07 October 2026');pdf.drawRightString(920,28,f'{i+1:02}')
 pdf.showPage()
pdf.save()
print('Built PDF/DOCX report and eight-slide PPTX/PDF deck from metrics.')
