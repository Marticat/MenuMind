import { useEffect, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  Globe2,
  Layers3,
  Leaf,
  LoaderCircle,
  ShieldCheck,
  Sparkles,
  UtensilsCrossed,
} from 'lucide-react';
import Studio from './App';
import { api, send, clearSession, errorMessage, ApiError, type User, type Workspace } from './api';
import { ApiDocs } from './components/ApiDocs';
import './product.css';

const studioRoutes = ['studio', 'channels', 'brand', 'library', 'profile', 'history'];
function Brand() {
  return (
    <a className="product-brand" href="#home">
      <UtensilsCrossed size={23} />
      <span>
        MenuMind<small>THE MENU, IN YOUR VOICE</small>
      </span>
    </a>
  );
}
export default function Root() {
  const [route, setRoute] = useState(() => location.hash.slice(1) || 'home');
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = async () => {
    setError('');
    setLoading(true);
    try {
      await api<{ user: User }>('/auth/me');
      setWorkspace(await api<Workspace>('/workspace'));
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    const changed = () => {
      setRoute(location.hash.slice(1) || 'home');
      window.scrollTo(0, 0);
    };
    const expired = () => {
      clearSession();
      setWorkspace(null);
      location.hash = 'login';
    };
    window.addEventListener('hashchange', changed);
    window.addEventListener('menumind:unauthorized', expired);
    return () => {
      window.removeEventListener('hashchange', changed);
      window.removeEventListener('menumind:unauthorized', expired);
    };
  }, []);
  useEffect(() => {
    if (!studioRoutes.includes(route)) document.title = 'MenuMind — голос вашего меню';
  }, [route]);
  const authenticated = async () => {
    const data = await api<Workspace>('/workspace');
    setWorkspace(data);
    location.hash = 'studio';
  };
  const logout = async () => {
    await send('/auth/logout', 'POST');
    clearSession();
    setWorkspace(null);
    location.hash = 'home';
  };
  if (loading && studioRoutes.includes(route))
    return (
      <div className="product-loading">
        <LoaderCircle className="spin" />
        Загружаем ваше пространство…
      </div>
    );
  if (workspace && (studioRoutes.includes(route) || route === 'docs'))
    return (
      <Studio
        key={workspace.user.id}
        workspace={workspace}
        onLogout={logout}
        onWorkspaceChange={setWorkspace}
      />
    );
  if (route === 'docs')
    return (
      <>
        <header className="product-header">
          <Brand />
          <a className="button secondary" href="#home">
            На главную
          </a>
        </header>
        <main className="main">
          <ApiDocs />
        </main>
      </>
    );
  if (['login', 'register'].includes(route) || studioRoutes.includes(route))
    return (
      <AuthPage
        key={route}
        mode={route === 'register' ? 'register' : 'login'}
        onSuccess={authenticated}
      />
    );
  return <Landing signedIn={!!workspace} error={error} onRetry={load} />;
}

