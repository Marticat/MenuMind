import { useEffect, useState } from 'react';
import { ArrowUpRight, Copy, Check, Code2 } from 'lucide-react';

const examples: Record<string, string> = {
  cURL: `curl http://127.0.0.1:3001/api/v1/generations \\\n  -H "Authorization: Bearer $MENUMIND_API_KEY" \\\n  -H "Idempotency-Key: unique-request-1" \\\n  -H "Content-Type: application/json" \\\n  -d '{"recipe":{"name":"Суп из тыквы",\n       "ingredients":["Тыква","Вода","Соль"]},\n       "language":"ru","maxLength":250}'`,
  Python: `import os\nimport requests\n\nresponse = requests.post(\n    "http://127.0.0.1:3001/api/v1/generations",\n    headers={"Authorization": "Bearer " +\n             os.environ["MENUMIND_API_KEY"]},\n    json={"recipe": {"name": "Асқабақ сорпасы"},\n          "language": "kk", "maxLength": 250},\n    timeout=12,\n)\nresponse.raise_for_status()\nprint(response.json()["texts"]["yandex"])`,
  TypeScript: `const response = await fetch(\n  'http://127.0.0.1:3001/api/v1/generations',\n  { method: 'POST',\n    headers: {\n      Authorization: 'Bearer ' +\n        process.env.MENUMIND_API_KEY,\n      'Content-Type': 'application/json',\n    },\n    body: JSON.stringify({\n      recipe: { name: 'Суп из тыквы' },\n      language: 'ru', maxLength: 250,\n    }),\n    signal: AbortSignal.timeout(12000),\n  },\n);\nif (!response.ok) throw new Error(\n  JSON.stringify(await response.json()),\n);\nconsole.log((await response.json()).texts);`,
};
type Spec = { paths: Record<string, Record<string, { summary: string }>> };
export function ApiDocs() {
  const [tab, setTab] = useState('cURL');
  const [copied, setCopied] = useState(false);
  const [spec, setSpec] = useState<Spec | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    void fetch('/api/openapi.json')
      .then((res) => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then(setSpec)
      .catch(() => setError('Документация сервера недоступна. Запустите API и обновите страницу.'));
  }, []);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">MENUMIND / REST API / V1</p>
          <h1>От данных блюда — к описанию</h1>
          <p className="page-description">
            Рабочий контракт API. Все методы ниже получены из спецификации запущенного сервера.
          </p>
        </div>
        <a className="button primary" href="/api/docs" target="_blank" rel="noreferrer">
          Открыть Swagger <ArrowUpRight size={16} />
        </a>
      </div>
      <div className="api-doc-grid">
        <div>
          <section className="account-panel">
            <h2>Первый запрос</h2>
            <p>
              Создайте аккаунт и выпустите API-ключ в профиле. Передавайте ключ с вашего сервера в
              заголовке <code>Authorization: Bearer …</code>. Cookie-сессии используют токен{' '}
              <code>X-CSRF-Token</code> из <code>/auth/me</code>.
            </p>
            <p>
              Обязательно только название блюда. Поля ingredients, category, method, price
              опциональны. Язык: <code>ru</code> или <code>kk</code>. Лимит: 40–2000 символов, для
              основного канала по умолчанию 250.
            </p>
            <p>
              Для перегенерации передайте прежний <code>previousId</code>. Новый{' '}
              <code>Idempotency-Key</code> запускает новый запрос; повтор с тем же ключом возвращает
              сохранённый результат.
            </p>
            <div className="notice">
              <Code2 size={18} />
              <p>
                Режим <code>template</code> работает без LLM. Для нейросетевой генерации настройте
                провайдера на сервере. При сбое возвращается ошибка, без подмены результата
                шаблоном.
              </p>
            </div>
          </section>
          <section className="account-panel">
            <h2>Персональные описания · LinUCB</h2>
            <p>
              Сохраните профиль через <code>PUT /customers/guest-42</code>: имя, язык,
              <code> preferredTags</code> и <code>descriptionPreference</code>
              (auto, concise, ingredients или method). Идентификатор гостя относится к ресторану
              владельца API-ключа.
            </p>
            <p>
              Подготовьте тексты через <code>POST /description-sets</code> с recipeId и language.
              Для одного блюда сохраняются варианты с разными акцентами. Изменение техкарты или
              голоса бренда требует новой подготовки.
            </p>
            <p>
              <code>POST /personalizations</code> принимает requestId (UUID), customerId, recipeId,
              channel и mode (live по умолчанию, demo для тестирования). Возвращает id, text, style
              и сведения о выборе. Повтор того же requestId возвращает прежний выбор.
            </p>
            <p>
              После отображения текста отправьте{' '}
              <code>POST /personalizations/&#123;id&#125;/impression</code> с пустым JSON. При
              добавлении блюда в корзину —{' '}
              <code>POST /personalizations/&#123;id&#125;/feedback</code>с{' '}
              <code>{'{"event":"add_to_cart"}'}</code>. Повтор события учитывается один раз.
            </p>
            <p>
              Показ нужно подтвердить в течение 10 минут после выбора. Окно реакции — 30 минут после
              подтверждения: добавление даёт 1, отсутствие добавления — 0. Просроченные показы
              закрываются при следующем выборе, обратной связи или запросе{' '}
              <code>GET /personalization/stats</code>. Непоказанные тексты не обучают модель.
            </p>
            <a className="text-button" href="#personalization">
              Проверить на тестовых гостях ↗
            </a>
          </section>
          <section className="account-panel">
            <h2>Методы API</h2>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="api-endpoints">
              {spec &&
                Object.entries(spec.paths).flatMap(([path, methods]) =>
                  Object.entries(methods).map(([method, info]) => (
                    <div key={method + path}>
                      <code>
                        <b>{method.toUpperCase()}</b> /api/v1{path}
                      </code>
                      <p>{info.summary}</p>
                    </div>
                  )),
                )}
            </div>
          </section>
          <section className="account-panel">
            <h2>Ошибки и ограничения</h2>
            <p>
              422 — неверные поля; 401 — требуется вход; 403 — CSRF или доступ; 404 — объект не
              найден; 409 — конфликт; 429 — лимит запросов; 502 — некорректный ответ модели; 503 —
              провайдер недоступен; 504 — таймаут.
            </p>
            <p>
              JSON ошибки содержит <code>error.code</code>, <code>error.message</code> и
              идентификатор запроса. Извлечённые теги содержат фрагменты исходного текста; аллергены
              не считаются подтверждёнными. Проверка фактов и готового текста остаётся за
              редактором.
            </p>
            <p>
              POS, публикация во внешние каналы и webhooks пока не подключены. Примеры стиля
              выбираются по совпадению слов; векторный поиск не используется.
            </p>
          </section>
        </div>
        <aside>
          <div className="code-panel">
            <div className="code-tabs" role="tablist" aria-label="Язык примера">
              {Object.keys(examples).map((lang) => (
                <button
                  role="tab"
                  aria-selected={tab === lang}
                  className={tab === lang ? 'active' : ''}
                  key={lang}
                  onClick={() => setTab(lang)}
                >
                  {lang}
                </button>
              ))}
              <button
                className="icon-button"
                aria-label="Копировать пример API"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(examples[tab])
                    .then(() => setCopied(true))
                    .catch(() => setError('Не удалось скопировать пример.'));
                }}
              >
                {copied ? <Check size={15} /> : <Copy size={15} />}
              </button>
            </div>
            <pre role="tabpanel">
              <code>{examples[tab]}</code>
            </pre>
          </div>
          <div className="account-panel">
            <h3>Ответ: 201 Created</h3>
            <pre>
              {JSON.stringify(
                {
                  id: 'uuid',
                  language: 'ru',
                  texts: {
                    yandex: 'Описание…',
                    wolt: 'Описание…',
                    website: 'Описание…',
                    print: 'Описание…',
                  },
                  variant: 'Другой вариант…',
                  provider: 'template',
                  requiresReview: true,
                },
                null,
                2,
              )}
            </pre>
            <a className="text-button" href="/api/openapi.json" download="menumind-openapi.json">
              Скачать OpenAPI JSON ↗
            </a>
          </div>
        </aside>
      </div>
    </>
  );
}
