"""Build a two-page report and matching editable PPTX/PDF, using measured results."""
from pathlib import Path
from html import escape
import json
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from docx import Document
from docx.shared import Pt as DPt, Inches as DInches
from reportlab.pdfgen import canvas
from reportlab.platypus import SimpleDocTemplate, Paragraph, PageBreak, Table, TableStyle
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from matplotlib import font_manager
from PIL import Image

ROOT=Path(__file__).resolve().parent; ART=ROOT/'artifacts'
m=json.loads((ART/'metrics.json').read_text(encoding='utf-8'))
by={r['model']:r for r in m['test']}; full=by['title_and_ingredients']; title_only=by['title_only']
labels={'title_and_ingredients':'Название + состав','title_only':'Только название','frequency':'Частоты train','dictionary':'Словарь'}
title='MenuMind: определение тегов для описаний блюд'
for name,weight in [('Body','normal'),('BodyBold','bold')]:
    pdfmetrics.registerFont(TTFont(name,font_manager.findfont(font_manager.FontProperties(family='DejaVu Sans',weight=weight))))
from document_text import report_sections, SPEAKER_NOTES
page1, page2 = report_sections(m)
sources=[
 '[1] Hugo Darwood. Epicurious, v2. https://www.kaggle.com/datasets/hugodarwood/epirecipes ; первоисточник: https://www.epicurious.com/',
 '[2] scikit-learn. Multilabel / OneVsRest. https://scikit-learn.org/stable/modules/multiclass.html',
 '[3] Li et al. A Contextual-Bandit Approach to Personalized News Article Recommendation (2010). https://arxiv.org/abs/1003.0146',
]
rows=[['Метод','micro-F1','macro-F1']]+[[labels[r['model']],f'{r["micro_f1"]:.3f}',f'{r["macro_f1"]:.3f}'] for r in m['test']]
styles={
 'title':ParagraphStyle('title',fontName='BodyBold',fontSize=15,leading=19,spaceAfter=7),
 'meta':ParagraphStyle('meta',fontName='Body',fontSize=8,leading=10,spaceAfter=7),
 'heading':ParagraphStyle('heading',fontName='BodyBold',fontSize=10,leading=13,spaceBefore=7,spaceAfter=3),
 'body':ParagraphStyle('body',fontName='Body',fontSize=9,leading=12,spaceAfter=4),
 'source':ParagraphStyle('source',fontName='Body',fontSize=7,leading=9,spaceAfter=3),
}
story=[Paragraph(escape(title),styles['title']),Paragraph('Исследовательский отчёт · 8 октября 2026 · EDA + Midterm',styles['meta'])]
def add_sections(sections):
    for heading,body in sections:
        story.extend([Paragraph(escape(heading),styles['heading']),Paragraph(escape(body),styles['body'])])
