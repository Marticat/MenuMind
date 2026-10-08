import { useEffect, useState, type FormEvent } from 'react';
import { LoaderCircle, Plus, Sparkles, ShoppingBag } from 'lucide-react';
import { api, send, errorMessage, type Tag } from '../api';
import type { Recipe, ChannelId } from '../model';

type Style = 'auto' | 'concise' | 'ingredients' | 'method';
type Customer = {
  id: string;
  name: string;
  language: 'ru' | 'kk';
  descriptionPreference: Style;
  preferredTags: string[];
};
type DescriptionSet = {
  provider: string;
  variants: { style: string; label: string; texts: Record<ChannelId, string> }[];
};
type Selection = {
  id: string;
  text: string;
  label: string;
  provider: string;
  shownAt: string | null;
  reward: number | null;
  descriptionTags?: { mentioned: Tag[]; short: boolean };
};
type Stats = {
  items: {
    mode: string;
    style: string;
    impressions: number;
    observations: number;
    additions: number;
    pending: number;
  }[];
};
const freshCustomer = (): Customer => ({
  id: `guest-${crypto.randomUUID()}`,
  name: '',
  language: 'ru',
  descriptionPreference: 'auto',
  preferredTags: [],
});

export function Personalization({ recipes }: { recipes: Recipe[] }) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [draft, setDraft] = useState<Customer>(freshCustomer);
  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [recipeId, setRecipeId] = useState(recipes[0]?.id ?? '');
  const [tags, setTags] = useState<Tag[]>([]);
  const [variants, setVariants] = useState<DescriptionSet | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [stats, setStats] = useState<Stats>({ items: [] });
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const savedCustomer = customers.find((customer) => customer.id === selectedCustomer);
  const dirty = !savedCustomer || JSON.stringify(savedCustomer) !== JSON.stringify(draft);
  const demoStats = stats.items.filter((item) => item.mode === 'demo');
  const totals = demoStats.reduce(
    (sum, item) => ({
      impressions: sum.impressions + item.impressions,
      additions: sum.additions + item.additions,
      pending: sum.pending + item.pending,
    }),
    { impressions: 0, additions: 0, pending: 0 },
  );
  const loadStats = async () => setStats(await api<Stats>('/personalization/stats'));
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      api<{ items: Customer[] }>('/customers'),
      api<{ items: Tag[] }>('/tags'),
      api<Stats>('/personalization/stats'),
    ])
      .then(([people, catalog, metrics]) => {
        if (cancelled) return;
        setCustomers(people.items);
        setTags(catalog.items);
        setStats(metrics);
        if (people.items[0]) {
          setSelectedCustomer(people.items[0].id);
          setDraft(people.items[0]);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const action = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await work();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const resetPreview = () => {
    setVariants(null);
    setSelection(null);
    setMessage('');
  };
  const save = (event: FormEvent) => {
    event.preventDefault();
    void action(async () => {
      const { id, ...profile } = draft;
      const customer = await send<Customer>(`/customers/${encodeURIComponent(id)}`, 'PUT', profile);
      setCustomers((items) => [customer, ...items.filter((item) => item.id !== customer.id)]);
      setSelectedCustomer(customer.id);
      setDraft(customer);
      resetPreview();
      setMessage('Профиль гостя сохранён');
    });
  };
  const show = () =>
    void action(async () => {
      if (!savedCustomer) return;
      setSelection(null);
      setVariants(null);
      const descriptions = await send<DescriptionSet>('/description-sets', 'POST', {
        recipeId,
        language: savedCustomer.language,
      });
      setVariants(descriptions);
      const chosen = await send<Selection>('/personalizations', 'POST', {
        requestId: crypto.randomUUID(),
        customerId: savedCustomer.id,
        recipeId,
        channel: 'website',
        mode: 'demo',
      });
      setSelection(chosen);
    });
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">ОПИСАНИЕ ДЛЯ КАЖДОГО ГОСТЯ</p>
          <h1>Персонализация описаний</h1>
          <p className="page-description">
            Одно блюдо — разные акценты. Выбор учитывает предпочтения гостя и его реакции.
          </p>
        </div>
      </div>
      <div className="notice personalization-notice">
        <Sparkles size={18} />
        <p>
          Здесь можно проверить сценарий на тестовых гостях. Тестовые показы обучают отдельную
          модель и не влияют на рабочую выдачу API.
        </p>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="success-note" role="status">
          {message}
        </p>
      )}
      {loading ? (
        <p role="status">Загружаем профили гостей…</p>
      ) : (
        <div className="account-grid personalization-grid">
          <section className="account-panel">
            <h2>Профиль гостя</h2>
            <div className="personalization-guest-picker">
              <label className="product-field">
                Сохранённый гость
                <select
                  value={selectedCustomer}
                  disabled={busy}
                  onChange={(event) => {
                    const customer = customers.find((item) => item.id === event.target.value);
                    if (customer) {
                      setSelectedCustomer(customer.id);
                      setDraft(customer);
                      resetPreview();
                    }
                  }}
                >
                  <option value="" disabled>
                    Новый профиль
                  </option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => {
                  setSelectedCustomer('');
                  setDraft(freshCustomer());
                  resetPreview();
                }}
              >
                <Plus size={14} /> Новый гость
              </button>
            </div>
            <form className="product-form" onSubmit={save}>
              <fieldset disabled={busy} className="personalization-fields">
                <label>
                  Имя гостя
                  <input
                    required
                    maxLength={100}
                    value={draft.name}
                    onChange={(e) => {
                      setDraft({ ...draft, name: e.target.value });
                      resetPreview();
                    }}
                  />
                </label>
                <label>
                  Язык гостя
                  <select
                    value={draft.language}
                    onChange={(e) => {
                      setDraft({ ...draft, language: e.target.value as Customer['language'] });
                      resetPreview();
                    }}
                  >
                    <option value="ru">Русский</option>
                    <option value="kk">Қазақша</option>
                  </select>
                </label>
                <label>
                  Что важно в описании
                  <select
                    value={draft.descriptionPreference}
                    onChange={(e) => {
                      setDraft({ ...draft, descriptionPreference: e.target.value as Style });
                      resetPreview();
                    }}
                  >
                    <option value="auto">Пока не знаю</option>
                    <option value="concise">Краткость</option>
                    <option value="ingredients">Состав блюда</option>
                    <option value="method">Способ приготовления</option>
                  </select>
                </label>
                <div>
                  <p className="eyebrow">ИНТЕРЕСУЮЩИЕ ИНГРЕДИЕНТЫ</p>
                  <div className="tag-picker">
                    {tags
                      .filter((tag) => tag.kind === 'ingredient')
                      .map((tag) => (
                        <button
                          type="button"
                          key={tag.id}
                          aria-pressed={draft.preferredTags.includes(tag.id)}
                          onClick={() => {
                            setDraft({
                              ...draft,
                              preferredTags: draft.preferredTags.includes(tag.id)
                                ? draft.preferredTags.filter((id) => id !== tag.id)
                                : [...draft.preferredTags, tag.id],
                            });
                            resetPreview();
                          }}
                        >
                          {tag.label}
                        </button>
                      ))}
                  </div>
                </div>
                <button className="button primary" type="submit" disabled={!dirty}>
                  Сохранить гостя
                </button>
              </fieldset>
            </form>
          </section>
          <div className="account-side">
            <section className="account-panel">
              <h2>Описание для гостя</h2>
              <label className="product-field">
                Блюдо для персонализации
                <select
                  value={recipeId}
                  disabled={busy}
                  onChange={(e) => {
                    setRecipeId(e.target.value);
                    resetPreview();
                  }}
                >
                  {!recipes.length && <option value="">Сначала добавьте блюдо в библиотеку</option>}
                  {recipes.map((recipe) => (
                    <option key={recipe.id} value={recipe.id}>
                      {recipe.name}
                    </option>
                  ))}
                </select>
              </label>
              <p>
                Сохраните профиль, затем получите вариант. При первом запросе будут подготовлены
                тексты; повторные запросы используют сохранённые варианты.
              </p>
              <p>
                Предпочтение помогает выбору. Пока система учится, она также проверяет другие типы
                описаний.
              </p>
              <button
                className="button primary"
                disabled={busy || dirty || !recipeId}
                onClick={show}
              >
                {busy ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />}{' '}
                Получить описание
              </button>
              {selection && (
                <article className="personalized-description" aria-label="Персональное описание">
                  <p className="eyebrow">
                    {selection.label} · {selection.provider === 'template' ? 'ШАБЛОН' : 'LLM'}
                  </p>
                  <p className="personalized-text">{selection.text}</p>
                  {!!selection.descriptionTags?.mentioned.length && (
                    <div className="product-tags" aria-label="Упоминания в описании">
                      {selection.descriptionTags.mentioned.map((tag) => (
                        <span key={tag.id} title={tag.evidence?.text}>
                          {tag.label}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="personalization-actions">
                    <button
                      className="button secondary"
                      disabled={busy || !!selection.shownAt}
                      onClick={() =>
                        void action(async () => {
                          const shown = await send<Selection>(
                            `/personalizations/${selection.id}/impression`,
                            'POST',
                            {},
                          );
                          setSelection(shown);
                          await loadStats();
                          setMessage('Тестовый показ учтён. Окно реакции — 30 минут.');
                        })
                      }
                    >
                      {selection.shownAt ? 'Показ учтён' : 'Подтвердить тестовый показ'}
                    </button>
                    <button
                      className="button primary"
                      disabled={busy || !selection.shownAt || selection.reward !== null}
                      onClick={() =>
                        void action(async () => {
                          const feedback = await send<Selection>(
                            `/personalizations/${selection.id}/feedback`,
                            'POST',
                            { event: 'add_to_cart' },
                          );
                          setSelection(feedback);
                          await loadStats();
                          setMessage(
                            'Реакция учтена. Следующий выбор использует обновлённую модель.',
                          );
                        })
                      }
                    >
                      <ShoppingBag size={14} />
                      {selection.reward === 1 ? 'Добавление учтено' : 'Добавить в тестовую корзину'}
                    </button>
                  </div>
                </article>
              )}
              {variants && (
                <details className="personalization-variants">
                  <summary>Все варианты ({variants.variants.length})</summary>
                  <p>Перед рабочими показами проверьте факты по техкарте.</p>
                  {variants.variants.map((variant) => (
                    <div key={variant.style}>
                      <strong>{variant.label}</strong>
                      <p>{variant.texts.website}</p>
                    </div>
                  ))}
                </details>
              )}
            </section>
            <section className="account-panel">
              <h2>Тестовые реакции</h2>
              <dl className="personalization-metrics">
                <div>
                  <dt>Показы</dt>
                  <dd>{totals.impressions}</dd>
                </div>
                <div>
                  <dt>В корзину</dt>
                  <dd>{totals.additions}</dd>
                </div>
                <div>
                  <dt>Ожидают реакции</dt>
                  <dd>{totals.pending}</dd>
                </div>
              </dl>
              <p>
                Подтверждённый показ без добавления в корзину за 30 минут получает нулевой
                результат. Предпросмотр без подтверждения не участвует в обучении.
              </p>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => void action(loadStats)}
              >
                Обновить результаты
              </button>
            </section>
          </div>
        </div>
      )}
    </>
  );
}
