import { useEffect, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  Check,
  Copy,
  KeyRound,
  LoaderCircle,
  LogOut,
  Plus,
  Trash2,
} from 'lucide-react';
import { api, send, errorMessage, type ApiKey, type Profile, type Tag, type User } from '../api';
import type { Recipe, Result, Tone } from '../model';

export function Account({
  user,
  profile,
  onSave,
  onLogout,
  onSelect,
}: {
  user: User;
  profile: Profile;
  onSave: (value: Profile) => Promise<void>;
  onLogout: () => Promise<void>;
  onSelect: (recipe: Recipe) => void;
}) {
  const [draft, setDraft] = useState(profile);
  const [tags, setTags] = useState<Tag[]>([]);
  const [recommendations, setRecommendations] = useState<
    (Recipe & { score: number; reasons: string[] })[]
  >([]);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [newKey, setNewKey] = useState<ApiKey | null>(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    setDraft(profile);
  }, [profile]);
  useEffect(() => {
    void Promise.all([api<{ items: Tag[] }>('/tags'), api<{ items: ApiKey[] }>('/api-keys')])
      .then(([a, b]) => {
        setTags(a.items);
        setKeys(b.items);
      })
      .catch((err) => setError(errorMessage(err)));
  }, []);
  useEffect(() => {
    void api<{ items: typeof recommendations }>('/recommendations')
      .then((data) => setRecommendations(data.items))
      .catch((err) => setError(errorMessage(err)));
  }, [profile]);
  const action = async (id: string, work: () => Promise<void>) => {
    setBusy(id);
    setError('');
    setMessage('');
    try {
      await work();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy('');
    }
  };
  const toggleTag = (id: string, field: 'preferredTags' | 'avoidedTags') =>
    setDraft((prev) => ({
      ...prev,
      [field]: prev[field].includes(id)
        ? prev[field].filter((tag) => tag !== id)
        : [...prev[field], id],
      [field === 'preferredTags' ? 'avoidedTags' : 'preferredTags']: prev[
        field === 'preferredTags' ? 'avoidedTags' : 'preferredTags'
      ].filter((tag) => tag !== id),
    }));
  const save = (event: FormEvent) => {
    event.preventDefault();
    void action('profile', async () => {
      await onSave(draft);
      setMessage('Профиль и предпочтения сохранены');
    });
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">ЛИЧНОЕ ПРОСТРАНСТВО</p>
          <h1>
            Ресторан <em>&</em> ваши предпочтения
          </h1>
          <p className="page-description">
            {user.name} · {user.email}
          </p>
        </div>
        <button
          className="button secondary"
          disabled={!!busy}
          onClick={() => void action('logout', onLogout)}
        >
          <LogOut size={15} /> Выйти
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="success-note" role="status">
          <Check size={16} />
          {message}
        </p>
      )}
      <div className="account-grid">
        <form className="account-panel product-form" onSubmit={save}>
          <p className="eyebrow">01 / ГОЛОС И КОНТЕКСТ</p>
          <h2>Профиль ресторана</h2>
          <label>
            Название ресторана
            <input
              value={draft.restaurantName}
              onChange={(e) => setDraft({ ...draft, restaurantName: e.target.value })}
              maxLength={100}
              required
            />
          </label>
          <label>
            Кухня
            <input
              value={draft.cuisine}
              onChange={(e) => setDraft({ ...draft, cuisine: e.target.value })}
              maxLength={100}
              placeholder="Например, современная казахская"
            />
          </label>
          <div className="product-form-row">
            <label>
              Язык по умолчанию
              <select
                value={draft.language}
                onChange={(e) => setDraft({ ...draft, language: e.target.value as 'ru' | 'kk' })}
              >
                <option value="ru">Русский</option>
                <option value="kk">Қазақша</option>
              </select>
            </label>
            <label>
              Тон по умолчанию
              <select
                value={draft.tone}
                onChange={(e) => setDraft({ ...draft, tone: e.target.value as Tone })}
              >
                <option value="editorial">Сдержанный редакционный</option>
                <option value="bistro">Современное бистро</option>
                <option value="concierge">Консьерж</option>
              </select>
            </label>
          </div>
          <label>
            Как звучит ваш ресторан
            <textarea
              rows={4}
              maxLength={1000}
              value={draft.brandInstructions}
              onChange={(e) => setDraft({ ...draft, brandInstructions: e.target.value })}
              placeholder="Короткие предложения. Акцент на технику. Обращение без фамильярности."
            />
          </label>
          <small>
            Эти указания используются LLM как ориентир стиля. Эталонные тексты добавляются в разделе
            «Тон бренда».
          </small>
          <h3>Предпочтительные теги</h3>
          <p>Они поднимают подходящие блюда в вашей подборке.</p>
          <div className="tag-picker">
            {tags.map((tag) => (
              <button
                type="button"
                key={tag.id}
                aria-pressed={draft.preferredTags.includes(tag.id)}
                onClick={() => toggleTag(tag.id, 'preferredTags')}
              >
                {tag.label}
              </button>
            ))}
          </div>
          <h3>Нежелательные теги</h3>
          <p>Понижают приоритет блюда. Это предпочтения, а не проверка безопасности состава.</p>
          <div className="tag-picker avoided">
            {tags.map((tag) => (
              <button
                type="button"
                key={tag.id}
                aria-pressed={draft.avoidedTags.includes(tag.id)}
                onClick={() => toggleTag(tag.id, 'avoidedTags')}
              >
                {tag.label}
              </button>
            ))}
          </div>
          <button className="button primary" disabled={!!busy}>
            {busy === 'profile' && <LoaderCircle className="spin" size={16} />}Сохранить
            предпочтения <Check size={16} />
          </button>
        </form>
        <div className="account-side">
          <section className="account-panel">
            <p className="eyebrow">02 / ВАША ПОДБОРКА</p>
            <h2>По вашим предпочтениям</h2>
            {recommendations.length ? (
              recommendations.slice(0, 5).map((recipe) => (
                <button
                  className="recommendation-item"
                  key={recipe.id}
                  onClick={() => onSelect(recipe)}
                >
                  <span>
                    <strong>{recipe.name}</strong>
                    <small>
                      {recipe.reasons.join(' · ') ||
                        'Добавьте предпочтения для персонального порядка'}
                    </small>
                  </span>
                  <ArrowRight size={17} />
                </button>
              ))
            ) : (
              <p>Добавьте первое блюдо в библиотеке.</p>
            )}
          </section>
          <section className="account-panel">
            <p className="eyebrow">03 / ИНТЕГРАЦИИ</p>
            <h2>
              <KeyRound size={22} /> API-ключи
            </h2>
            <p>
              Ключ предоставляет доступ к вашим рецептам и генерации. Полное значение показывается
              один раз.
            </p>
            <form
              className="key-form"
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const name = String(new FormData(form).get('name'));
                void action('key', async () => {
                  const key = await send<ApiKey>('/api-keys', 'POST', { name });
                  setNewKey(key);
                  setKeys((prev) => [key, ...prev]);
                  form.reset();
                });
              }}
            >
              <input
                name="name"
                required
                maxLength={80}
                placeholder="Название интеграции"
                aria-label="Название API-ключа"
              />
              <button className="button secondary" disabled={!!busy}>
                <Plus size={15} />
                Создать ключ
              </button>
            </form>
            {newKey && (
              <div className="new-key" role="status">
                <strong>Сохраните ключ сейчас</strong>
                <code>{newKey.token}</code>
                <button
                  className="text-button"
                  onClick={() =>
                    void action('copy', async () => {
                      await navigator.clipboard.writeText(newKey.token!);
                      setMessage('Ключ скопирован');
                    })
                  }
                >
                  <Copy size={14} />
                  Скопировать ключ
                </button>
                <button className="text-button" onClick={() => setNewKey(null)}>
                  Я сохранил ключ
                </button>
              </div>
            )}
            {keys.map((key) => (
              <div className="key-item" key={key.id}>
                <span>
                  <strong>{key.name}</strong>
                  <small>
                    {key.prefix}… · {new Date(key.createdAt).toLocaleDateString('ru')}
                  </small>
                </span>
                <button
                  aria-label={`Отозвать ключ ${key.name}`}
                  className="icon-button"
                  disabled={!!busy}
                  onClick={() =>
                    void action('revoke', async () => {
                      await send(`/api-keys/${key.id}`, 'DELETE');
                      setKeys((prev) => prev.filter((k) => k.id !== key.id));
                      if (newKey?.id === key.id) setNewKey(null);
                      setMessage('Ключ отозван');
                    })
                  }
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            {!keys.length && <p className="muted">Ключей пока нет.</p>}
            <a className="text-button" href="/api/docs" target="_blank" rel="noreferrer">
              Интерактивная документация ↗
            </a>
          </section>
          <section className="account-panel">
            <p className="eyebrow">04 / ДОСТУП</p>
            <h2>Сменить пароль</h2>
            <form
              className="product-form"
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const body = Object.fromEntries(new FormData(form));
                void action('password', async () => {
                  await send('/account/password', 'PUT', body);
                  form.reset();
                  setMessage('Пароль изменён. Остальные сессии завершены.');
                });
              }}
            >
              <label>
                Текущий пароль
                <input
                  type="password"
                  name="currentPassword"
                  autoComplete="current-password"
                  required
                />
              </label>
              <label>
                Новый пароль
                <input
                  type="password"
                  name="newPassword"
                  autoComplete="new-password"
                  minLength={10}
                  maxLength={128}
                  required
                />
              </label>
              <button className="button secondary" disabled={!!busy}>
                Обновить пароль
              </button>
            </form>
          </section>
        </div>
      </div>
    </>
  );
}