function Landing({
  signedIn,
  error,
  onRetry,
}: {
  signedIn: boolean;
  error: string;
  onRetry: () => void;
}) {
  const [example, setExample] = useState<'ru' | 'kk'>('ru');
  const [menu, setMenu] = useState(false);
  const start = signedIn ? '#studio' : '#register';
  const scroll = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
    setMenu(false);
  };
  return (
    <div className="landing">
      <header className="product-header">
        <Brand />
        <nav
          className={menu ? 'landing-nav expanded' : 'landing-nav'}
          aria-label="Навигация лендинга"
        >
          <button onClick={() => scroll('how-it-works')}>Как это работает</button>
          <button onClick={() => scroll('possibilities')}>Возможности</button>
          <a href="#docs">
            Для разработчиков <ArrowUpRight size={13} />
          </a>
        </nav>
        <div className="landing-header-actions">
          <a href={signedIn ? '#studio' : '#login'}>{signedIn ? 'Моя студия' : 'Войти'}</a>
          <a className="button primary" href={start}>
            Начать <ArrowRight size={14} />
          </a>
          <button
            className="landing-menu"
            aria-label="Открыть навигацию"
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            <ChevronDown />
          </button>
        </div>
      </header>
      {error && (
        <div className="connection-note" role="status">
          {error} <button onClick={onRetry}>Повторить</button>
        </div>
      )}
      <main>
        <section className="landing-hero">
          <div className="hero-copy">
            <p className="eyebrow">
              <span className="status-dot" /> СЛОВА, КОТОРЫЕ ПЕРЕДАЮТ ВКУС
            </p>
            <h1>
              У каждого блюда
              <br />
              есть история.
              <br />
              <em>Дайте ей голос.</em>
            </h1>
            <p className="hero-description">
              Превратите состав блюда в описание для меню. На русском и казахском, в стиле вашего
              ресторана и в нужном количестве символов.
            </p>
            <div className="hero-actions">
              <a className="button primary" href={start}>
                Создать первое описание <ArrowRight size={17} />
              </a>
              <button className="hero-secondary" onClick={() => scroll('how-it-works')}>
                Посмотреть, как это работает <span>↗</span>
              </button>
            </div>
            <div className="hero-footnote">
              <span>
                <Check size={14} /> Ваши ингредиенты
              </span>
              <span>
                <Check size={14} /> Ваш голос
              </span>
              <span>
                <Check size={14} /> Четыре формата
              </span>
            </div>
          </div>
          <div className="hero-visual">
            <div className="hero-photo">
              <img src="/dish.jpg" alt="Томлёная говяжья щека с пюре и соусом" />
              <div className="photo-caption">
                <span>ИЗ КУХНИ — В МЕНЮ</span>
                <span>01 / 04</span>
              </div>
            </div>
            <div className="hero-description-card">
              <div className="row-between">
                <span className="eyebrow">
                  <Sparkles size={13} /> ПРИМЕР ОПИСАНИЯ
                </span>
                <div className="language-switch" aria-label="Язык примера">
                  <button aria-pressed={example === 'ru'} onClick={() => setExample('ru')}>
                    RU
                  </button>
                  <button aria-pressed={example === 'kk'} onClick={() => setExample('kk')}>
                    ҚАЗ
                  </button>
                </div>
              </div>
              <p>
                {example === 'ru'
                  ? 'Томлёная говяжья щека с пюре из печёного сельдерея. Сливочное масло и демиглас завершают подачу.'
                  : 'Бұқтырылған сиыр еті, пеште піскен балдыркөк езбесімен. Сары май және демиглас тұздығымен ұсынылады.'}
              </p>
              <div className="preview-card-footer">
                <span>
                  <i className="status-dot" /> Меню ресторана
                </span>
                <span>до 250 символов</span>
              </div>
            </div>
            <div className="hero-stamp">
              <Leaf size={25} />
              <span>
                ВКУС
                <br />В ДЕТАЛЯХ
              </span>
            </div>
          </div>
        </section>
        <div className="channel-ribbon">
          <span>ОДНО БЛЮДО. РАЗНЫЕ ФОРМАТЫ.</span>
          <strong>Яндекс Еда</strong>
          <strong>Wolt</strong>
          <strong>Ваш сайт</strong>
          <strong>Печатное меню</strong>
          <small>Подготовка текстов к экспорту</small>
        </div>
        <section className="landing-section" id="how-it-works">
          <div className="landing-section-heading">
            <div>
              <p className="eyebrow">ОТ СОСТАВА К ОПИСАНИЮ</p>
              <h2>
                Кухня знает рецепт.
                <br />
                <em>MenuMind подбирает слова.</em>
              </h2>
            </div>
            <p>Три шага от технологической карты до текста, который можно поставить в меню.</p>
          </div>
          <div className="how-grid">
            {[
              [
                '01',
                'Расскажите о блюде',
                'Добавьте название, категорию и известные ингредиенты. Можно начать только с названия.',
                UtensilsCrossed,
              ],
              [
                '02',
                'Настройте свой голос',
                'Выберите язык и тон. Сохраните стиль ресторана и примеры текстов для следующих описаний.',
                Sparkles,
              ],
              [
                '03',
                'Проверьте и используйте',
                'Получите варианты для четырёх каналов, отредактируйте и выгрузите готовые тексты.',
                Layers3,
              ],
            ].map(([number, title, description, Icon]) => {
              const StepIcon = Icon as typeof Leaf;
              return (
                <article key={String(number)}>
                  <div className="step-top">
                    <span>{String(number)}</span>
                    <StepIcon size={24} />
                  </div>
                  <h3>{String(title)}</h3>
                  <p>{String(description)}</p>
                </article>
              );
            })}
          </div>
        </section>
        <section className="personalization-section" id="possibilities">
          <div>
            <p className="eyebrow">ВАШ РЕСТОРАН. ВАШ ХАРАКТЕР.</p>
            <h2>
              Меню меняется.
              <br />
              <em>Голос остаётся вашим.</em>
            </h2>
            <p>
              Профиль объединяет предпочтения, примеры описаний и настройки каналов. Теги помогают
              ориентироваться в блюдах, а ваши оценки влияют на персональную подборку.
            </p>
            <a className="button primary" href={start}>
              Настроить пространство <ArrowRight size={16} />
            </a>
          </div>
          <div className="profile-preview">
            <div className="profile-preview-header">
              <span className="preview-monogram">M</span>
              <div>
                <strong>Мой ресторан</strong>
                <small>ПРИМЕР ПРОФИЛЯ</small>
              </div>
              <ShieldCheck size={20} />
            </div>
            <div className="preview-setting">
              <span>Язык меню</span>
              <strong>Русский / Қазақша</strong>
            </div>
            <div className="preview-setting">
              <span>Голос бренда</span>
              <strong>Современное бистро</strong>
            </div>
            <div className="preview-meter">
              <span>
                Сдержанность <b>88%</b>
              </span>
              <i />
            </div>
            <p className="eyebrow">ТЕГИ ИЗ СОСТАВА</p>
            <div className="product-tags">
              <span>Говядина</span>
              <span>Сельдерей</span>
              <span>Томление</span>
            </div>
            <p className="preview-evidence">«Томление при 74 °C» → тег «Томление»</p>
          </div>
        </section>
        <section className="landing-section detail-grid">
          <article>
            <Globe2 />
            <h3>Два языка, одно меню</h3>
            <p>
              Русский и казахский выбираются для каждой генерации. Состав и факты остаются основой
              текста.
            </p>
          </article>
          <article>
            <ShieldCheck />
            <h3>Данные вашего ресторана</h3>
            <p>
              Собственный аккаунт, рецепты и история редакций. Возвращайтесь к работе с другого
              устройства.
            </p>
          </article>
          <article>
            <Layers3 />
            <h3>Готово к интеграции</h3>
            <p>
              REST API, личные ключи и интерактивная документация для подключения к вашему сервису.
            </p>
            <a href="#docs">
              Открыть документацию <ArrowUpRight size={14} />
            </a>
          </article>
        </section>
        <section className="landing-cta">
          <p className="eyebrow">НАЧНИТЕ С ОДНОГО БЛЮДА</p>
          <h2>
            Пусть ваше меню
            <br />
            <em>заговорит.</em>
          </h2>
          <a className="button primary" href={start}>
            Открыть MenuMind <ArrowRight size={17} />
          </a>
          <p>Создайте аккаунт и попробуйте студию на трёх примерах.</p>
        </section>
      </main>
      <footer className="landing-footer">
        <Brand />
        <span>© {new Date().getFullYear()} MenuMind</span>
        <a href="#docs">Документация API ↗</a>
        <span>Сделано со вкусом.</span>
      </footer>
    </div>
  );
}

