import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Clipboard,
  Copy,
  FileText,
  Flower2,
  Leaf,
  LoaderCircle,
  Menu,
  PencilLine,
  Plus,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Wine,
  X,
} from 'lucide-react';
import {
  channels,
  constrain,
  download,
  forbidden,
  generationFingerprint,
  tones,
  type ChannelId,
  type Page,
  type Recipe,
  type Result,
  type Settings,
  type Tone,
} from './model';
import { api, send, errorMessage, type Workspace, type Profile } from './api';
import { Account, History } from './components/Account';
import { ApiDocs } from './components/ApiDocs';
import { Personalization } from './components/Personalization';

const nav: { id: Page; label: string }[] = [
  { id: 'studio', label: 'Студия генерации' },
  { id: 'personalization', label: 'Персонализация' },
  { id: 'channels', label: 'Витрины каналов' },
  { id: 'brand', label: 'Тон бренда' },
  { id: 'docs', label: 'API документация' },
  { id: 'library', label: 'Библиотека рецептов' },
  { id: 'history', label: 'История' },
];
const getPage = (): Page =>
  location.hash.slice(1) === 'profile' || nav.some((n) => n.id === location.hash.slice(1))
    ? (location.hash.slice(1) as Page)
    : 'studio';
const money = (price: number) => new Intl.NumberFormat('ru-RU').format(price) + ' ₽';

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-label={title}
    >
      <div className="modal-heading">
        <div>
          <span className="eyebrow">MISE EN PLACE · ATELIER</span>
          <h2>{title}</h2>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Закрыть">
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

