import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  Clipboard,
  Code2,
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
  UtensilsCrossed,
  Wine,
  X,
} from 'lucide-react';
import {
  channels,
  constrain,
  defaultRecipes,
  defaultSettings,
  download,
  forbidden,
  generate,
  generationFingerprint,
  initialResult,
  readStorage,
  saveStorage,
  tones,
  type ChannelId,
  type Page,
  type Recipe,
  type Result,
  type Settings,
  type Tone,
} from './model';

const nav: { id: Page; label: string }[] = [
  { id: 'studio', label: 'Студия генерации' },
  { id: 'channels', label: 'Витрины каналов' },
  { id: 'brand', label: 'Тон бренда & RAG' },
  { id: 'docs', label: 'API документация' },
  { id: 'library', label: 'Библиотека рецептов' },
];
const getPage = (): Page =>
  nav.some((n) => n.id === location.hash.slice(1)) ? (location.hash.slice(1) as Page) : 'studio';
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

function App() {
  const [page, setPage] = useState<Page>(getPage);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [recipes, setRecipes] = useState<Recipe[]>(() =>
    readStorage('mise.recipes.v1', defaultRecipes),
  );
  const [selectedId, setSelectedId] = useState(() =>
    readStorage('mise.selected.v1', defaultRecipes[0].id),
  );
  const [settings, setSettings] = useState<Settings>(() =>
    readStorage('mise.settings.v1', defaultSettings),
  );
  const [tone, setTone] = useState<Tone>(() => readStorage('mise.tone.v1', 'editorial'));
  const [result, setResult] = useState<Result>(() =>
    readStorage('mise.result.v1', initialResult()),
  );
  const [generating, setGenerating] = useState(false);
  const [toast, setToast] = useState('');
  const [editingRecipe, setEditingRecipe] = useState<Recipe | 'new' | null>(null);
  const [editText, setEditText] = useState<{ key: ChannelId | 'variant'; text: string } | null>(
    null,
  );
  const [publishOpen, setPublishOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [copied, setCopied] = useState('');
  const [published, setPublished] = useState<string>(() => readStorage('mise.published.v1', ''));
  const recipe = recipes.find((r) => r.id === selectedId) || recipes[0];
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
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
    document.title = `Mise en Place — ${nav.find((n) => n.id === page)?.label}`;
  }, [page]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(''), 4500);
      return () => clearTimeout(t);
    }
  }, [toast]);
  useEffect(() => {
    const ok = [
      saveStorage('mise.recipes.v1', recipes),
      saveStorage('mise.selected.v1', selectedId),
      saveStorage('mise.tone.v1', tone),
      saveStorage('mise.result.v1', result),
    ].every(Boolean);
    if (!ok)
      setToast('Браузер не разрешает сохранять данные. Экспортируйте результат перед закрытием.');
  }, [recipes, selectedId, tone, result]);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      clearTimeout(copyTimer.current);
    },
    [],
  );
  const doGenerate = () => {
    if (generating) return;
    setGenerating(true);
    timer.current = setTimeout(() => {
      setResult(generate(recipe, tone, settings));
      setGenerating(false);
      notify('Описания для четырёх каналов готовы');
    }, 1000);
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
  const saveRecipe = (value: Recipe) => {
    setRecipes((prev) =>
      prev.some((r) => r.id === value.id)
        ? prev.map((r) => (r.id === value.id ? value : r))
        : [...prev, value],
    );
    setSelectedId(value.id);
    setEditingRecipe(null);
    notify('Технологическая карта сохранена');
  };
  const saveSettings = (value: Settings) => {
    setSettings(value);
    notify(
      saveStorage('mise.settings.v1', value)
        ? 'Профиль ресторана сохранён в этом браузере'
        : 'Не удалось сохранить настройки в браузере',
    );
  };
  const stale = result.sourceFingerprint !== generationFingerprint(recipe, tone, settings);
  const publishValid = channels.every(
    (c) =>
      result.texts[c.id].trim().length > 0 && result.texts[c.id].length <= settings.limits[c.id],
  );
  const actionButtons = (key: ChannelId | 'variant') => (
    <div className="card-actions">
      <button
        aria-label={`Копировать ${key}`}
        className="icon-button"
        onClick={() => copy(key === 'variant' ? result.variant : result.texts[key], key)}
      >
        {copied === key ? <Check size={16} /> : <Copy size={16} />}
      </button>
      <button
        aria-label={`Редактировать ${key}`}
        className="icon-button"
        onClick={() =>
          setEditText({ key, text: key === 'variant' ? result.variant : result.texts[key] })
        }
      >
        <PencilLine size={16} />
      </button>
    </div>
  );

  return (
    <>
      <header className="site-header">
        <a className="wordmark" href="#studio" onClick={() => go('studio')}>
          <span>MISE EN PLACE</span>
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
        <button className="organization" onClick={() => setProfileOpen(true)}>
          <span>
            Maison Delacroix<small>Grand Cru Group</small>
          </span>
          <ChevronDown size={13} />
        </button>
        <span className="env-tag">STUDIO</span>
        <button
          className="avatar"
          aria-label="Профиль ресторана"
          onClick={() => setProfileOpen(true)}
        >
          MD
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
            <i className="status-dot" /> ЛОКАЛЬНАЯ СЕССИЯ <b>/</b>{' '}
            <span className="session-restaurant">Maison Delacroix & Associés</span>
          </span>
          <span>
            DESCRIPTION ENGINE <b>/</b> ДЕМО-РЕЖИМ{' '}
            <span className="session-extra">· Данные в этом браузере</span>
          </span>
        </div>
      )}
      <main className={`main page-${page}`}>
        {page === 'studio' && (
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
                <span className="tag">EDITORIAL RIGOR V2.8</span>
              </div>
            </div>
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
                    <span>Курс: {recipe.category}</span>
                    <span>{recipe.weight} г</span>
                    <span>{money(recipe.price)}</span>
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
                  {tones.map((t) => (
                    <label className={`tone-option ${tone === t.id ? 'selected' : ''}`} key={t.id}>
                      <input
                        type="radio"
                        name="tone"
                        value={t.id}
                        checked={tone === t.id}
                        onChange={() => setTone(t.id)}
                      />
                      <span>
                        <strong>{t.title}</strong>
                        <small>{t.desc}</small>
                      </span>
                    </label>
                  ))}
                </fieldset>
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
                    <span className="tag">{settings.strictness >= 70 ? 'STRICT' : 'SOFT'}</span>
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
                    {generating ? 'Формируем описания…' : 'Сгенерировать для всех каналов'}
                  </span>
                  <kbd>⌘ ↵</kbd>
                </button>
                <div className="generation-note">
                  <span>Локальный шаблонный движок</span>
                  <span>4 канала / RU</span>
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
                <div className="result-status">
                  <span>
                    <i className="status-dot" />{' '}
                    {generating
                      ? 'Подготовка редакционных вариантов…'
                      : stale
                        ? 'Параметры изменены · сгенерируйте новые тексты'
                        : 'Четыре варианта · готовы к редактуре'}
                  </span>
                  <span className="status-right">
                    DEMO <Check size={12} />
                  </span>
                </div>
                <article className="result-card marketplace">
                  <div className="card-heading">
                    <div>
                      <span className="channel-tag">Канал: Яндекс.Еда</span>
                      <span className="card-caption">
                        Лимит витрины: {settings.limits.yandex} симв.
                      </span>
                    </div>
                    {actionButtons('yandex')}
                  </div>
                  <div className="dish-preview">
                    {result.image ? (
                      <div className="dish-photo">
                        <img
                          src={result.image}
                          alt="Томлёная говяжья щека с пюре на керамической тарелке"
                        />
                        <span>{result.weight} г</span>
                      </div>
                    ) : (
                      <div className="dish-placeholder">
                        <UtensilsCrossed size={30} />
                      </div>
                    )}
                    <div className="dish-description">
                      <div className="row-between dish-title">
                        <h3>{result.name}</h3>
                        <span>{money(result.price)}</span>
                      </div>
                      <p className="editorial-text">«{result.texts.yandex}»</p>
                      <div className="result-meta">
                        <CharacterCount text={result.texts.yandex} limit={settings.limits.yandex} />
                        <span className="tag">
                          {/\p{Extended_Pictographic}/u.test(result.texts.yandex)
                            ? '???? ??????'
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
                        Editorial формат до {settings.limits.wolt} симв.
                      </span>
                    </div>
                    {actionButtons('wolt')}
                  </div>
                  <div className="row-between">
                    <span className="eyebrow">Компактная подача</span>
                    <CharacterCount text={result.texts.wolt} limit={settings.limits.wolt} />
                  </div>
                  <p className="editorial-text wolt-text">«{result.texts.wolt}»</p>
                  <div className="card-bottom">
                    <span>Язык: RU · Краткое описание</span>
                    <span className="mono">{result.texts.wolt.split(/\s+/).length} слов</span>
                  </div>
                </article>
                <article className="result-card master-card">
                  <span className="floating-label">MASTER ATELIER TEXT</span>
                  <div className="card-heading">
                    <div>
                      <span className="channel-tag">Фирменное приложение & carte des mets</span>
                      <span className="card-caption">
                        Full storytelling · {settings.limits.website} симв.
                      </span>
                    </div>
                    {actionButtons('website')}
                  </div>
                  <div className="master-text">
                    <span className="roman">IV.</span>
                    <blockquote>«{result.texts.website}»</blockquote>
                  </div>
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
                  <div className="card-bottom">
                    <CharacterCount text={result.texts.website} limit={settings.limits.website} />
                    <span className="mono">
                      Стиль: {tones.find((t) => t.id === result.tone)?.id.toUpperCase()}
                    </span>
                  </div>
                </article>
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
                <div className="export-bar">
                  <div>
                    <Clipboard size={18} />
                    <span>
                      <strong>
                        {published === result.id
                          ? 'Редакция сохранена'
                          : 'Готово к передаче в меню'}
                      </strong>
                      <small>JSON для четырёх каналов дистрибуции</small>
                    </span>
                  </div>
                  <div className="export-actions">
                    <button
                      className="button secondary"
                      onClick={() => {
                        download(result, `mise-${result.recipeId}.json`);
                        notify('JSON экспортирован');
                      }}
                    >
                      <ArrowDownToLine size={15} />
                      Экспорт JSON
                    </button>
                    <button className="button primary" onClick={() => setPublishOpen(true)}>
                      Подготовить к публикации
                      <ArrowRight size={15} />
                    </button>
                  </div>
                </div>
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
        {page === 'docs' && <DocsPage copied={copied} copy={copy} />}
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
          <span>© {new Date().getFullYear()} Mise en Place. Искусство точного слова.</span>
        </div>
        <div>
          <button onClick={() => go('docs')}>ARCHIVAL CODEX</button>
          <span>/</span>
          <button onClick={() => go('brand')}>BRAND MANIFESTO</button>
          <span>/</span>
          <span className="footer-status">
            <i className="status-dot" /> LOCAL STUDIO
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
        />
      )}
      {editText && (
        <Modal title="Редактура описания" onClose={() => setEditText(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!editText.text.trim()) return;
              const key = editText.key;
              setResult((prev) => ({
                ...prev,
                id: crypto.randomUUID(),
                ...(key === 'variant'
                  ? { variant: editText.text.trim() }
                  : { texts: { ...prev.texts, [key]: editText.text.trim() } }),
              }));
              setEditText(null);
              notify('Редакция сохранена');
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
              maxLength={settings.limits[editText.key === 'variant' ? 'yandex' : editText.key]}
              onChange={(e) => setEditText({ ...editText, text: e.target.value })}
            />
            <div className="row-between">
              <CharacterCount
                text={editText.text}
                limit={settings.limits[editText.key === 'variant' ? 'yandex' : editText.key]}
              />
              <span className="muted">Проверьте состав по техкарте</span>
            </div>
            <div className="modal-actions">
              <button type="button" className="button secondary" onClick={() => setEditText(null)}>
                Отмена
              </button>
              <button className="button primary" disabled={!editText.text.trim()}>
                Сохранить редакцию
              </button>
            </div>
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
                <CharacterCount text={result.texts[c.id]} limit={settings.limits[c.id]} />
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
                saveStorage('mise.published.v1', result.id);
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
      {profileOpen && (
        <Modal title="Maison Delacroix" onClose={() => setProfileOpen(false)}>
          <p className="modal-copy">Рабочее пространство ресторанной группы Grand Cru Group.</p>
          <dl className="profile-details">
            <div>
              <dt>Режим</dt>
              <dd>Локальная студия</dd>
            </div>
            <div>
              <dt>Технологические карты</dt>
              <dd>{recipes.length}</dd>
            </div>
            <div>
              <dt>Каналы дистрибуции</dt>
              <dd>4</dd>
            </div>
            <div>
              <dt>Хранение</dt>
              <dd>В этом браузере</dd>
            </div>
          </dl>
          <p className="footnote">
            Авторизация, внешнее API и синхронизация POS будут доступны после подключения серверной
            части.
          </p>
          <div className="modal-actions">
            <button
              className="button primary"
              onClick={() => {
                setProfileOpen(false);
                go('brand');
              }}
            >
              Настроить голос бренда
              <ArrowRight size={15} />
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
}: {
  recipe: Recipe | 'new';
  onSave: (r: Recipe) => void;
  onClose: () => void;
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
          weight: 250,
          price: 1000,
          pairing: '',
        }
      : { ...recipe },
  );
  const [ingredientsText, setIngredientsText] = useState(draft.ingredients.join('\n'));
  const update = <K extends keyof Recipe>(key: K, value: Recipe[K]) =>
    setDraft({ ...draft, [key]: value });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const ingredients = ingredientsText
      .split(/[\n;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!draft.name.trim() || !draft.method.trim() || !ingredients.length) return;
    onSave({ ...draft, name: draft.name.trim(), ingredients, method: draft.method.trim() });
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
              required
              min="1"
              max="20000"
              value={draft.weight}
              onChange={(e) => update('weight', Number(e.target.value))}
            />
          </label>
          <label>
            Цена, ₽
            <input
              type="number"
              required
              min="1"
              max="1000000"
              value={draft.price}
              onChange={(e) => update('price', Number(e.target.value))}
            />
          </label>
        </div>
        <label>
          Ингредиенты <span className="muted">· по одному на строку</span>
          <textarea
            required
            rows={5}
            value={ingredientsText}
            onChange={(e) => setIngredientsText(e.target.value)}
          />
        </label>
        <label>
          Метод приготовления
          <textarea
            required
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
          <button className="button primary">
            Сохранить карту
            <Check size={15} />
          </button>
        </div>
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
            <div className="library-image">
              {r.image ? (
                <img src={r.image} alt={r.name} />
              ) : (
                <div className="recipe-illustration">
                  <UtensilsCrossed size={44} strokeWidth={0.7} />
                  <span>LA COLLECTION</span>
                </div>
              )}
              <span className="library-number">{String(index + 1).padStart(2, '0')}</span>
              <span className="library-category">{r.category}</span>
            </div>
            <div className="library-body">
              <div className="row-between">
                <span className="eyebrow">{r.id}</span>
                {selectedId === r.id && <span className="tag">В СТУДИИ</span>}
              </div>
              <h2>{r.name}</h2>
              <p className="library-subtitle">{r.subtitle}</p>
              <p className="library-ingredients">{r.ingredients.join(' · ')}</p>
              <div className="row-between library-price">
                <span>{r.weight} г</span>
                <span>{money(r.price)}</span>
              </div>
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
        <span>Технологические карты сохраняются в вашем браузере.</span>
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
  onSave: (s: Settings) => void;
  notify: (m: string) => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [activeChannel, setActiveChannel] = useState<ChannelId | null>(null);
  const [channelLimit, setChannelLimit] = useState(250);
  const [sample, setSample] = useState<{ index: number; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const update = (value: Partial<Settings>) => {
    setDraft({ ...draft, ...value });
    setDirty(true);
  };
  const save = () => {
    onSave(draft);
    setDirty(false);
  };
  return (
    <>
      <div className="config-kicker">
        <span>
          ATELIER CONFIGURATION <b>/</b>{' '}
          {brandOnly ? 'BRAND VOICE & EDITORIAL DNA' : 'RAG KERNEL & DISTRIBUTION MATRIX'}
        </span>
        <span className="tag">
          <BookOpen size={12} /> CODEX: ED. 1903 [ESCOFFIER]
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
              : 'Управление лимитами агрегаторов, фильтрами стоп-слов и RAG-профилем заведения. Контроль лексической чистоты и автоматической коррекции меню без потери гастрономического нарратива.'}
          </p>
        </div>
        <div className="config-status">
          <span className="tag">
            <ShieldCheck size={15} /> РЕДАКЦИОННЫЙ ПРОФИЛЬ
          </span>
          <small>{dirty ? 'Есть несохранённые изменения' : 'Локальные настройки ресторана'}</small>
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
          <p className="eyebrow">Векторная база знаний · RAG corpus</p>
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
            В этой версии тексты сохраняются как референсы. Векторный поиск подключается на стороне
            сервера.
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
              <span className="eyebrow">Кластеры векторных якорей</span>
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
          <p className="eyebrow">RAG hyperparameters</p>
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
                description: 'При значении от 70% включается фильтрация рекламных штампов.',
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
          <button className="button primary save-profile" onClick={save}>
            <Flower2 size={18} />
            <span>Сохранить профиль ресторана</span>
          </button>
          <div className="generation-note">
            <span>Maison Delacroix</span>
            <span>{dirty ? 'НЕ СОХРАНЕНО' : 'СОХРАНЕНО'}</span>
          </div>
        </aside>
      </div>
      <div className="section-tail">
        <span className="eyebrow">ESCOFFIER STANDARD CODEX</span>
        <span>Сохранённые настройки применяются при следующей генерации.</span>
        <span className="mono">LOCAL PROFILE · V1.0</span>
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

const apiExamples: Record<string, string> = {
  cURL: `curl -X POST "$MISE_API_URL/v1/descriptions:generate" \\\n  -H "Authorization: Bearer $MISE_API_KEY" \\\n  -H "Idempotency-Key: <uuid-v4>" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "recipe_id": "rcp_8841_brx",\n    "channel": "yandex_eda",\n    "tone_override": "refined_editorial"\n  }'`,
  Python: `import os\nimport uuid\nimport requests\n\nresponse = requests.post(\n    os.environ["MISE_API_URL"]\n    + "/v1/descriptions:generate",\n    headers={\n        "Authorization": "Bearer " +\n            os.environ["MISE_API_KEY"],\n        "Idempotency-Key": str(uuid.uuid4()),\n    },\n    json={\n        "recipe_id": "rcp_8841_brx",\n        "channel": "yandex_eda",\n    },\n)\nresponse.raise_for_status()\njob = response.json()`,
  TypeScript: `const response = await fetch(\n  process.env.MISE_API_URL +\n    '/v1/descriptions:generate',\n  {\n    method: 'POST',\n    headers: {\n      Authorization:\n        'Bearer ' + process.env.MISE_API_KEY,\n      'Idempotency-Key': crypto.randomUUID(),\n      'Content-Type': 'application/json',\n    },\n    body: JSON.stringify({\n      recipe_id: 'rcp_8841_brx',\n      channel: 'yandex_eda',\n    }),\n  },\n);\nif (!response.ok) throw new Error(\n  'Generation request failed'\n);\nconst job = await response.json();`,
  Go: `payload := strings.NewReader(\n  \x60{"recipe_id":"rcp_8841_brx",\n    "channel":"yandex_eda"}\x60,\n)\nreq, err := http.NewRequest(\n  "POST",\n  os.Getenv("MISE_API_URL") +\n    "/v1/descriptions:generate",\n  payload,\n)\nif err != nil { return err }\nreq.Header.Set("Authorization",\n  "Bearer " + os.Getenv("MISE_API_KEY"))\nreq.Header.Set("Content-Type",\n  "application/json")\nreq.Header.Set("Idempotency-Key",\n  uuid.NewString())\nres, err := http.DefaultClient.Do(req)\nif err != nil { return err }\ndefer res.Body.Close()`,
};
const endpoints = [
  {
    id: 'generate',
    method: 'POST',
    path: '/v1/descriptions:generate',
    desc: 'Асинхронный запуск генерации. Заголовок Idempotency-Key позволяет повторить запрос, не создавая дубликат задания.',
    fields: [
      ['recipe_id', 'string', 'Да', 'Идентификатор технологической карты блюда.'],
      ['channel', 'enum', 'Да', 'Канал дистрибуции: yandex_eda, wolt, white_label, print.'],
      ['tone_override', 'string', 'Нет', 'Переопределение базового регистра повествования.'],
      ['hero_ingredient', 'string', 'Нет', 'Акцентный продукт для редакционной подачи.'],
      ['allergens_declared', 'array', 'Да', 'Подтверждённый рестораном список аллергенов.'],
    ],
  },
  {
    id: 'status',
    method: 'GET',
    path: '/v1/descriptions/{id}',
    desc: 'Получение результата по идентификатору задания. Статусы: processing, completed и failed.',
    fields: [['id', 'string', 'Да', 'Идентификатор задания из ответа на генерацию.']],
  },
  {
    id: 'batch',
    method: 'POST',
    path: '/v1/descriptions:batch',
    desc: 'Массовая генерация описаний для сезонного обновления меню. Каждый элемент обрабатывается как отдельное задание.',
    fields: [
      ['recipe_ids', 'array', 'Да', 'Список идентификаторов технологических карт.'],
      ['channels', 'array', 'Да', 'Каналы, для которых нужны описания.'],
    ],
  },
  {
    id: 'constraints',
    method: 'GET',
    path: '/v1/channels/{channel}/constraints',
    desc: 'Лимиты символов, формат, стоп-слова и правила выбранной витрины доставки.',
    fields: [['channel', 'enum', 'Да', 'Идентификатор профиля канала.']],
  },
  {
    id: 'recipes',
    method: 'POST',
    path: '/v1/recipes',
    desc: 'Загрузка технологической карты. Предварительная детекция аллергенов требует подтверждения сотрудником ресторана.',
    fields: [
      ['name', 'string', 'Да', 'Название блюда.'],
      ['ingredients', 'array', 'Да', 'Ингредиенты и их количества.'],
      ['method', 'string', 'Да', 'Метод приготовления и температурный режим.'],
    ],
  },
  {
    id: 'preferences',
    method: 'POST',
    path: '/v1/preferences',
    desc: 'Настройка голоса бренда, эталонных текстов и параметров генерации для организации.',
    fields: [
      ['samples', 'array', 'Да', 'Примеры текстов в стиле ресторана.'],
      ['restraint', 'number', 'Нет', 'Уровень сдержанности: от 0 до 100.'],
    ],
  },
];
function DocsPage({ copied, copy }: { copied: string; copy: (text: string, key: string) => void }) {
  const [language, setLanguage] = useState('cURL');
  const [active, setActive] = useState('architecture');
  const scrollTo = (id: string) => {
    setActive(id);
    document.getElementById(`doc-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  return (
    <>
      <div className="docs-banner">
        <span>
          <span className="eyebrow mono">CODEX ARCHIVAL № 14-B</span>
          <b>/</b> MISE EN PLACE ENGINE API SPEC
        </span>
        <span className="mono">
          Schema: v1.4 <span className="tag">ПРОЕКТ КОНТРАКТА</span>
        </span>
      </div>
      <div className="docs-layout">
        <aside className="docs-sidebar">
          <p className="eyebrow">INDEX RERUM</p>
          <h2>Спецификация v1.4</h2>
          <p>Регламент синтеза кулинарной прозы и интеграционных контрактов.</p>
          <span className="sidebar-label">ОСНОВЫ АРХИТЕКТУРЫ</span>
          <button
            className={active === 'architecture' ? 'active' : ''}
            onClick={() => scrollTo('architecture')}
          >
            Архитектурные принципы<span>01</span>
          </button>
          <button
            className={active === 'pipeline' ? 'active' : ''}
            onClick={() => scrollTo('pipeline')}
          >
            Асинхронные задачи & Webhooks<span>02</span>
          </button>
          <span className="sidebar-label">МЕТОДЫ API</span>
          {endpoints.map((e, i) => (
            <button
              key={e.id}
              className={active === e.id ? 'active endpoint-link' : 'endpoint-link'}
              onClick={() => scrollTo(e.id)}
            >
              <span>
                <em>{e.method}</em> {e.path}
              </span>
              <span>{String(i + 3).padStart(2, '0')}</span>
            </button>
          ))}
          <div className="sidebar-note">
            <ShieldCheck size={15} />
            <span>SECURITY STANDARD</span>
            <p>
              Серверная архитектура предусматривает tenant isolation, ключи API и идемпотентные
              запросы.
            </p>
          </div>
        </aside>
        <div className="docs-content">
          <section id="doc-architecture">
            <span className="tag chapter-tag">
              <i className="status-dot" /> ГЛАВА I · ТРАКТАТ О СЕМАНТИКЕ
            </span>
            <h1>Генерация ресторанных описаний с контролем голоса бренда</h1>
            <p className="docs-lead">
              Промышленный гастрономический B2B требует предельной деликатности письма. Машинные
              галлюцинации и шаблонные штампы вроде <em>«пальчики оближешь»</em> разрушают репутацию
              дома мгновенно.
            </p>
            <p>
              Архитектура Mise en Place предполагает баланс: литературная выверенность текста
              высокой кухни синхронизируется с техническими ограничениями агрегаторов. Векторный
              контекст сохраняет кулинарный лексикон ресторана во всех вариациях меню.
            </p>
            <div className="notice docs-notice">
              <Code2 size={18} />
              <p>
                Это проект API из архитектурного брифа. Текущая React-студия работает локально;
                перечисленные эндпоинты пока не развёрнуты.
              </p>
            </div>
          </section>
          <section id="doc-pipeline" className="pipeline-section">
            <div className="row-between">
              <span className="small-label">Сквозной поток данных</span>
              <span className="mono text-brass">DATA PIPELINE</span>
            </div>
            <div className="pipeline">
              {[
                [
                  'POS / ERP Source',
                  'Технологическая карта, состав и список аллергенов поступают через защищённый коннектор.',
                  'iiko / r_keeper',
                ],
                [
                  'API Gateway & Tenant Auth',
                  'Проверка API-ключа, изоляция организации и заголовок Idempotency-Key.',
                  'API Gateway',
                ],
                [
                  'Description Core Engine',
                  'Голос бренда, рецептурная база, правила каналов и фильтр штампов.',
                  'RAG + Guardrails',
                ],
                [
                  'Delivery Channel Payload',
                  'Результат доступен по GET-запросу. Событие description.ready отправляется в webhook.',
                  'Webhook / SSE',
                ],
              ].map(([title, description, tag], i) => (
                <div className="pipeline-step" key={title}>
                  <div className="pipeline-row">
                    <span className="step-number">0{i + 1}</span>
                    <div>
                      <div className="row-between">
                        <h3>{title}</h3>
                        <span className="tag mono">{tag}</span>
                      </div>
                      <p>{description}</p>
                    </div>
                  </div>
                  {i < 3 && (
                    <div className="pipeline-arrow">
                      <ArrowDown size={17} />
                      <span>
                        {['Auth · Idempotent Session', 'Async dispatch', 'Channel validation'][i]}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
          {endpoints.map((endpoint, i) => (
            <section className="endpoint-section" id={`doc-${endpoint.id}`} key={endpoint.id}>
              <p className="eyebrow">Глава {i + 2} · Спецификация контракта</p>
              <h2>
                <span>{endpoint.method}</span> {endpoint.path}
              </h2>
              <p>{endpoint.desc}</p>
              {i === 0 && (
                <>
                  <span className="small-label">Обязательные заголовки запроса</span>
                  <dl className="request-headers">
                    <div>
                      <dt>Authorization</dt>
                      <dd>Bearer &lt;api_key&gt;</dd>
                    </div>
                    <div>
                      <dt>Idempotency-Key</dt>
                      <dd>UUID v4</dd>
                    </div>
                    <div>
                      <dt>Content-Type</dt>
                      <dd>application/json</dd>
                    </div>
                  </dl>
                </>
              )}
              <span className="small-label">
                Параметры {endpoint.method === 'GET' ? 'пути' : 'тела запроса (JSON)'}
              </span>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Поле</th>
                      <th>Тип</th>
                      <th>Обяз.</th>
                      <th>Назначение</th>
                    </tr>
                  </thead>
                  <tbody>
                    {endpoint.fields.map(([field, type, required, desc]) => (
                      <tr key={field}>
                        <td>{field}</td>
                        <td>{type}</td>
                        <td>
                          <span className="tag">{required}</span>
                        </td>
                        <td>{desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
          <div className="semantic-note">
            <ShieldCheck size={21} />
            <div>
              <h3>Семантическая точность и аллергены</h3>
              <p>
                Описание не заменяет технологическую карту. Данные об аллергенах подтверждает
                ресторан: литературная редактура не должна скрывать ингредиенты или приписывать
                блюду неподтверждённые свойства.
              </p>
            </div>
          </div>
        </div>
        <aside className="code-sidebar">
          <div className="code-panel">
            <div className="code-tabs" role="tablist" aria-label="Язык примера">
              {Object.keys(apiExamples).map((lang) => (
                <button
                  role="tab"
                  aria-selected={language === lang}
                  className={language === lang ? 'active' : ''}
                  onClick={() => setLanguage(lang)}
                  key={lang}
                >
                  {lang}
                </button>
              ))}
              <button
                className="icon-button code-copy"
                aria-label="Копировать пример API"
                onClick={() => copy(apiExamples[language], 'code')}
              >
                {copied === 'code' ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
            <pre role="tabpanel" aria-label={`Пример ${language}`}>
              <code>{apiExamples[language]}</code>
            </pre>
          </div>
          <div className="response-panel">
            <div className="row-between">
              <span>
                <i className="status-dot" /> Response 202 Accepted
              </span>
              <span>ПРИМЕР</span>
            </div>
            <pre>
              <code>
                {JSON.stringify(
                  {
                    job_id: 'job_9921b',
                    status: 'processing',
                    recipe_id: 'rcp_8841_brx',
                    channel: 'yandex_eda',
                  },
                  null,
                  2,
                )}
              </code>
            </pre>
          </div>
          <div className="response-panel completed-response">
            <div className="row-between">
              <span>GET /v1/descriptions/job_9921b</span>
            </div>
            <pre>
              <code>
                {JSON.stringify(
                  {
                    id: 'dsc_01H9A887K',
                    job_id: 'job_9921b',
                    status: 'completed',
                    recipe_id: 'rcp_8841_brx',
                    channel: 'yandex_eda',
                    text: 'Томлёная говяжья щека с пюре из печёного сельдерея и демигласом.',
                    tone: 'refined_editorial',
                    prompt_version: '1.0',
                    constraints_satisfied: { max_chars: 250, no_emoji: true },
                    allergens_declared: ['celery', 'milk', 'sulphites'],
                  },
                  null,
                  2,
                )}
              </code>
            </pre>
            <div className="code-note">
              <ShieldCheck size={15} />
              <span>Иллюстративный ответ · не live API</span>
            </div>
          </div>
          <div className="code-info">
            <BookOpen size={18} />
            <div>
              <h3>Сначала контракт. Затем интеграция.</h3>
              <p>
                Ключи API хранятся на сервере. Не размещайте секреты в клиентском React-приложении.
              </p>
            </div>
          </div>
          <button
            className="button secondary download-spec"
            onClick={() =>
              download(
                {
                  version: '1.4',
                  status: 'draft',
                  endpoints: endpoints.map((e) => ({
                    method: e.method,
                    path: e.path,
                    description: e.desc,
                    fields: e.fields,
                  })),
                },
                'mise-api-draft.json',
              )
            }
          >
            <ArrowDownToLine size={15} />
            Скачать описание API
          </button>
        </aside>
      </div>
    </>
  );
}

export default App;