function AuthPage({
  mode,
  onSuccess,
}: {
  mode: 'login' | 'register';
  onSuccess: () => Promise<void>;
}) {
  const register = mode === 'register';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      await send(`/auth/${mode}`, 'POST', Object.fromEntries(form));
      await onSuccess();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="auth-page">
      <header className="product-header">
        <Brand />
        <a href="#home">На главную ↗</a>
      </header>
      <main className="auth-layout">
        <div className="auth-story">
          <p className="eyebrow">ВАШЕ МЕНЮ НАЧИНАЕТСЯ ЗДЕСЬ</p>
          <h1>
            Хорошему блюду
            <br />
            нужны <em>свои слова.</em>
          </h1>
          <img src="/dish.jpg" alt="Ресторанное блюдо" />
          <p>Рецепты, голос бренда и готовые описания — в одном пространстве.</p>
        </div>
        <section className="auth-card">
          <p className="eyebrow">MENUMIND STUDIO</p>
          <h2>{register ? 'Ваше пространство' : 'С возвращением'}</h2>
          <p>
            {register
              ? 'Создайте аккаунт для своего ресторана.'
              : 'Войдите, чтобы продолжить работу с меню.'}
          </p>
          <form onSubmit={submit} className="product-form">
            {register && (
              <>
                <label>
                  Ваше имя
                  <input name="name" required maxLength={80} autoComplete="name" />
                </label>
                <label>
                  Название ресторана
                  <input
                    name="restaurantName"
                    required
                    maxLength={100}
                    autoComplete="organization"
                  />
                </label>
              </>
            )}
            <label>
              Email
              <input name="email" required type="email" maxLength={254} autoComplete="email" />
            </label>
            <label>
              Пароль
              <input
                name="password"
                aria-label="Пароль"
                required
                type="password"
                minLength={10}
                maxLength={128}
                autoComplete={register ? 'new-password' : 'current-password'}
              />
              {register && <small>Не менее 10 символов</small>}
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="button primary" disabled={busy}>
              {busy ? <LoaderCircle size={17} className="spin" /> : null}
              {register ? 'Создать аккаунт' : 'Войти в студию'}
              <ArrowRight size={16} />
            </button>
          </form>
          <p className="auth-switch">
            {register ? 'Уже есть аккаунт?' : 'Первый раз здесь?'}{' '}
            <a href={register ? '#login' : '#register'}>{register ? 'Войти' : 'Создать аккаунт'}</a>
          </p>
        </section>
      </main>
    </div>
  );
}
