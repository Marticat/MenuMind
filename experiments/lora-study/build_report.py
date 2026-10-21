"""Build a unified table, Russian defense notes and an executable offline analysis notebook."""
import csv
import json
import nbformat as nbf
from common import ROOT, ART, read_json, read_jsonl


def main():
    classical = read_json(ART / "classical_results.json")
    llm = read_json(ART / "llm_results.json")
    selection = read_json(ART / "selection.json")
    cfg = read_json(ROOT / "config.json")
    selected = selection["selected"]
    rows = [{"task": "EN tag classification", "language": "en", "n": classical["split_hashes"]["test"]["n"], **r} for r in classical["rows"]]
    rows += [{"task": "RU/KK synthetic description", **r} for r in llm["rows"]]
    fields = list(dict.fromkeys(key for row in rows for key in row))
    with (ART / "results.csv").open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
    before = next(r for r in classical["rows"] if r["model"] == "classical_default")
    after = next(r for r in classical["rows"] if r["model"] == "classical_tuned")
    lines = [
        "MenuMind: выполненный учебный эксперимент с LoRA", "",
        "Область выводов: синтетические RU/KK-описания одного канала, нейтральный тон. Это не проверка коммерческого качества или казахской грамматики человеком.", "",
        "Данные: 120 синтетических блюд, 240 языковых примеров. Train 84 блюда / 168 строк; validation 18 / 36; test 18 / 36. Разделение по паре основных ингредиентов, seed=42. Переводы одного блюда не пересекают split. Словарь и шаблон эталона общие — эксперимент проверяет новые комбинации знакомых элементов.", "",
        "Классический ML: те же опубликованные train/validation/test, что в tags-midterm. Новый baseline C=1, threshold=0.5. Поиск C=[0.5,2], threshold=[0.2,0.35,0.5]; выбор по validation micro-F1. Старый test уже был просмотрен, поэтому это дополнение к прежнему сравнению, а не новый закрытый holdout.",
        f"До tuning: micro-F1={before['micro_f1']:.4f}, macro-F1={before['macro_f1']:.4f}.",
        f"После tuning: micro-F1={after['micro_f1']:.4f}, macro-F1={after['macro_f1']:.4f}; C={after['C']}, threshold={after['threshold']}.",
        f"Прирост micro-F1={after['micro_f1']-before['micro_f1']:.4f}; macro-F1={after['macro_f1']-before['macro_f1']:.4f}. Менялись регуляризация и порог; без отдельной абляции их индивидуальный вклад не установлен.", "",
        f"Исходная LLM: {cfg['model_id']}, revision={cfg['revision']}.",
        "Transfer learning: используем ранее выученные языковые и инструктивные представления; адаптер учится ограниченному формату описания по техкарте. Русский указан в карточке модели. Качество казахского в этом проекте проверено только автоматическими слотами, не носителем языка. Выбор 0.5B связан с доступными 8 ГБ VRAM; модель не заявляется лучшей для ресторанного копирайтинга.",
        f"Fine-tuning: AdamW, loss=causal cross-entropy только по токенам ответа; learning rate={selected['learning_rate']}; batch={cfg['batch_size']}; accumulation={cfg['gradient_accumulation_steps']}; effective batch={cfg['batch_size']*cfg['gradient_accumulation_steps']}; epochs={cfg['epochs']}; weight_decay={cfg['weight_decay']}; max_grad_norm={cfg['max_grad_norm']}; constant LR; max_sequence_length={cfg['max_sequence_length']}.",
        f"LoRA: r={cfg['lora_rank']}, alpha={cfg['lora_alpha']}, dropout={cfg['lora_dropout']}, target_modules={cfg['target_modules']}. Обучаемых параметров: {selected['trainable_parameters']:,} / {selected['total_parameters']:,} ({selected['trainable_percent']:.4f}%).",
        "Использована LoRA, не QLoRA: основная модель не квантизована. PEFT экономит память на градиентах и состояниях оптимизатора, сохраняет небольшой адаптер. Это не доказательство превосходства над полным fine-tuning: полного обучения для сравнения не проводили.",
        f"Поиск learning rate={cfg['learning_rates']}. Каждый кандидат начинал с одной исходной модели и seed; обучался {cfg['epochs']} эпох. Выбрана минимальная response-token NLL на validation, test не использован для выбора.",
    ]
    for trial in selection["trials"]:
        lines.append(f"  lr={trial['learning_rate']}: validation NLL={trial['validation_response_token_nll']:.6f}, время обучения={trial['seconds']:.1f} с, изменение адаптера L2={trial['adapter_weight_delta_l2']:.6f}.")
    lines += ["", "Общие метрики генерации (доли, 0–1):",
              "Модель | язык | n | JSON | ограничения | полнота ингредиентов | метод | все проверяемые слоты"]
    for row in llm["rows"]:
        lines.append(f"{row['model']} | {row['language']} | {row['n']} | {row['json_valid']:.3f} | {row['constraint_pass']:.3f} | {row['ingredient_recall']:.3f} | {row['method_match']:.3f} | {row['grounded_slot_pass']:.3f}")
    lines += ["", "Парные различия, 95% bootstrap CI по блюдам, 2000 повторов:"]
    for item in llm["comparisons"]:
        lines.append(f"{item['comparison']}, {item['metric']}: {item['delta']:+.4f}, CI [{item['ci95'][0]:+.4f}; {item['ci95'][1]:+.4f}].")
    gains = [r for r in llm["comparisons"] if r["metric"] == "grounded_slot_pass"]
    largest = max(gains, key=lambda r: abs(r["delta"]))
    lines += ["", f"Наибольшее по абсолютной величине изменение доли ответов со всеми проверяемыми слотами: {largest['comparison']} ({largest['delta']:+.4f}).",
              "Интерпретация: подробный промпт задаёт формат и требование копировать факты; LoRA непосредственно обучается этим действиям на синтетических парах. Возможное улучшение относится к формату и покрытию знакомых слотов. Эти данные не позволяют приписывать модели более глубокое знание кулинарии. Общий шаблон эталона делает задачу проще реальной редакторской работы.",
              "Детерминированный генератор эталонов по построению проходит все слот-проверки этого набора. Поэтому эксперимент показывает обучение адаптера и перенос на новые комбинации, но не доказывает, что для такой шаблонной задачи LLM необходима или лучше шаблона.",
              "Отрицательное или нулевое изменение сохраняется как результат; подбор по NLL не гарантирует улучшения каждой метрики генерации. Bootstrap описывает неопределённость на 18 блюдах, но не вариацию разных запусков обучения: training seed один.", "",
              "Ограничения метрик: ingredient_recall ищет буквальные фразы и может штрафовать корректное склонение. known_fact_pass замечает только лишние ингредиенты и способы из словаря; не замечает все выдуманные свойства. grounded_slot_pass объединяет JSON, длину, полноту ингредиентов, метод и словарную проверку. Ни одна метрика не доказывает отсутствие всех галлюцинаций или правильность языка. RU/KK всегда показаны отдельно.",
              "Latency: последовательная генерация на локальной GPU, включая первый вызов; это не чистый benchmark производительности и не сравнение стоимости с API. Старые API-ответы имеют другой набор входов и не смешиваются с новым тестом.", "",
              "Воспроизводимость: config.json, commit модели, хеши данных и исходного кода, freeze до test, requirements-lock.txt, environment.json, сырые промпты и ответы, реальные веса адаптеров, логи loss. Notebook по умолчанию пересчитывает анализ сохранённых ответов; повторное обучение запускается отдельной командой и требует GPU. Побитовая идентичность между устройствами не гарантируется.", "",
              "Для устной защиты:",
              "1. Приложение вызывает LLM через API; этот эксперимент отдельно проверяет возможность адаптации открытой LLM. В production адаптер не подключён.",
              "2. Изменение промпта не обучает веса; LoRA обучает малые матрицы в q_proj/v_proj, исходные веса заморожены.",
              "3. Train нужен для градиентов; validation — для выбора LR; test — для финального сравнения трёх конфигураций.",
              "4. F1 тегов и метрики генерации относятся к разным задачам, поэтому в общей таблице отдельные блоки и пустые несопоставимые поля.",
              "5. Синтетические эталоны не являются экспертной разметкой. Следующий содержательный этап — реальные техкарты и независимая оценка RU/KK редакторами.", "",
              "Соответствие критериям: 1 — три LLM-конфигурации, одинаковый test; 2 — два LR и сетка классического ML; 3 — реальный supervised fine-tuning; 4 — перенос языковых представлений; 5 — реальный LoRA и счётчик параметров; 6 — default/tuned классификатор; 7 — results.csv; 8 — различия и ограничения; 9 — код, seed, версии и аудит; 10 — вопросы защиты выше. Это технические свидетельства, не обещание оценки преподавателя.", "",
              "Источники:", "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct",
              "https://huggingface.co/docs/peft/main/en/conceptual_guides/lora",
              "https://pytorch.org/get-started/previous-versions/", ""]
    lines += ["Примеры из test для качественного разбора (наблюдения по сырым ответам, не независимая человеческая разметка):"]
    for example_id in ["dish-00-03-ru", "dish-00-04-ru", "dish-00-03-kk"]:
        for model in ["base_simple", "base_detailed", "lora_detailed"]:
            example = next(r for r in read_jsonl(ART / f"predictions-{model}.jsonl") if r["id"] == example_id)
            lines.append(f"{example_id}, {model}: {example['raw_output']}")
    simple_examples = {r["id"]: r for r in read_jsonl(ART / "predictions-base_simple.jsonl")}
    if "кабачками" in simple_examples["dish-00-03-ru"]["raw_output"]:
        lines.append("В base_simple для dish-00-03-ru слово «кабачками» передаёт нужный ингредиент, но буквальная проверка «кабачок» его не засчитывает. Поэтому ingredient_recall — метрика выполнения инструкции копирования, а не полноценная семантическая полнота.")
    if "сладкий" in simple_examples["dish-00-04-ru"]["raw_output"].lower() and simple_examples["dish-00-04-ru"]["scores"]["known_fact_pass"]:
        lines.append("В base_simple для dish-00-04-ru появляется «Сладкий», которого нет в исходных фактах. Словарная known_fact_pass не ловит такую характеристику. Этот пример показывает реальное ограничение автоматической проверки, а не отсутствие галлюцинаций.")
    lines.append("")
    (ROOT / "REPORT.txt").write_text("\n".join(lines), encoding="utf-8")
    nb = nbf.v4.new_notebook()
    nb.metadata.kernelspec = {"display_name": "Python 3", "language": "python", "name": "python3"}
    nb.cells = [
        nbf.v4.new_markdown_cell("# MenuMind: LoRA и сравнение конфигураций\n\nВыполненный учебный эксперимент на синтетических данных. **Human review не выполнен.** Run All проверяет сохранённые ответы без сети и GPU; он не повторяет обучение. Команды обучения и последовательность приведены в README.md. Notebook требует всю папку эксперимента."),
        nbf.v4.new_code_cell("from pathlib import Path\nimport sys, json\nimport pandas as pd\ncandidates = [Path.cwd(), Path.cwd()/'experiments/lora-study', Path.cwd()/'MenuMind/experiments/lora-study']\nROOT = next(p.resolve() for p in candidates if (p/'config.json').exists() and (p/'audit_artifacts.py').exists())\nsys.path.insert(0, str(ROOT))\nfrom audit_artifacts import main as audit\naudit()"),
        nbf.v4.new_markdown_cell("## Данные и воспроизводимость\n\nОбе языковые версии блюда остаются в одной части. Все эталоны синтетические; общая структура эталона ограничивает перенос выводов на реальные меню."),
        nbf.v4.new_code_cell("manifest = json.loads((ROOT/'dataset/manifest.json').read_text(encoding='utf-8'))\nprint(json.dumps(manifest, ensure_ascii=False, indent=2))"),
        nbf.v4.new_markdown_cell("## Tuning и настоящее обучение\n\nВыбор learning rate сделан по validation response-token NLL, до генерации на test. Обучаются только LoRA-матрицы."),
        nbf.v4.new_code_cell("selection = json.loads((ROOT/'artifacts/selection.json').read_text(encoding='utf-8'))\ndisplay(pd.DataFrame([{k:t[k] for k in ['learning_rate','validation_response_token_nll','trainable_parameters','total_parameters','adapter_weight_delta_l2','seconds']} for t in selection['trials']]))\nprint('Selected LR:', selection['selected']['learning_rate'])\nprint((ROOT/'artifacts/environment.json').read_text(encoding='utf-8'))"),
        nbf.v4.new_markdown_cell("## Единая таблица результатов\n\nРазные задачи показаны отдельно. Пустая ячейка означает неприменимость метрики, а не нулевой результат."),
        nbf.v4.new_code_cell("results = pd.read_csv(ROOT/'artifacts/results.csv')\ndisplay(results)"),
        nbf.v4.new_markdown_cell("## Неопределённость и интерпретация\n\nBootstrap по блюдам сохраняет связанность RU/KK. Это не доверительный интервал по разным training seeds."),
        nbf.v4.new_code_cell("llm = json.loads((ROOT/'artifacts/llm_results.json').read_text(encoding='utf-8'))\ndisplay(pd.DataFrame(llm['comparisons']))\nprint((ROOT/'REPORT.txt').read_text(encoding='utf-8'))"),
        nbf.v4.new_markdown_cell("## Примеры для проверки человеком\n\nПоля human_review.csv оставлены пустыми. Автоматическая словарная проверка не является оценкой естественности, грамматики или всех неподтверждённых утверждений."),
        nbf.v4.new_code_cell("review = pd.read_csv(ROOT/'artifacts/human_review.csv')\ndisplay(review[['id','model','language','recipe','output']].head(9))\nassert review[['facts_correct','language_correct','naturalness_1_to_5','reviewer']].isna().all().all()"),
    ]
    nbf.write(nb, ROOT / "MenuMind_LoRA.ipynb")
    print("Wrote results.csv, REPORT.txt, MenuMind_LoRA.ipynb")


if __name__ == "__main__":
    main()