function App({
  workspace,
  onLogout,
  onWorkspaceChange,
}: {
  workspace: Workspace;
  onLogout: () => Promise<void>;
  onWorkspaceChange: (value: Workspace) => void;
}) {
  const [page, setPage] = useState<Page>(getPage);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profile, setProfile] = useState(workspace.profile);
  const [recipes, setRecipes] = useState<Recipe[]>(workspace.recipes);
  const [selectedId, setSelectedId] = useState(
    workspace.result?.recipeId || workspace.recipes[0]?.id || '',
  );
  const settings = profile.settings;
  const localLora = workspace.provider === 'local-lora';
  const [tone, setTone] = useState<Tone>(localLora ? 'editorial' : workspace.profile.tone);
  const [language, setLanguage] = useState<'ru' | 'kk'>(workspace.profile.language);
  const [result, setResult] = useState<Result>(
    workspace.result ?? {
      id: '',
      recipeId: '',
      name: 'Здесь появится описание',
      texts: { yandex: '', wolt: '', website: '', print: '' },
      variant: '',
      tone: workspace.profile.tone,
      sourceFingerprint: '',
      createdAt: '',
      price: 0,
      weight: 0,
      pairing: '',
    },
  );
  const [generating, setGenerating] = useState(false);
  useEffect(() => {
    onWorkspaceChange({
      user: workspace.user,
      provider: workspace.provider,
      profile,
      recipes,
      result: result.id ? result : null,
    });
  }, [onWorkspaceChange, workspace.user, workspace.provider, profile, recipes, result]);
  const [toast, setToast] = useState('');
  const [editingRecipe, setEditingRecipe] = useState<Recipe | 'new' | null>(null);
  const [editText, setEditText] = useState<{ key: ChannelId | 'variant'; text: string } | null>(
    null,
  );
  const [publishOpen, setPublishOpen] = useState(false);
  const profileOpen = page === 'profile';
  const [copied, setCopied] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState('');
  const [published, setPublished] = useState('');
  const recipe = recipes.find((r) => r.id === selectedId) || recipes[0];
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const notify = (message: string) => setToast(message);
  const go = (next: Page) => {
    location.hash = next;
    setPage(next);
    setMobileOpen(false);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
  useEffect(() => {
    const change = () => setPage(getPage());
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  useEffect(() => {
    document.title = `MenuMind — ${page === 'profile' ? 'Профиль' : nav.find((n) => n.id === page)?.label}`;
  }, [page]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(''), 4500);
      return () => clearTimeout(t);
    }
  }, [toast]);
  useEffect(
    () => () => {
      clearTimeout(copyTimer.current);
    },
    [],
  );
  const doGenerate = async () => {
    if (generating || !recipe) return;
    setGenerating(true);
    try {
      const next = await api<Result>('/generations', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          recipeId: recipe.id,
          language,
          tone,
          ...(result.id && result.recipeId === recipe.id ? { previousId: result.id } : {}),
        }),
      });
      setResult(next);
      notify('Описания для четырёх каналов сохранены');
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      setGenerating(false);
    }
  };
  useEffect(() => {
    const shortcut = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key === 'Enter' &&
        page === 'studio' &&
        !editingRecipe &&
        !editText &&
        !publishOpen &&
        !profileOpen
      ) {
        e.preventDefault();
        doGenerate();
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  });
  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(''), 2000);
    } catch {
      notify('Не удалось скопировать. Выделите текст или экспортируйте JSON.');
    }
  };
  const saveRecipe = async (value: Recipe) => {
    const exists = recipes.some((r) => r.id === value.id);
    const saved = await send<Recipe>(
      exists ? `/recipes/${value.id}` : '/recipes',
      exists ? 'PUT' : 'POST',
      value,
    );
    setRecipes((prev) =>
      prev.some((r) => r.id === saved.id)
        ? prev.map((r) => (r.id === saved.id ? saved : r))
        : [...prev, saved],
    );
    setSelectedId(saved.id);
    setEditingRecipe(null);
    notify('Технологическая карта сохранена');
  };
  const saveSettings = async (value: Settings) => {
    setProfile(await send<Profile>('/settings', 'PUT', value));
    notify('Профиль ресторана сохранён');
  };
  const saveProfile = async (value: Profile) => {
    const saved = await send<Profile>('/profile', 'PUT', value);
    setProfile(saved);
    setTone(localLora ? 'editorial' : saved.tone);
    setLanguage(saved.language);
  };
  const deleteRecipe = async (id: string) => {
    await send(`/recipes/${id}`, 'DELETE');
    setRecipes((prev) => prev.filter((r) => r.id !== id));
    setEditingRecipe(null);
    notify('Блюдо удалено');
  };
  const stale =
    !!recipe &&
    result.sourceFingerprint !== generationFingerprint(recipe, tone, settings, language, profile);
  const resultLimits = result.limits ?? settings.limits;
  const publishValid =
    !!result.id &&
    channels.every(
      (c) =>
        result.texts[c.id].trim().length > 0 && result.texts[c.id].length <= resultLimits[c.id],
    );
  const actionButtons = (key: ChannelId | 'variant') => (
    <div className="card-actions">
      <button
        aria-label={`Копировать ${key}`}
        className="icon-button"
        disabled={!result.id}
        onClick={() => copy(key === 'variant' ? result.variant : result.texts[key], key)}
      >
        {copied === key ? <Check size={16} /> : <Copy size={16} />}
      </button>
      <button
        aria-label={`Редактировать ${key}`}
        className="icon-button"
        disabled={!result.id}
        onClick={() => {
          setEditError('');
          setEditText({ key, text: key === 'variant' ? result.variant : result.texts[key] });
        }}
      >
        <PencilLine size={16} />
      </button>
    </div>
  );

  return (
    <>
      <header className="site-header">
        <a className="wordmark" href="#home">
          <span>MENUMIND</span>
          <small>L’ATELIER GASTRONOMIQUE</small>
        </a>
        <nav
          className={mobileOpen ? 'navigation open' : 'navigation'}
          aria-label="Основная навигация"
        >
          {nav.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              className={page === item.id ? 'active' : ''}
              aria-current={page === item.id ? 'page' : undefined}
              onClick={() => go(item.id)}
            >
              {item.label}
            </a>
          ))}
        </nav>
        <button className="organization" onClick={() => go('profile')}>
          <span>
            {profile.restaurantName}
            <small>{workspace.user.name}</small>
          </span>
          <ChevronDown size={13} />
        </button>
        <span className="env-tag">STUDIO</span>
        <button className="avatar" aria-label="Профиль ресторана" onClick={() => go('profile')}>
          {workspace.user.name.slice(0, 2).toUpperCase()}
        </button>
        <button
          className="mobile-toggle icon-button"
          aria-label="Открыть меню"
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen(!mobileOpen)}
        >
          {mobileOpen ? <X /> : <Menu />}
        </button>
      </header>
      {page === 'studio' && (
        <div className="session-bar">
          <span>
            <i className="status-dot" /> ВАШЕ ПРОСТРАНСТВО <b>/</b>{' '}
            <span className="session-restaurant">{profile.restaurantName}</span>
          </span>
          <span>
            DESCRIPTION ENGINE <b>/</b>{' '}
            {localLora
              ? 'ЛОКАЛЬНАЯ LoRA'
              : workspace.provider === 'template'
                ? 'ШАБЛОННЫЙ РЕЖИМ'
                : 'LLM'}{' '}
            <span className="session-extra">· Данные сохранены на сервере</span>
          </span>
        </div>
      )}
      <main className={`main page-${page}`}>
        {page === 'studio' && !recipe && (
          <div className="product-empty">
            <h1>Начните с первого блюда</h1>
            <button className="button primary" onClick={() => setEditingRecipe('new')}>
              Добавить блюдо
            </button>
          </div>
        )}
        {page === 'studio' && recipe && (
          <>
            <div className="page-heading studio-heading">
              <div>
                <p className="eyebrow">Раздел 01 · Мультиплатформенная дистрибуция</p>
                <h1>
                  Студия генерации <span className="amp">&</span> Playground
                </h1>
              </div>
              <div className="mode-label">
                <span>РЕЖИМ:</span>
                <span className="tag">
                  {localLora
                    ? 'ЛОКАЛЬНАЯ LoRA'
                    : workspace.provider === 'template'
                      ? 'ШАБЛОННЫЙ · БЕЗ LLM'
                      : 'LLM · ПРОВЕРЬТЕ РЕЗУЛЬТАТ'}
                </span>
              </div>
            </div>
            {localLora && (
              <div className="notice local-lora-notice">
                <p>
                  Локальная LoRA работает без платного API. Нужны название, ингредиенты и способ
                  приготовления на выбранном языке. Один нейтральный текст до 250 символов
                  копируется в четыре канала. Настройки голоса бренда не применяются; перевод и
                  разные стили этой версией не поддерживаются. Одинаковые данные дают одинаковый
                  ответ. После генерации проверьте текст и при необходимости отредактируйте его.
                </p>
              </div>
            )}
            <div className="studio-grid">
              <section className="recipe-panel" aria-label="Настройки генерации">
                <div className="section-intro">
                  <h2>
                    Технологическая карта <span className="amp">&</span> Преференции
                  </h2>
                  <p>
                    Формирование редакционного описания на основе гастрономических параметров и
                    строгих стилистических рамок.
                  </p>
                </div>
                <button className="selected-recipe" onClick={() => setEditingRecipe(recipe)}>
                  <div className="row-between">
                    <span className="small-label">Выбранное блюдо</span>
                    <span className="ref">REF: {recipe.id}</span>
                  </div>
                  <h3>
                    {recipe.name} {recipe.subtitle}
                  </h3>
                  <div className="recipe-meta">
                    {recipe.category && <span>Курс: {recipe.category}</span>}
                    {recipe.weight > 0 && <span>{recipe.weight} г</span>}
                    {recipe.price > 0 && <span>{money(recipe.price)}</span>}
                    <PencilLine size={14} />
                  </div>
                </button>
                <div className="field-block">
                  <div className="row-between field-label">
                    <span>Ингредиентный состав (manifest)</span>
                    <span className="mono">{recipe.ingredients.length} компонентов</span>
                  </div>
                  <div className="ingredients">
                    {recipe.ingredients.map((item, index) => (
                      <span className="ingredient" key={`${item}-${index}`}>
                        {item}
                      </span>
                    ))}
                    <button
                      className="ingredient add-ingredient"
                      onClick={() => setEditingRecipe(recipe)}
                      aria-label="Изменить ингредиенты"
                    >
                      <Plus size={13} />
                    </button>
                  </div>
                </div>
                <div className="field-block">
                  <div className="field-label">Метод термообработки & текстура</div>
                  <p className="method">{recipe.method}</p>
                </div>
                <fieldset className="field-block tones">
                  <legend className="field-label">Регистр повествования (tone of voice)</legend>
                  {tones
                    .filter((t) => !localLora || t.id === 'editorial')
                    .map((t) => (
                      <label
                        className={`tone-option ${tone === t.id ? 'selected' : ''}`}
                        key={t.id}
                      >
                        <input
                          type="radio"
                          name="tone"
                          value={t.id}
                          checked={tone === t.id}
                          onChange={() => setTone(t.id)}
                        />
                        <span>
                          <strong>{localLora ? 'Нейтральное описание · LoRA' : t.title}</strong>
                          <small>
                            {localLora
                              ? 'Состав и способ приготовления из техкарты, без смены стиля.'
                              : t.desc}
                          </small>
                        </span>
                      </label>
                    ))}
                </fieldset>
                <label className="product-field">
                  Язык описания
                  <select
                    aria-label="Язык описания"
                    value={language}
                    onChange={(e) => setLanguage(e.target.value as 'ru' | 'kk')}
                  >
                    <option value="ru">Русский</option>
                    <option value="kk">Қазақша</option>
                  </select>
                </label>
                <div className="product-tags" aria-label="Извлечённые теги">
                  {recipe.tags?.map((tag) => (
                    <span key={tag.id} title={`Источник: ${tag.evidence?.text ?? ''}`}>
                      {tag.label}
                      {tag.kind === 'allergen' ? ' *' : ''}
                    </span>
                  ))}
                </div>
                {!!recipe.tags?.some((tag) => tag.kind === 'allergen') && (
                  <p className="footnote">
                    * Возможный аллерген по составу; требует подтверждения.
                  </p>
                )}
                <div className="field-block">
                  <div className="field-label">Редакционные проверки</div>
                  <div className="filter-row">
                    <ShieldCheck size={16} />
                    <span>Состав и аллергены — сверить по техкарте</span>
                    <span className="tag">REVIEW</span>
                  </div>
                  <div className="filter-row">
                    <CheckCircle2 size={16} />
                    <span>Без эмодзи во всех каналах</span>
                    <span className="tag">APPLIED</span>
                  </div>
                  <div className="filter-row strict">
                    <Flower2 size={16} />
                    <span>Zero Superlatives · фильтр штампов</span>
                    <span className="tag">STRICT</span>
                  </div>
                  <p className="footnote">
                    * Стоп-слова: «изысканный», «незабываемый», «волшебный», «лучший», «сочный»,
                    «пальчики оближешь».
                  </p>
                </div>
                <button
                  className="button primary generate-button"
                  onClick={doGenerate}
                  disabled={generating}
                >
                  {generating ? (
                    <LoaderCircle size={17} className="spin" />
                  ) : (
                    <Sparkles size={17} />
                  )}
                  <span>
                    {generating
                      ? 'Формируем описания…'
                      : localLora
                        ? 'Получить описание LoRA'
                        : 'Сгенерировать для всех каналов'}
                  </span>
                  <kbd>⌘ ↵</kbd>
                </button>
                <div className="generation-note">
                  <span>
                    {localLora
                      ? 'Локальная модель · на CPU может потребоваться до 2 минут'
                      : workspace.provider === 'template'
                        ? 'Шаблонный режим · без перевода исходных полей'
                        : 'Генерация через LLM'}
                  </span>
                  <span>4 канала / {language.toUpperCase()}</span>
                </div>
                <div className="atelier-note">
                  <Flower2 size={24} strokeWidth={1} />
                  <p>
                    Хороший текст начинается
                    <br />с уважения к продукту.
                  </p>
                  <span>L’ESPRIT DE L’ATELIER</span>
                </div>
              </section>
              <section
                className={`results-panel ${generating ? 'is-generating' : ''}`}
                aria-label="Результаты генерации"
                aria-busy={generating}
              >
                {!result.id && (
                  <div className="product-empty studio-empty">
                    <Sparkles size={30} strokeWidth={1} />
                    <h2>Здесь появится голос вашего меню</h2>
                    <p>
                      Выберите язык и тон, затем нажмите «Сгенерировать». Готовые тексты сохранятся
                      в истории.
                    </p>
                  </div>
                )}
                {!!result.id && (
                  <>
                    <div className="result-status">
                      <span>
                        <i className="status-dot" />{' '}
                        {generating
                          ? 'Подготовка редакционных вариантов…'
                          : stale
                            ? 'Параметры изменены · сгенерируйте новые тексты'
                            : result.provider === 'local-lora'
                              ? result.editedAt
                                ? 'Ручная редакция · проверьте перед публикацией'
                                : 'Один текст для четырёх каналов'
                              : 'Четыре варианта · готовы к редактуре'}
                      </span>
                      <span className="status-right">
                        {result.provider === 'local-lora'
                          ? 'LOCAL LoRA'
                          : result.provider === 'openai-compatible'
                            ? 'LLM'
                            : 'TEMPLATE'}{' '}
                        <Check size={12} />
                      </span>
                    </div>
                    {result.provider === 'local-lora' && (
                      <p className="footnote">
                        {result.editedAt
                          ? `Исходная модель: ${result.providerModel}. Текст изменён вручную; проверки модели относятся к исходному ответу.`
                          : `Модель: ${result.providerModel}. Один проверенный ответ модели, без адаптации под каналы.`}
                      </p>
                    )}
                    <article className="result-card marketplace">
                      <div className="card-heading">
                        <div>
                          <span className="channel-tag">Канал: Яндекс.Еда</span>
                          <span className="card-caption">
                            Лимит витрины: {resultLimits.yandex} симв.
                          </span>
                        </div>
                        {actionButtons('yandex')}
                      </div>
                      <div className="dish-preview">
                        <div className="dish-description">
                          <div className="row-between dish-title">
                            <h3>{result.name}</h3>
                            {result.price > 0 && <span>{money(result.price)}</span>}
                          </div>
                          {result.weight > 0 && <p className="dish-weight">{result.weight} г</p>}
                          <p className="editorial-text">«{result.texts.yandex}»</p>
                          <div className="result-meta">
                            <CharacterCount
                              text={result.texts.yandex}
                              limit={resultLimits.yandex}
                            />
                            <span className="tag">
                              {/\p{Extended_Pictographic}/u.test(result.texts.yandex)
                                ? 'Есть эмодзи'
                                : 'NO EMOJI'}
                            </span>
                            <span className="text-brass">Ручная редактура доступна</span>
                          </div>
                        </div>
                      </div>
                    </article>
                    <article className="result-card">
                      <div className="card-heading">
                        <div>
                          <span className="channel-tag brass">Канал: Wolt Global</span>
                          <span className="card-caption">
                            Editorial формат до {resultLimits.wolt} симв.
                          </span>
                        </div>
                        {actionButtons('wolt')}
                      </div>
                      <div className="row-between">
                        <span className="eyebrow">Компактная подача</span>
                        <CharacterCount text={result.texts.wolt} limit={resultLimits.wolt} />
                      </div>
                      <p className="editorial-text wolt-text">«{result.texts.wolt}»</p>
                      <div className="card-bottom">
                        <span>
                          Язык: {(result.language ?? language).toUpperCase()} · Краткое описание
                        </span>
                        <span className="mono">{result.texts.wolt.split(/\s+/).length} слов</span>
                      </div>
                    </article>
                    <article className="result-card master-card">
                      <span className="floating-label">MASTER ATELIER TEXT</span>
                      <div className="card-heading">
                        <div>
                          <span className="channel-tag">Фирменное приложение & carte des mets</span>
                          <span className="card-caption">
                            Full storytelling · {resultLimits.website} симв.
                          </span>
                        </div>
                        {actionButtons('website')}
                      </div>
                      <div className="master-text">
                        <span className="roman">IV.</span>
                        <blockquote>«{result.texts.website}»</blockquote>
                      </div>
                      {result.pairing && (
                        <div className="pairing">
                          <Wine size={17} />
                          <div>
                            <span className="eyebrow">Эногастрономический пейринг</span>
                            <p>
                              Рекомендация сомелье:
                              <br />
                              {result.pairing}
                            </p>
                          </div>
                        </div>
                      )}
                      <div className="card-bottom">
                        <CharacterCount text={result.texts.website} limit={resultLimits.website} />
                        <span className="mono">
                          Стиль: {tones.find((t) => t.id === result.tone)?.id.toUpperCase()}
                        </span>
                      </div>
                    </article>
                    <article className="result-card print-card">
                      <div className="card-heading">
                        <div>
                          <span className="channel-tag">Печатное меню</span>
                          <span className="card-caption">Короткая подача для карты меню</span>
                        </div>
                        {actionButtons('print')}
                      </div>
                      <p className="editorial-text">«{result.texts.print}»</p>
                      <div className="card-bottom">
                        <span>Готово для вёрстки меню</span>
                        <CharacterCount text={result.texts.print} limit={resultLimits.print} />
                      </div>
                    </article>
                    {result.provider !== 'local-lora' && (
                      <article className="result-card variant-card">
                        <div className="card-heading">
                          <div>
                            <span className="tag">A/B СПЛИТ: МАРКЕТПЛЕЙС 2</span>
                            <span className="card-caption">Фокус на ремесло & фактуру</span>
                          </div>
                          {actionButtons('variant')}
                        </div>
                        <p className="editorial-text">«{result.variant}»</p>
                        <div className="card-bottom">
                          <span>Альтернативная редакция · вариант B</span>
                          <span className="mono">{result.variant.length} симв.</span>
                        </div>
                      </article>
                    )}
                    <div className="export-bar">
                      <div>
                        <Clipboard size={18} />
                        <span>
                          <strong>
                            {published && published === result.id
                              ? 'Редакция сохранена'
                              : 'Готово к передаче в меню'}
                          </strong>
                          <small>JSON для четырёх каналов дистрибуции</small>
                        </span>
                      </div>
                      <div className="export-actions">
                        <button
                          className="button secondary"
                          disabled={!result.id}
                          onClick={() => {
                            download(result, `mise-${result.recipeId}.json`);
                            notify('JSON экспортирован');
                          }}
                        >
                          <ArrowDownToLine size={15} />
                          Экспорт JSON
                        </button>
                        <button
                          className="button primary"
                          disabled={!result.id}
                          onClick={() => setPublishOpen(true)}
                        >
                          Подготовить к публикации
                          <ArrowRight size={15} />
                        </button>
                      </div>
                    </div>
                    {!!result.id && (
                      <div className="feedback-bar">
                        <span>Подходит вашему ресторану?</span>
                        {[1, -1].map((value) => (
                          <button
                            key={value}
                            className="button secondary"
                            aria-pressed={result.feedback === value}
                            onClick={async () => {
                              try {
                                const feedback = result.feedback === value ? 0 : value;
                                await send(`/generations/${result.id}/feedback`, 'PUT', {
                                  value: feedback,
                                });
                                setResult((prev) => ({ ...prev, feedback }));
                                notify('Оценка учтена в персональной подборке');
                              } catch (error) {
                                notify(errorMessage(error));
                              }
                            }}
                          >
                            {value === 1 ? 'Подходит' : 'Нужно доработать'}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </section>
            </div>
          </>
        )}
        {(page === 'channels' || page === 'brand') && (
          <ChannelsPage
            key={page}
            brandOnly={page === 'brand'}
            settings={settings}
            result={result}
            onSave={saveSettings}
            notify={notify}
          />
        )}
        {page === 'docs' && <ApiDocs />}
        {page === 'personalization' && (
          <Personalization
            recipes={recipes}
            onRecipesChange={setRecipes}
            provider={workspace.provider}
          />
        )}
        {page === 'profile' && (
          <Account
            user={workspace.user}
            profile={profile}
            onSave={saveProfile}
            onLogout={onLogout}
            onSelect={(r) => {
              setSelectedId(r.id);
              go('studio');
            }}
          />
        )}
        {page === 'history' && (
          <History
            onSelect={(value) => {
              if (!recipes.some((r) => r.id === value.recipeId)) {
                download(value, `mise-${value.id}.json`);
                notify('Блюдо удалено. Историческая редакция скачана.');
                return;
              }
              setResult(value);
              setSelectedId(value.recipeId);
              setTone(localLora ? 'editorial' : value.tone);
              setLanguage(value.language ?? 'ru');
              go('studio');
            }}
          />
        )}
        {page === 'library' && (
          <LibraryPage
            recipes={recipes}
            selectedId={selectedId}
            onEdit={setEditingRecipe}
            onSelect={(r) => {
              setSelectedId(r.id);
              go('studio');
            }}
          />
        )}
      </main>
      <footer className="site-footer">
        <div>
          <span className="footer-wordmark">L’Atelier Gastronomique</span>
          <span className="footer-divider">·</span>
          <span>© {new Date().getFullYear()} MenuMind. Искусство точного слова.</span>
        </div>
        <div>
          <button onClick={() => go('docs')}>ARCHIVAL CODEX</button>
          <span>/</span>
          <button onClick={() => go('brand')}>BRAND MANIFESTO</button>
          <span>/</span>
          <span className="footer-status">
            <i className="status-dot" /> MENUMIND STUDIO
          </span>
        </div>
      </footer>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={17} />
          <span>{toast}</span>
          <button
            className="icon-button"
            aria-label="Закрыть уведомление"
            onClick={() => setToast('')}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {editingRecipe && (
        <RecipeEditor
          recipe={editingRecipe}
          onClose={() => setEditingRecipe(null)}
          onSave={saveRecipe}
          onDelete={deleteRecipe}
        />
      )}
      {editText && (
        <Modal title="Редактура описания" onClose={() => setEditText(null)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!editText.text.trim() || editBusy) return;
              const key = editText.key;
              setEditBusy(true);
              setEditError('');
              try {
                const body = {
                  texts:
                    key === 'variant'
                      ? result.texts
                      : { ...result.texts, [key]: editText.text.trim() },
                  variant: key === 'variant' ? editText.text.trim() : result.variant,
                };
                setResult(await send<Result>(`/generations/${result.id}`, 'PATCH', body));
                setEditText(null);
                notify('Редакция сохранена');
              } catch (error) {
                setEditError(errorMessage(error));
              } finally {
                setEditBusy(false);
              }
            }}
          >
            <label className="input-label" htmlFor="edit-description">
              Текст для{' '}
              {editText.key === 'variant'
                ? 'варианта B'
                : channels.find((c) => c.id === editText.key)?.name}
            </label>
            <textarea
              id="edit-description"
              className="edit-description"
              required
              value={editText.text}
              maxLength={resultLimits[editText.key === 'variant' ? 'yandex' : editText.key]}
              onChange={(e) => setEditText({ ...editText, text: e.target.value })}
            />
            <div className="row-between">
              <CharacterCount
                text={editText.text}
                limit={resultLimits[editText.key === 'variant' ? 'yandex' : editText.key]}
              />
              <span className="muted">Проверьте состав по техкарте</span>
            </div>
            <div className="modal-actions">
              <button type="button" className="button secondary" onClick={() => setEditText(null)}>
                Отмена
              </button>
              <button className="button primary" disabled={!editText.text.trim() || editBusy}>
                Сохранить редакцию
              </button>
            </div>
            {editError && (
              <p className="form-error" role="alert">
                {editError}
              </p>
            )}
          </form>
        </Modal>
      )}
      {publishOpen && (
        <Modal title="Передача в каналы" onClose={() => setPublishOpen(false)}>
          <p className="modal-copy">
            Проверьте описания перед отправкой. Интеграции с витринами ещё не подключены — готовый
            пакет можно скачать и передать в вашу систему меню.
          </p>
          <div className="publish-list">
            {channels.map((c) => (
              <div key={c.id}>
                <span>
                  <CheckCircle2 size={17} />
                  {c.name}
                </span>
                <CharacterCount text={result.texts[c.id]} limit={resultLimits[c.id]} />
              </div>
            ))}
          </div>
          <div className="notice">
            <ShieldCheck size={18} />
            <p>Состав, аллергены и пейринг требуют проверки ответственного сотрудника ресторана.</p>
          </div>
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setPublishOpen(false)}>
              Вернуться
            </button>
            <button
              className="button primary"
              disabled={!publishValid}
              onClick={() => {
                download(
                  { ...result, status: 'ready_for_review', channels: channels.map((c) => c.id) },
                  `mise-publication-${result.recipeId}.json`,
                );
                setPublished(result.id);
                setPublishOpen(false);
                notify('Пакет для публикации скачан. Внешние каналы не подключены.');
              }}
            >
              Скачать пакет
              <ArrowDownToLine size={15} />
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function CharacterCount({ text, limit }: { text: string; limit: number }) {
  return (
    <span className={`count ${text.length > limit ? 'over-limit' : ''}`}>
      {text.length} / {limit} симв.
    </span>
  );
}

function RecipeEditor({
  recipe,
  onSave,
  onClose,
  onDelete,
}: {
  recipe: Recipe | 'new';
  onSave: (r: Recipe) => Promise<void>;
  onClose: () => void;
  onDelete: (id: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Recipe>(() =>
    recipe === 'new'
      ? {
          id: `RCP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
          name: '',
          subtitle: '',
          ingredients: [],
          method: '',
          category: 'Основное',
          weight: 0,
          price: 0,
          pairing: '',
        }
      : { ...recipe },
  );
  const [ingredientsText, setIngredientsText] = useState(draft.ingredients.join('\n'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const update = <K extends keyof Recipe>(key: K, value: Recipe[K]) =>
    setDraft({ ...draft, [key]: value });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const ingredients = ingredientsText
      .split(/[\n;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!draft.name.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await onSave({ ...draft, name: draft.name.trim(), ingredients, method: draft.method.trim() });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={recipe === 'new' ? 'Новая технологическая карта' : 'Технологическая карта'}
      onClose={onClose}
    >
      <form onSubmit={submit} className="recipe-form">
        <label>
          Название блюда
          <input
            required
            maxLength={100}
            value={draft.name}
            onChange={(e) => update('name', e.target.value)}
            placeholder="Например, Томлёная говяжья щека"
          />
        </label>
        <label>
          Дополнение к названию
          <input
            maxLength={150}
            value={draft.subtitle}
            onChange={(e) => update('subtitle', e.target.value)}
            placeholder="с пюре из печёного сельдерея"
          />
        </label>
        <div className="form-row">
          <label>
            Курс
            <select value={draft.category} onChange={(e) => update('category', e.target.value)}>
              <option>Основное</option>
              <option>Закуска</option>
              <option>Десерт</option>
              <option>Суп</option>
            </select>
          </label>
          <label>
            Вес, г
            <input
              type="number"
              min="0"
              max="20000"
              value={draft.weight}
              onChange={(e) => update('weight', Number(e.target.value))}
            />
          </label>
          <label>
            Цена, ₽
            <input
              type="number"
              min="0"
              max="1000000"
              value={draft.price}
              onChange={(e) => update('price', Number(e.target.value))}
            />
          </label>
        </div>
        <label>
          Ингредиенты <span className="muted">· по одному на строку</span>
          <textarea
            rows={5}
            value={ingredientsText}
            onChange={(e) => setIngredientsText(e.target.value)}
          />
        </label>
        <label>
          Метод приготовления
          <textarea
            rows={3}
            maxLength={1000}
            value={draft.method}
            onChange={(e) => update('method', e.target.value)}
          />
        </label>
        <label>
          Рекомендация сомелье
          <input
            maxLength={200}
            value={draft.pairing}
            onChange={(e) => update('pairing', e.target.value)}
            placeholder="Вино или безалкогольный пейринг"
          />
        </label>
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Отмена
          </button>
          <button className="button primary" disabled={busy}>
            Сохранить карту
            <Check size={15} />
          </button>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {recipe !== 'new' && (
          <button
            type="button"
            className="delete-recipe"
            disabled={busy}
            onClick={async () => {
              if (!window.confirm('Удалить это блюдо? История описаний сохранится.')) return;
              setBusy(true);
              try {
                await onDelete(recipe.id);
              } catch (err) {
                setError(errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            Удалить блюдо
          </button>
        )}
      </form>
    </Modal>
  );
}

function LibraryPage({
  recipes,
  selectedId,
  onEdit,
  onSelect,
}: {
  recipes: Recipe[];
  selectedId: string;
  onEdit: (r: Recipe | 'new') => void;
  onSelect: (r: Recipe) => void;
}) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('Все блюда');
  const filtered = recipes.filter(
    (r) =>
      (category === 'Все блюда' || r.category === category) &&
      `${r.name} ${r.subtitle} ${r.ingredients.join(' ')}`
        .toLocaleLowerCase('ru')
        .includes(search.toLocaleLowerCase('ru')),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Раздел 05 · Кулинарный архив</p>
          <h1>Библиотека рецептов</h1>
          <p className="page-description">
            Продукт, техника и происхождение. Всё, с чего начинается ваше меню.
          </p>
        </div>
        <button className="button primary" onClick={() => onEdit('new')}>
          <Plus size={16} />
          Добавить блюдо
        </button>
      </div>
      <div className="library-toolbar">
        <div className="search-field">
          <Search size={17} />
          <input
            aria-label="Поиск блюд"
            placeholder="Название блюда или ингредиент…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              className="icon-button"
              aria-label="Очистить поиск"
              onClick={() => setSearch('')}
            >
              <X size={15} />
            </button>
          )}
        </div>
        <div className="filter-tabs">
          {['Все блюда', 'Основное', 'Закуска', 'Десерт', 'Суп'].map((c) => (
            <button
              className={category === c ? 'active' : ''}
              key={c}
              onClick={() => setCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>
        <span className="mono muted">
          {filtered.length} / {recipes.length} карт
        </span>
      </div>
      <div className="recipe-library">
        {filtered.map((r, index) => (
          <article className="library-card" key={r.id}>
            <div className="library-body">
              <div className="library-card-heading">
                <span className="library-number">{String(index + 1).padStart(2, '0')}</span>
                <span className="library-category">{r.category}</span>
              </div>
              <div className="row-between">
                <span className="eyebrow">{r.id}</span>
                {selectedId === r.id && <span className="tag">В СТУДИИ</span>}
              </div>
              <h2>{r.name}</h2>
              {r.subtitle && <p className="library-subtitle">{r.subtitle}</p>}
              <p className="library-ingredients">{r.ingredients.join(' · ')}</p>
              <div className="product-tags">
                {r.tags?.map((tag) => (
                  <span key={tag.id} title={`Источник: ${tag.evidence?.text ?? ''}`}>
                    {tag.label}
                  </span>
                ))}
              </div>
              {(r.weight > 0 || r.price > 0) && (
                <div className="row-between library-price">
                  <span>{r.weight > 0 ? `${r.weight} г` : ''}</span>
                  {r.price > 0 && <span>{money(r.price)}</span>}
                </div>
              )}
              <div className="library-actions">
                <button className="text-button" onClick={() => onSelect(r)}>
                  Открыть в студии
                  <ArrowRight size={16} />
                </button>
                <button
                  className="icon-button"
                  aria-label={`Редактировать ${r.name}`}
                  onClick={() => onEdit(r)}
                >
                  <PencilLine size={17} />
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
      {!filtered.length && (
        <div className="empty-state">
          <Search size={30} strokeWidth={1} />
          <h2>В этой коллекции пока пусто</h2>
          <p>Попробуйте другой запрос или добавьте новое блюдо.</p>
          <button
            className="button secondary"
            onClick={() => {
              setSearch('');
              setCategory('Все блюда');
            }}
          >
            Показать все блюда
          </button>
        </div>
      )}
      <div className="section-tail">
        <span className="eyebrow">LE RÉPERTOIRE GASTRONOMIQUE</span>
        <span>Технологические карты сохраняются в вашем аккаунте на сервере.</span>
        <Leaf size={17} strokeWidth={1} />
      </div>
    </>
  );
}

function ChannelsPage({
  brandOnly,
  settings,
  result,
  onSave,
  notify,
}: {
  brandOnly: boolean;
  settings: Settings;
  result: Result;
  onSave: (s: Settings) => Promise<void>;
  notify: (m: string) => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [activeChannel, setActiveChannel] = useState<ChannelId | null>(null);
  const [channelLimit, setChannelLimit] = useState(250);
  const [sample, setSample] = useState<{ index: number; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const update = (value: Partial<Settings>) => {
    setDraft({ ...draft, ...value });
    setDirty(true);
  };
  const save = async () => {
    setSaving(true);
    try {
      await onSave(draft);
      setDirty(false);
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <div className="config-kicker">
        <span>
          ATELIER CONFIGURATION <b>/</b>{' '}
          {brandOnly ? 'BRAND VOICE & EDITORIAL DNA' : 'BRAND PROFILE & CHANNELS'}
        </span>
      </div>
      <div className="page-heading config-heading">
        <div>
          <p className="eyebrow">Distribution engine · Version 4.2</p>
          <h1>
            {brandOnly ? (
              <>
                Голос бренда <span className="amp">&</span>
                <br />
                редакционная культура
              </>
            ) : (
              <>
                Матрица адаптеров каналов доставки <span className="amp">&</span>
                <br />
                Тон бренда
              </>
            )}
          </h1>
          <p className="page-description">
            {brandOnly
              ? 'У каждого ресторана свой почерк. Настройте точность формулировок, характер повествования и внимание к гастрономическим деталям.'
              : 'Управление лимитами агрегаторов, фильтрами стоп-слов и профилем заведения. Контроль лексической чистоты и автоматической коррекции меню без потери гастрономического нарратива.'}
          </p>
        </div>
        <div className="config-status">
          <span className="tag">
            <ShieldCheck size={15} /> РЕДАКЦИОННЫЙ ПРОФИЛЬ
          </span>
          <small>{dirty ? 'Есть несохранённые изменения' : 'Настройки сохранены на сервере'}</small>
        </div>
      </div>
      {!brandOnly && (
        <>
          <div className="section-label">
            <span>
              <span className="serif">I. АДАПТЕРЫ ВИТРИН</span>
              <b>—</b> Правила сжатия, регистры и лексические барьеры
            </span>
            <span>4 АКТИВНЫХ ПРОФИЛЯ</span>
          </div>
          <div className="channel-grid">
            {channels.map((c, i) => (
              <article key={c.id} className="channel-card">
                <div className="row-between">
                  <span className="eyebrow mono">{c.code}</span>
                  <span className="tag">
                    {i < 2 ? 'ACTIVE' : i === 2 ? 'EXCLUSIVE' : 'PAPERPRESS'}
                  </span>
                </div>
                <h2>{c.name}</h2>
                <p className="channel-subtitle">{c.label}</p>
                <dl className="channel-properties">
                  <div>
                    <dt>Лимит символов</dt>
                    <dd className="mono">{draft.limits[c.id]} симв.</dd>
                  </div>
                  <div>
                    <dt>{i === 3 ? 'Верстка полосы' : 'Режим подачи'}</dt>
                    <dd>
                      {
                        [
                          'Краткое описание',
                          'Ultra-concise list',
                          'Кулинарный сторителлинг',
                          'Французская колонка',
                        ][i]
                      }
                    </dd>
                  </div>
                  <div>
                    <dt>{i === 3 ? 'Типографика' : 'Политика эмодзи'}</dt>
                    <dd>{i === 3 ? 'Garamond / Italic' : 'Zero emoji'}</dd>
                  </div>
                  <div>
                    <dt>{i === 3 ? 'Язык печати' : 'Локализация'}</dt>
                    <dd>{i === 3 ? 'Русский' : 'RU'}</dd>
                  </div>
                </dl>
                <div className="channel-detail">
                  <span className="eyebrow">
                    {
                      [
                        'Активные стоп-слова',
                        'Правило форматирования',
                        'Редакционные акценты',
                        'Классические термины',
                      ][i]
                    }
                  </span>
                  {i === 0 ? (
                    <div className="stop-words">
                      {forbidden.slice(0, 4).map((w) => (
                        <span key={w}>{w}</span>
                      ))}
                    </div>
                  ) : i === 1 ? (
                    <p className="mono format-rule">
                      [Главный ингредиент], [метод], [соус], [нота свежести].
                    </p>
                  ) : (
                    <div className="stop-words neutral">
                      {(i === 2
                        ? ['+История блюда', '+Терруар', '+Пейринг']
                        : ['Sous-vide', 'Confit', 'Demi-glace']
                      ).map((w) => (
                        <span key={w}>{w}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="channel-preview">
                  <span>LIVE PREVIEW СРЕЗА:</span>
                  <p>«{constrain(result.texts[c.id], 100)}»</p>
                </div>
                <button
                  className="channel-edit"
                  onClick={() => {
                    setActiveChannel(c.id);
                    setChannelLimit(draft.limits[c.id]);
                  }}
                >
                  Настроить канал
                  <SlidersHorizontal size={14} />
                </button>
              </article>
            ))}
          </div>
          <div className="ornament">
            <span />
            <Flower2 size={17} strokeWidth={1} />
            <span />
          </div>
        </>
      )}
      <div className="brand-grid">
        <section className="corpus-panel">
          <p className="eyebrow">Эталонные тексты · контекст бренда</p>
          <div className="row-between corpus-title">
            <h2>
              Эталонный банк Few-Shot образцов <span>({draft.samples.length} текста)</span>
            </h2>
            <span className="tag mono">
              EDITORIAL
              <br />
              REFERENCE
            </span>
          </div>
          <p className="corpus-description">
            Образцы задают литературный ориентир: точность ресторанного критика, уважение к
            происхождению продукта и внимание к ремеслу.
          </p>
          <p className="corpus-description">
            LLM получает два образца, выбранных по совпадению слов с техкартой. В шаблонном режиме
            образцы не используются.
          </p>
          <div className="sample-grid">
            {draft.samples.map((text, i) => (
              <article className="sample-card" key={i}>
                <div className="row-between">
                  <span className="eyebrow">
                    Образец #{String(i + 1).padStart(2, '0')} ·{' '}
                    {i === 0 ? 'SEAFOOD MASTER' : i === 1 ? 'GAME & FOREST' : 'BRAND VOICE'}
                  </span>
                  <button
                    className="icon-button"
                    aria-label={`Редактировать образец ${i + 1}`}
                    onClick={() => setSample({ index: i, text })}
                  >
                    <PencilLine size={13} />
                  </button>
                </div>
                <blockquote>«{text}»</blockquote>
                <div className="sample-footer">
                  <span>ТОНАЛЬНОСТЬ: {i === 0 ? 'MICHELIN RESTRAINED' : 'ACADEMIC LITERARY'}</span>
                  <i className="status-dot" />
                </div>
              </article>
            ))}
          </div>
          <button
            className="text-button add-sample"
            onClick={() => setSample({ index: draft.samples.length, text: '' })}
          >
            <Plus size={14} />
            Добавить эталонный текст
          </button>
          <div className="vector-panel">
            <div className="row-between">
              <span className="eyebrow">Ориентиры стиля</span>
              <span className="mono">EDITORIAL WEIGHTS</span>
            </div>
            <div className="vector-weights">
              {[
                ['ТЕРРУАР / ЛОГИСТИКА', 'Provenance'],
                ['ФИЗИКА СОУСА', 'Viscosity'],
                ['ИСТОРИЯ СЫРЬЯ', 'Heritage'],
                ['АНТИ-ХАЙП ФИЛЬТР', 'Cliché Ban'],
              ].map(([a, b]) => (
                <div key={a}>
                  <span>{a}</span>
                  <strong>{b}</strong>
                </div>
              ))}
            </div>
          </div>
        </section>
        <aside className="tone-regulators">
          <p className="eyebrow">НАСТРОЙКИ СТИЛЯ</p>
          <h2>Регуляторы тональности</h2>
          <p>Тонкая настройка баланса строгости и сенсорных дескрипторов.</p>
          {(
            [
              {
                key: 'restraint',
                title: 'Уровень сдержанности',
                description: 'От живого гастро-бистро до академического ресторанного путеводителя.',
                left: 'BISTRO CASUAL',
                right: 'MICHELIN STANDARD',
              },
              {
                key: 'sensory',
                title: 'Сенсорная детализация',
                description:
                  'Текстура, минеральность вкуса, микротекстура и способ тепловой обработки.',
                left: 'СУХОЙ РЕЦЕПТ',
                right: 'ОРГАНОЛЕПТИКА',
              },
              {
                key: 'strictness',
                title: 'Строгость словаря',
                description:
                  'Стилевой ориентир для LLM. Запрет превосходных степеней и обещаний пользы действует всегда.',
                left: 'МЯГКИЙ ФИЛЬТР',
                right: 'ZERO-TOLERANCE',
              },
            ] as const
          ).map((s) => (
            <div className="slider-card" key={s.key}>
              <label className="row-between" htmlFor={s.key}>
                <strong>{s.title}</strong>
                <span className="mono">{draft[s.key]}%</span>
              </label>
              <p>{s.description}</p>
              <input
                type="range"
                id={s.key}
                min="0"
                max="100"
                value={draft[s.key]}
                style={{ '--range': `${draft[s.key]}%` } as React.CSSProperties}
                onChange={(e) => update({ [s.key]: Number(e.target.value) })}
              />
              <div className="range-labels">
                <span>{s.left}</span>
                <span>{s.right}</span>
              </div>
            </div>
          ))}
          <button className="button primary save-profile" disabled={saving} onClick={save}>
            <Flower2 size={18} />
            <span>Сохранить профиль ресторана</span>
          </button>
          <div className="generation-note">
            <span>Профиль ресторана</span>
            <span>{dirty ? 'НЕ СОХРАНЕНО' : 'СОХРАНЕНО'}</span>
          </div>
        </aside>
      </div>
      <div className="section-tail">
        <span className="eyebrow">ESCOFFIER STANDARD CODEX</span>
        <span>Сохранённые настройки применяются при следующей генерации.</span>
        <span className="mono">SERVER PROFILE · V1.0</span>
      </div>
      {activeChannel && (
        <Modal
          title={`Настройки · ${channels.find((c) => c.id === activeChannel)?.name}`}
          onClose={() => setActiveChannel(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              update({ limits: { ...draft.limits, [activeChannel]: channelLimit } });
              setActiveChannel(null);
              notify('Лимит изменён. Сохраните профиль ресторана для применения.');
            }}
          >
            <label className="input-label">
              Максимальная длина описания
              <input
                type="number"
                min="50"
                max="1000"
                required
                value={channelLimit}
                onChange={(e) => setChannelLimit(Number(e.target.value))}
              />
            </label>
            <p className="footnote">
              Рабочий лимит из вашего брифа. Условия внешней витрины необходимо проверить перед
              интеграцией.
            </p>
            <div className="notice">
              <FileText size={18} />
              <p>{constrain(result.texts[activeChannel], Math.max(1, channelLimit))}</p>
            </div>
            <div className="modal-actions">
              <button className="button primary">Применить</button>
            </div>
          </form>
        </Modal>
      )}
      {sample && (
        <Modal title="Эталонный текст" onClose={() => setSample(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!sample.text.trim()) return;
              const samples = [...draft.samples];
              samples[sample.index] = sample.text.trim();
              update({ samples });
              setSample(null);
            }}
          >
            <label className="input-label">
              Описание в голосе вашего ресторана
              <textarea
                required
                rows={7}
                maxLength={1200}
                value={sample.text}
                onChange={(e) => setSample({ ...sample, text: e.target.value })}
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="button secondary" onClick={() => setSample(null)}>
                Отмена
              </button>
              <button className="button primary" disabled={!sample.text.trim()}>
                Добавить в профиль
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

export default App;