add_sections(page1); story.append(PageBreak()); add_sections(page2[:1])
table=Table(rows,colWidths=[260,100,100],hAlign='LEFT')
table.setStyle(TableStyle([('FONTNAME',(0,0),(-1,-1),'Body'),('FONTSIZE',(0,0),(-1,-1),8),
 ('BACKGROUND',(0,0),(-1,0),colors.HexColor('#173944')),('TEXTCOLOR',(0,0),(-1,0),colors.white),
 ('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.HexColor('#edf4f5'),colors.white]),
 ('TOPPADDING',(0,0),(-1,-1),4),('BOTTOMPADDING',(0,0),(-1,-1),4)]))
story.append(table); add_sections(page2[1:])
for s in sources: story.append(Paragraph(escape(s),styles['source']))
def footer(c,d):
    c.setFont('Body',8); c.drawString(40,25,'MenuMind · теги и персонализация'); c.drawRightString(A4[0]-40,25,str(d.page))
SimpleDocTemplate(str(ROOT/'MenuMind_report.pdf'),pagesize=A4,leftMargin=40,rightMargin=40,topMargin=34,bottomMargin=38).build(story,onFirstPage=footer,onLaterPages=footer)
doc=Document(); sec=doc.sections[0]; sec.top_margin=sec.bottom_margin=DInches(.55)
doc.styles['Normal'].font.name='Arial'; doc.styles['Normal'].font.size=DPt(9)
doc.styles['Normal'].paragraph_format.space_after=DPt(4)
doc.add_heading(title,0); doc.add_paragraph('Исследовательский отчёт · 8 октября 2026')
for heading,body in page1: doc.add_heading(heading,2); doc.add_paragraph(body)
doc.add_page_break()
for i,(heading,body) in enumerate(page2):
    doc.add_heading(heading,2); doc.add_paragraph(body)
    if i==0:
        t=doc.add_table(rows=0,cols=3); t.style='Light Shading Accent 1'
        for row in rows:
            for cell,value in zip(t.add_row().cells,row): cell.text=value
for s in sources:
    p=doc.add_paragraph(s)
    for r in p.runs:r.font.size=DPt(7)
doc.save(ROOT/'MenuMind_report.docx')

# One coordinate system generates editable slides and a matching PDF.
prs=Presentation(); prs.slide_width=Inches(13.333); prs.slide_height=Inches(7.5)
prs.core_properties.title=title
deck=canvas.Canvas(str(ROOT/'MenuMind_presentation.pdf'),pagesize=(960,540)); deck.setTitle(title)
NAVY='#132C37'; TEAL='#6AD5C2'; WHITE='#F7FAFB'; MUTED='#B6CAD1'; GOLD='#F0B566'
def rgb(c):return RGBColor.from_string(c.lstrip('#'))
def box(s,x,y,w,h,c):
    shape=s.shapes.add_shape(MSO_SHAPE.RECTANGLE,Inches(x),Inches(y),Inches(w),Inches(h))
    shape.fill.solid(); shape.fill.fore_color.rgb=rgb(c); shape.line.fill.background()
    deck.setFillColor(colors.HexColor(c)); deck.rect(x*72,540-(y+h)*72,w*72,h*72,fill=1,stroke=0)
def txt(s,text,x,y,w,h,size=22,c=WHITE,bold=False):
    shape=s.shapes.add_textbox(Inches(x),Inches(y),Inches(w),Inches(h)); tf=shape.text_frame
    tf.clear(); tf.word_wrap=True; tf.margin_left=tf.margin_right=tf.margin_top=tf.margin_bottom=0
    for i,line in enumerate(text.split('\n')):
        p=tf.paragraphs[0] if i==0 else tf.add_paragraph(); p.text=line
        p.font.name='Arial'; p.font.size=Pt(size); p.font.bold=bold; p.font.color.rgb=rgb(c); p.space_after=Pt(size*.16)
    style=ParagraphStyle('slide',fontName='BodyBold' if bold else 'Body',fontSize=size,leading=size*1.22,textColor=colors.HexColor(c))
    p=Paragraph(escape(text).replace('\n','<br/>'),style); _,height=p.wrap(w*72,h*72)
    if height>h*72+2:raise ValueError(f'Overflow: {text[:70]} {height}/{h*72}')
    p.drawOn(deck,x*72,540-y*72-height)
def image(s,path,x,y,w,h):
    iw,ih=Image.open(path).size; scale=min(w/iw,h/ih); aw,ah=iw*scale,ih*scale
    s.shapes.add_picture(str(path),Inches(x),Inches(y),width=Inches(aw),height=Inches(ah))
    deck.drawImage(str(path),x*72,540-(y+ah)*72,aw*72,ah*72,mask='auto')
def slide(i,heading):
    s=prs.slides.add_slide(prs.slide_layouts[6]);box(s,0,0,13.333,7.5,NAVY)
    box(s,.55,.5,.07,.3,TEAL);txt(s,'MENUMIND  /  EDA + MIDTERM',.8,.48,11,.35,12,TEAL,True)
    txt(s,heading,.8,1.05,11.8,1.05,29,WHITE,True)
    txt(s,f'8 октября 2026     {i:02d} / 07',.8,7.08,11,.25,10,MUTED)
    return s
notes=[]
def end(s,n):s.notes_slide.notes_text_frame.text=n;notes.append(n);deck.showPage()

s=slide(1,'Какие теги можно определить\nпо названию блюда?')
txt(s,'Что делает MenuMind',.8,2.5,5.5,.5,22,TEAL,True)
txt(s,'Сервис составляет описания\nна русском и казахском языках.\nЛимит: 250 символов.',.8,3.15,6,1.6,23)
box(s,7.15,2.5,5.35,3.55,'#204450')
txt(s,'Задача этой работы',7.45,2.8,4.75,.5,21,TEAL,True)
txt(s,'Определить 10 тегов\nпо названию\nи составу блюда.',7.45,3.55,4.75,1.7,25)
txt(s,'Гипотеза: обучение даст более высокий micro-F1, чем частоты тегов.',.8,6.35,11.7,.6,19,GOLD)
end(s, SPEAKER_NOTES[0])

s=slide(2,'Данные пришлось очистить от повторов')
txt(s,'Epicurious: 20 130 рецептов',.8,2.28,5.8,.5,23,TEAL,True)
txt(s,'1 834 полных дубликата\n33% описаний отсутствуют\n17 722 строки после очистки\n39 без категорий или даты',.8,3.1,5.7,2.35,22)
image(s,ART/'figures/02_tag_frequency.png',6.85,2.4,5.65,3.6)
txt(s,'Обучение: 12 383   ·   Валидация: 2 649   ·   Тест: 2 651',.8,6.1,11.8,.6,23,GOLD,True)
txt(s,'Даты записей 1996–2016; период сбора неизвестен. Англоязычный корпус.',.8,6.72,11.7,.3,12,MUTED)
end(s, SPEAKER_NOTES[1])

s=slide(3,'Что именно описывает тег')
box(s,.8,2.4,5.6,2.95,'#204450');box(s,6.8,2.4,5.7,2.95,'#204450')
txt(s,'В карточке блюда',1.08,2.68,5,.5,22,TEAL,True)
txt(s,'Курица, рис\nТеги: chicken, rice',1.08,3.45,5,1.2,24)
txt(s,'Варианты описания',7.08,2.68,5.1,.5,22,TEAL,True)
txt(s,'«Блюдо в меню» → нет упоминаний\n«Курица с рисом» → chicken, rice',7.08,3.45,5.1,1.35,20)
txt(s,'X = название + состав.  y = категории издателя → 10 тегов.',.8,5.75,11.8,.65,22,GOLD)
txt(s,'Для каждого тега сохраняем слова, на которых он основан.',.8,6.52,11.8,.5,17,MUTED)
end(s, SPEAKER_NOTES[2])

s=slide(4,'Начали с TF-IDF и логистической регрессии')
for i,(head,body) in enumerate([('TF-IDF','Слова и биграммы\nдо 20 000 признаков'),('Логистическая\nрегрессия','10 бинарных моделей\nOne-vs-Rest, L2'),('Порог','Выбран на валидации\nC = 2; порог = 0,35')]):
    x=.8+i*4;box(s,x,2.55,3.7,2.5,'#204450');txt(s,head,x+.23,2.85,3.24,.8,22,TEAL,True);txt(s,body,x+.23,3.9,3.24,.9,18)
txt(s,'Модель быстро обучается на CPU; вклад слов можно проверить.',.8,5.55,11.8,.7,22)
txt(s,'Сравнения: частотный метод, словарь и модель только по названию.',.8,6.4,11.8,.55,19,GOLD)
end(s, SPEAKER_NOTES[3])

s=slide(5,'Как оценивали предсказания')
blocks=[('micro-F1','Качество по всем тегам\nТочность и полнота вместе'),('macro-F1','F1 усредняется по тегам\nРедкие классы тоже влияют'),('Average precision','Качество ранжирования\nБез фиксированного порога'),('Hamming loss','Доля ошибочных индикаторов\nЧем меньше, тем лучше')]
for i,(head,body) in enumerate(blocks):
    x=.8+(i%2)*6.05;y=2.4+(i//2)*1.8;box(s,x,y,5.65,1.55,'#204450');txt(s,head,x+.24,y+.18,5.15,.45,22,TEAL,True);txt(s,body,x+.24,y+.75,5.15,.75,18)
txt(s,'Сравниваем предсказанные теги с категориями издателя.',.8,6.45,11.8,.6,18,GOLD)
end(s, SPEAKER_NOTES[4])

s=slide(6,'Состав не улучшил результат')
txt(s,'Метод',1,2.4,5,.4,19,MUTED,True);txt(s,'micro-F1',7,2.4,2,.4,19,MUTED,True);txt(s,'macro-F1',10,2.4,2,.4,19,MUTED,True)
for i,row in enumerate(m['test']):
    y=3+i*.56;box(s,.8,y-.05,11.7,.52,'#2A5858' if row['model']=='title_only' else '#204450')
    txt(s,labels[row['model']],1,y,5.8,.4,20);txt(s,f'{row["micro_f1"]:.3f}',7,y,2,.4,21,TEAL,True);txt(s,f'{row["macro_f1"]:.3f}',10,y,2,.4,21,WHITE,True)
txt(s,f'Полный вход − частоты: +{m["micro_f1_gain_over_frequency"]:.3f}  ·  95% CI [{m["gain_ci95"][0]:.3f}; {m["gain_ci95"][1]:.3f}]',.8,5.6,11.8,.6,22,GOLD)
txt(s,f'chicken F1={m["best_tag"]["f1"]:.3f}; vegetables F1={m["worst_tag"]["f1"]:.3f}. Качество заметно различается по тегам.',.8,6.45,11.8,.6,18,MUTED)
end(s, SPEAKER_NOTES[5])

s=slide(7,'Что ещё нужно проверить')
txt(s,'LLM → тексты → проверка и теги → LinUCB → API',.8,2.5,11.8,.75,25,TEAL,True)
txt(s,'Подготовить ручную разметку описаний на русском и казахском.\nПроверить требования заказчика на 30 позициях.\nСобрать показы и добавления в корзину для сравнения выдачи.',.8,3.8,11.6,2.25,22)
txt(s,'Сначала проверка тегов на RU/KK, затем эксперимент с гостями.',.8,6.45,11.8,.6,17,GOLD)
end(s, SPEAKER_NOTES[6])
prs.save(ROOT/'MenuMind_presentation.pptx');deck.save()
(ROOT/'speaker_notes.txt').write_text('\n\n'.join(f'Слайд {i+1}\n{note}' for i,note in enumerate(notes)),encoding='utf-8')
print('Created report PDF/DOCX and 7-slide PPTX/PDF with speaker notes.')