export function History({ onSelect }: { onSelect: (result: Result) => void }) {
  const [items, setItems] = useState<Result[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    void api<{ items: Result[] }>('/generations')
      .then((data) => setItems(data.items))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">РЕДАКЦИИ ВАШЕГО МЕНЮ</p>
          <h1>История описаний</h1>
          <p className="page-description">Последние 50 генераций, включая сохранённые правки.</p>
        </div>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p>Загружаем историю…</p>
      ) : !items.length ? (
        <div className="product-empty">
          <h2>Здесь появится первое описание</h2>
          <a className="button primary" href="#studio">
            В студию <ArrowRight size={15} />
          </a>
        </div>
      ) : (
        <div className="history-grid">
          {items.map((item) => (
            <article className="account-panel" key={item.id}>
              <div className="row-between">
                <span className="eyebrow">{item.language === 'kk' ? 'ҚАЗАҚША' : 'РУССКИЙ'}</span>
                <small>{new Date(item.createdAt).toLocaleString('ru')}</small>
              </div>
              <h2>{item.name}</h2>
              <p>{item.texts.yandex}</p>
              <div className="row-between">
                <span className="muted">
                  {item.provider === 'template' ? 'Шаблонный режим' : 'LLM'}
                </span>
                <button className="text-button" onClick={() => onSelect(item)}>
                  Открыть редакцию <ArrowRight size={15} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
