import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z, ZodError } from 'zod';
import { openDatabase, defaultProfile } from './db.mjs';
import {
  digest,
  secret,
  hashPassword,
  verifyPassword,
  sessionCookie,
  publicUser,
} from './auth.mjs';
import { extractTags, tagCatalog, rankRecipes } from './tags.mjs';
import { generateDescription } from './generation.mjs';
import { registerPersonalization } from './personalization.mjs';
import {
  recipeSchema,
  profileSchema,
  settingsSchema,
  registerSchema,
  loginSchema,
  generationSchema,
  editSchema,
  fail,
  ApiError,
} from './schemas.mjs';

const starters = [
  {
    id: 'RCP-8841-BRX',
    name: 'Томлёная говяжья щека',
    subtitle: 'с пюре из печёного сельдерея',
    ingredients: ['Говяжья щека', 'Корень сельдерея', 'Сливочное масло', 'Демиглас'],
    method: 'Томление при 74 °C в течение 24 часов.',
    category: 'Основное',
    weight: 328,
    price: 1450,
    image: '/dish.jpg',
    pairing: '',
  },
  {
    id: 'RCP-8842-SEA',
    name: 'Гребешок Сен-Жак',
    subtitle: 'с цветной капустой',
    ingredients: ['Морской гребешок', 'Цветная капуста', 'Сливочное масло'],
    method: 'Обжарка на сливочном масле.',
    category: 'Закуска',
    weight: 180,
    price: 1890,
    pairing: '',
  },
  {
    id: 'RCP-8843-VEG',
    name: 'Ризотто с лесными грибами',
    subtitle: 'с пармезаном',
    ingredients: ['Рис карнароли', 'Белые грибы', 'Пармезан', 'Сливочное масло', 'Овощной бульон'],
    method: 'Постепенное введение горячего бульона.',
    category: 'Основное',
    weight: 290,
    price: 980,
    pairing: '',
  },
];

export function createApp({
  config,
  db = openDatabase(config.databasePath),
  fetchImpl,
  disableRateLimits = false,
  now = Date.now,
}) {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.use(
    helmet({
      strictTransportSecurity: config.production ? undefined : false,
      contentSecurityPolicy: {
        directives: { 'upgrade-insecure-requests': config.production ? [] : null },
      },
    }),
  );
  app.use(express.json({ limit: '256kb' }));
  app.use('/api', (req, res, next) => {
    req.requestId = randomUUID();
    res.set('X-Request-Id', req.requestId);
    res.set('Cache-Control', 'no-store');
    next();
  });
  if (!disableRateLimits)
    app.use(
      '/api',
      rateLimit({
        windowMs: 60_000,
        limit: 150,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        message: {
          error: {
            code: 'RATE_LIMITED',
            message: 'Слишком много запросов. Повторите через минуту.',
          },
        },
      }),
    );
  // Authentication is always resolved server-side. Never accept a user/tenant id from a client.
  app.use('/api', (req, res, next) => {
    const bearer = req.get('Authorization');
    if (bearer) {
      if (!bearer.startsWith('Bearer '))
        return next(new ApiError(401, 'UNAUTHORIZED', 'Некорректный API-ключ.'));
      const key = db
        .prepare('SELECT * FROM api_keys WHERE token_hash = ?')
        .get(digest(bearer.slice(7)));
      if (!key)
        return next(new ApiError(401, 'UNAUTHORIZED', 'API-ключ недействителен или отозван.'));
      req.user = db.prepare('SELECT * FROM users WHERE id = ?').get(key.user_id);
      req.authType = 'key';
      db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(
        new Date().toISOString(),
        key.id,
      );
    } else {
      const token = sessionCookie(req);
      if (token) {
        const session = db
          .prepare('SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?')
          .get(digest(token), Date.now());
        if (session) {
          req.session = session;
          req.user = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id);
          req.authType = 'session';
        }
      }
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.get('Origin');
      if (origin && origin !== config.origin)
        return next(new ApiError(403, 'ORIGIN_DENIED', 'Источник запроса не разрешён.'));
      if (req.authType === 'session' && req.get('X-CSRF-Token') !== req.session.csrf)
        return next(new ApiError(403, 'CSRF_FAILED', 'Обновите страницу и повторите запрос.'));
    }
    next();
  });
  const requireUser = (req, _res, next) =>
    req.user ? next() : next(new ApiError(401, 'UNAUTHORIZED', 'Войдите в аккаунт.'));
  const requireSession = (req, _res, next) =>
    req.authType === 'session'
      ? next()
      : next(
          new ApiError(403, 'SESSION_REQUIRED', 'Это действие доступно после входа в браузере.'),
        );
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.production,
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
  const setSession = (req, res, user) => {
    const old = sessionCookie(req);
    if (old) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(digest(old));
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
    const token = secret();
    const csrfToken = secret();
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)').run(
      digest(token),
      user.id,
      csrfToken,
      Date.now() + cookieOptions.maxAge,
    );
    res.cookie('menumind_session', token, cookieOptions);
    return { user: publicUser(user), csrfToken };
  };
  const readProfile = (userId) =>
    JSON.parse(db.prepare('SELECT data FROM profiles WHERE user_id = ?').get(userId).data);
  const recipeFromRow = (row) => {
    const data = JSON.parse(row.data);
    return { ...data, tags: extractTags(data) };
  };
  const listRecipes = (userId) =>
    db
      .prepare('SELECT * FROM recipes WHERE user_id = ? ORDER BY created_at, id')
      .all(userId)
      .map(recipeFromRow);
  const findRecipe = (userId, id) => {
    const row = db.prepare('SELECT * FROM recipes WHERE user_id = ? AND id = ?').get(userId, id);
    if (!row) fail(404, 'NOT_FOUND', 'Блюдо не найдено.');
    return recipeFromRow(row);
  };
  const saveRecipe = db.transaction((userId, recipe) => {
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO recipes VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at',
    ).run(recipe.id, userId, JSON.stringify(recipe), now, now);
    db.prepare('DELETE FROM recipe_tags WHERE user_id = ? AND recipe_id = ?').run(
      userId,
      recipe.id,
    );
    for (const tag of extractTags(recipe))
      db.prepare('INSERT INTO recipe_tags VALUES (?, ?, ?, ?)').run(
        userId,
        recipe.id,
        tag.id,
        JSON.stringify(tag.evidence),
      );
    return findRecipe(userId, recipe.id);
  });
  const findGeneration = (userId, id) => {
    const row = db
      .prepare('SELECT * FROM generations WHERE id = ? AND user_id = ?')
      .get(id, userId);
    if (!row) fail(404, 'NOT_FOUND', 'Описание не найдено.');
    return { ...JSON.parse(row.data), feedback: row.feedback };
  };
  const spec = {
    openapi: '3.1.0',
    info: {
      title: 'MenuMind API',
      version: '1.0.0',
      description:
        'Данные пользователя изолированы. Генерация синхронная, шаблонная или через LLM. Проверка состава человеком обязательна.',
    },
    servers: [{ url: '/api/v1' }],
    components: {
      securitySchemes: {
        apiKey: { type: 'http', scheme: 'bearer' },
        session: { type: 'apiKey', in: 'cookie', name: 'menumind_session' },
      },
    },
    paths: {},
  };
  const route = (
    method,
    path,
    summary,
    schema,
    handler,
    { auth = true, sessionOnly = false, status = 200 } = {},
  ) => {
    const parameters = [...path.matchAll(/:([a-zA-Z]+)/g)].map((match) => ({
      name: match[1],
      in: 'path',
      required: true,
      schema: { type: 'string' },
    }));
    if (auth && method !== 'get')
      parameters.push({
        name: 'X-CSRF-Token',
        in: 'header',
        required: false,
        description: 'Обязателен для cookie-сессии, получен из /auth/me. Bearer-ключу не нужен.',
        schema: { type: 'string' },
      });
    if (path === '/generations' && method === 'post')
      parameters.push({
        name: 'Idempotency-Key',
        in: 'header',
        required: false,
        schema: { type: 'string', maxLength: 128 },
        description:
          'Повтор того же запроса возвращает сохранённый результат. Другой payload: 409.',
      });
    spec.paths[path.replace(/:([a-zA-Z]+)/g, '{$1}')] ??= {};
    spec.paths[path.replace(/:([a-zA-Z]+)/g, '{$1}')][method] = {
      summary,
      security: auth ? (sessionOnly ? [{ session: [] }] : [{ apiKey: [] }, { session: [] }]) : [],
      parameters,
      ...(schema
        ? {
            requestBody: {
              required: true,
              content: {
                'application/json': { schema: z.toJSONSchema(schema, { unrepresentable: 'any' }) },
              },
            },
          }
        : {}),
      responses: {
        [status]: {
          description: 'Успешно',
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        400: { description: 'Некорректный JSON' },
        401: { description: 'Необходима авторизация' },
        403: { description: 'Нет доступа / CSRF' },
        404: { description: 'Объект не найден' },
        409: { description: 'Конфликт' },
        422: { description: 'Ошибка валидации' },
        429: { description: 'Лимит запросов' },
        502: { description: 'Ошибка ответа LLM' },
        503: { description: 'LLM недоступна / не настроена' },
        504: { description: 'Таймаут LLM' },
      },
    };
    app[method](
      `/api/v1${path}`,
      ...(auth ? [requireUser] : []),
      ...(sessionOnly ? [requireSession] : []),
      async (req, res) => {
        const input = schema?.parse(req.body);
        const result = await handler(req, res, input);
        if (!res.headersSent) res.status(status).json(result);
      },
    );
  };
  if (!disableRateLimits)
    app.use(
      ['/api/v1/auth/login', '/api/v1/auth/register'],
      rateLimit({
        windowMs: 15 * 60_000,
        limit: 30,
        skipSuccessfulRequests: true,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        message: {
          error: {
            code: 'AUTH_RATE_LIMITED',
            message: 'Слишком много попыток входа. Повторите позже.',
          },
        },
      }),
    );
  route(
    'get',
    '/health',
    'Состояние сервиса',
    null,
    () => {
      db.prepare('SELECT 1').get();
      return { status: 'ok', provider: config.llm.provider };
    },
    { auth: false },
  );
  route(
    'post',
    '/auth/register',
    'Регистрация и создание пространства с тремя примерами блюд',
    registerSchema,
    async (req, res, input) => {
      if (db.prepare('SELECT id FROM users WHERE email = ?').get(input.email))
        fail(409, 'EMAIL_EXISTS', 'Аккаунт с этим email уже существует.');
      const user = {
        id: randomUUID(),
        email: input.email,
        name: input.name,
        password_hash: await hashPassword(input.password),
        created_at: new Date().toISOString(),
      };
      try {
        db.transaction(() => {
          db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?)').run(
            user.id,
            user.email,
            user.name,
            user.password_hash,
            user.created_at,
          );
          db.prepare('INSERT INTO profiles VALUES (?, ?, ?)').run(
            user.id,
            JSON.stringify(defaultProfile(input.restaurantName)),
            user.created_at,
          );
          starters.forEach((recipe) => saveRecipe(user.id, recipe));
        })();
      } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE')
          fail(409, 'EMAIL_EXISTS', 'Аккаунт с этим email уже существует.');
        throw error;
      }
      return setSession(req, res, user);
    },
    { auth: false, status: 201 },
  );
  route(
    'post',
    '/auth/login',
    'Вход в аккаунт',
    loginSchema,
    async (req, res, input) => {
      const user = db.prepare('SELECT * FROM users WHERE email = ?').get(input.email);
      const valid = await verifyPassword(input.password, user?.password_hash);
      if (!user || !valid) fail(401, 'INVALID_CREDENTIALS', 'Неверный email или пароль.');
      return setSession(req, res, user);
    },
    { auth: false },
  );
  route('get', '/auth/me', 'Текущий пользователь и CSRF-токен', null, (req) => ({
    user: publicUser(req.user),
    csrfToken: req.session?.csrf ?? null,
  }));
  route(
    'post',
    '/auth/logout',
    'Выход и отзыв сессии',
    null,
    (req, res) => {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.session.token_hash);
      res.clearCookie('menumind_session', { ...cookieOptions, maxAge: undefined });
      return { ok: true };
    },
    { sessionOnly: true },
  );
  route('get', '/workspace', 'Загрузка рабочего пространства', null, (req) => {
    const last = db
      .prepare(
        'SELECT id FROM generations WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1',
      )
      .get(req.user.id);
    return {
      user: publicUser(req.user),
      profile: readProfile(req.user.id),
      recipes: listRecipes(req.user.id),
      result: last ? findGeneration(req.user.id, last.id) : null,
      provider: config.llm.provider,
    };
  });
  route('get', '/profile', 'Профиль и предпочтения', null, (req) => readProfile(req.user.id));
  route(
    'put',
    '/profile',
    'Сохранение профиля и предпочтений',
    profileSchema,
    (req, _res, input) => {
      const known = new Set(tagCatalog.map((t) => t.id));
      if ([...input.preferredTags, ...input.avoidedTags].some((id) => !known.has(id)))
        fail(422, 'UNKNOWN_TAG', 'Неизвестный тег.');
      if (input.preferredTags.some((id) => input.avoidedTags.includes(id)))
        fail(422, 'CONFLICTING_TAGS', 'Один тег не может быть предпочтительным и нежелательным.');
      db.prepare('UPDATE profiles SET data = ?, updated_at = ? WHERE user_id = ?').run(
        JSON.stringify(input),
        new Date().toISOString(),
        req.user.id,
      );
      return input;
    },
  );
  route(
    'put',
    '/settings',
    'Сохранение голоса бренда, примеров и лимитов',
    settingsSchema,
    (req, _res, input) => {
      const profile = { ...readProfile(req.user.id), settings: input };
      db.prepare('UPDATE profiles SET data = ?, updated_at = ? WHERE user_id = ?').run(
        JSON.stringify(profile),
        new Date().toISOString(),
        req.user.id,
      );
      return profile;
    },
  );
  route('get', '/recipes', 'Список рецептов и извлечённых тегов', null, (req) => ({
    items: listRecipes(req.user.id),
  }));
  route(
    'post',
    '/recipes',
    'Создание рецепта (обязательно только название)',
    recipeSchema,
    (req, _res, input) => {
      const recipe = { ...input, id: input.id ?? `RCP-${randomUUID()}` };
      if (
        db.prepare('SELECT 1 FROM recipes WHERE user_id = ? AND id = ?').get(req.user.id, recipe.id)
      )
        fail(409, 'RECIPE_EXISTS', 'Блюдо с этим идентификатором уже существует.');
      return saveRecipe(req.user.id, recipe);
    },
    { status: 201 },
  );
  route('get', '/recipes/:id', 'Получение рецепта', null, (req) =>
    findRecipe(req.user.id, req.params.id),
  );
  route(
    'put',
    '/recipes/:id',
    'Обновление рецепта и пересчёт тегов',
    recipeSchema,
    (req, _res, input) => {
      findRecipe(req.user.id, req.params.id);
      return saveRecipe(req.user.id, { ...input, id: req.params.id });
    },
  );
  route('delete', '/recipes/:id', 'Удаление рецепта', null, (req) => {
    findRecipe(req.user.id, req.params.id);
    db.prepare('DELETE FROM recipes WHERE user_id = ? AND id = ?').run(req.user.id, req.params.id);
    return { ok: true };
  });
  route('get', '/tags', 'Словарь тегов', null, () => ({ items: tagCatalog }));
  route(
    'post',
    '/tags/extract',
    'Извлечение тегов с фрагментами исходного текста',
    recipeSchema,
    (_req, _res, input) => ({ items: extractTags(input) }),
  );
  route(
    'get',
    '/recommendations',
    'Персональный порядок рецептов по тегам и оценкам',
    null,
    (req) => {
      const feedback = Object.fromEntries(
        db
          .prepare(
            'SELECT recipe_id, SUM(feedback) AS score FROM generations WHERE user_id = ? GROUP BY recipe_id',
          )
          .all(req.user.id)
          .map((row) => [row.recipe_id, Math.max(-3, Math.min(3, row.score))]),
      );
      return { items: rankRecipes(listRecipes(req.user.id), readProfile(req.user.id), feedback) };
    },
  );
  registerPersonalization({ route, db, config, fetchImpl, findRecipe, readProfile, now });
  const inFlight = new Set();
  route(
    'post',
    '/generations',
    'Создание или перегенерация описаний RU/KK для четырёх каналов',
    generationSchema,
    async (req, _res, input) => {
      const key = req.get('Idempotency-Key');
      if (key && !/^[\w-]{1,128}$/.test(key))
        fail(422, 'INVALID_IDEMPOTENCY_KEY', 'Некорректный Idempotency-Key.');
      const hash = digest(JSON.stringify(input));
      const lock = `${req.user.id}:${key ?? randomUUID()}`;
      if (key) {
        const existing = db
          .prepare('SELECT * FROM idempotency WHERE user_id = ? AND key = ? AND expires_at > ?')
          .get(req.user.id, key, Date.now());
        if (existing) {
          if (existing.request_hash !== hash)
            fail(409, 'IDEMPOTENCY_CONFLICT', 'Этот ключ уже использован для другого запроса.');
          return findGeneration(req.user.id, existing.generation_id);
        }
        if (inFlight.has(lock))
          fail(409, 'REQUEST_IN_PROGRESS', 'Запрос с этим ключом ещё выполняется.');
      }
      if ([...inFlight].filter((entry) => entry.startsWith(`${req.user.id}:`)).length >= 3)
        fail(429, 'GENERATION_LIMIT', 'Дождитесь завершения текущих генераций.');
      inFlight.add(lock);
      try {
        const recipe = input.recipeId
          ? findRecipe(req.user.id, input.recipeId)
          : { ...input.recipe, id: null };
        const profile = readProfile(req.user.id);
        let previous = input.previousId ? findGeneration(req.user.id, input.previousId) : null;
        if (previous && previous.recipeId !== recipe.id)
          fail(422, 'RECIPE_MISMATCH', 'Предыдущая генерация относится к другому блюду.');
        const sequence = db
          .prepare('SELECT COUNT(*) AS n FROM generations WHERE user_id = ?')
          .get(req.user.id).n;
        if (!previous && recipe.id) {
          const row = db
            .prepare(
              'SELECT id FROM generations WHERE user_id = ? AND recipe_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1',
            )
            .get(req.user.id, recipe.id);
          if (row) previous = findGeneration(req.user.id, row.id);
        }
        const result = await generateDescription({
          recipe,
          profile,
          language: input.language ?? profile.language,
          tone: input.tone ?? profile.tone,
          maxLength: input.maxLength,
          previous,
          sequence,
          config: config.llm,
          fetchImpl,
        });
        db.transaction(() => {
          db.prepare(
            'INSERT INTO generations (id, user_id, recipe_id, data, created_at) VALUES (?, ?, ?, ?, ?)',
          ).run(result.id, req.user.id, recipe.id, JSON.stringify(result), result.createdAt);
          if (key) {
            db.prepare('DELETE FROM idempotency WHERE expires_at <= ?').run(Date.now());
            db.prepare('INSERT OR REPLACE INTO idempotency VALUES (?, ?, ?, ?, ?)').run(
              req.user.id,
              key,
              hash,
              result.id,
              Date.now() + 86400000,
            );
          }
        })();
        return result;
      } finally {
        inFlight.delete(lock);
      }
    },
    { status: 201 },
  );
  route('get', '/generations', 'Последние 50 описаний', null, (req) => ({
    items: db
      .prepare(
        'SELECT id FROM generations WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 50',
      )
      .all(req.user.id)
      .map((row) => findGeneration(req.user.id, row.id)),
  }));
  route('get', '/generations/:id', 'Получение сохранённого результата', null, (req) =>
    findGeneration(req.user.id, req.params.id),
  );
  route(
    'patch',
    '/generations/:id',
    'Сохранение ручной редакции с проверкой лимитов',
    editSchema,
    (req, _res, input) => {
      const previous = findGeneration(req.user.id, req.params.id);
      const limits = previous.limits;
      if (
        Object.entries(input.texts).some(([id, text]) => text.length > limits[id]) ||
        input.variant.length > limits.yandex
      )
        fail(422, 'LENGTH_EXCEEDED', 'Превышен лимит канала.');
      const result = {
        ...previous,
        ...input,
        editedAt: new Date().toISOString(),
        requiresReview: true,
      };
      db.prepare('UPDATE generations SET data = ? WHERE user_id = ? AND id = ?').run(
        JSON.stringify(result),
        req.user.id,
        req.params.id,
      );
      return result;
    },
  );
  route(
    'put',
    '/generations/:id/feedback',
    'Оценка для персонализации (-1, 0, 1)',
    z.object({ value: z.union([z.literal(-1), z.literal(0), z.literal(1)]) }),
    (req, _res, input) => {
      findGeneration(req.user.id, req.params.id);
      db.prepare('UPDATE generations SET feedback = ? WHERE user_id = ? AND id = ?').run(
        input.value,
        req.user.id,
        req.params.id,
      );
      return { value: input.value };
    },
  );
  route(
    'get',
    '/api-keys',
    'Список API-ключей (без секретов)',
    null,
    (req) => ({
      items: db
        .prepare(
          'SELECT id, name, prefix, created_at AS createdAt, last_used_at AS lastUsedAt FROM api_keys WHERE user_id = ? ORDER BY created_at DESC',
        )
        .all(req.user.id),
    }),
    { sessionOnly: true },
  );
  route(
    'post',
    '/api-keys',
    'Создание API-ключа; секрет показывается один раз',
    z.object({ name: z.string().trim().min(1).max(80) }),
    (req, _res, input) => {
      if (
        db.prepare('SELECT COUNT(*) AS n FROM api_keys WHERE user_id = ?').get(req.user.id).n >= 10
      )
        fail(422, 'KEY_LIMIT', 'Можно создать не больше 10 ключей.');
      const token = `mm_${secret()}`;
      const id = randomUUID();
      const createdAt = new Date().toISOString();
      db.prepare(
        'INSERT INTO api_keys (id, user_id, name, prefix, token_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(id, req.user.id, input.name, token.slice(0, 10), digest(token), createdAt);
      return { id, name: input.name, prefix: token.slice(0, 10), token, createdAt };
    },
    { sessionOnly: true, status: 201 },
  );
  route(
    'delete',
    '/api-keys/:id',
    'Отзыв API-ключа',
    null,
    (req) => {
      const { changes } = db
        .prepare('DELETE FROM api_keys WHERE user_id = ? AND id = ?')
        .run(req.user.id, req.params.id);
      if (!changes) fail(404, 'NOT_FOUND', 'Ключ не найден.');
      return { ok: true };
    },
    { sessionOnly: true },
  );
  route(
    'put',
    '/account/password',
    'Смена пароля и отзыв остальных сессий',
    z.object({ currentPassword: z.string().max(128), newPassword: z.string().min(10).max(128) }),
    async (req, _res, input) => {
      if (!(await verifyPassword(input.currentPassword, req.user.password_hash)))
        fail(401, 'INVALID_CREDENTIALS', 'Неверный текущий пароль.');
      const hash = await hashPassword(input.newPassword);
      db.transaction(() => {
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);
        db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(
          req.user.id,
          req.session.token_hash,
        );
      })();
      return { ok: true };
    },
    { sessionOnly: true },
  );
  app.get('/api/openapi.json', (_req, res) => res.json(spec));
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(spec, { customSiteTitle: 'MenuMind API' }));
  app.use('/api', (_req, _res, next) =>
    next(new ApiError(404, 'NOT_FOUND', 'Маршрут API не найден.')),
  );
  const staticDir = resolve('frontend/dist');
  if (existsSync(staticDir)) {
    app.use(express.static(staticDir));
    app.get('/{*path}', (_req, res) => res.sendFile(resolve(staticDir, 'index.html')));
  }
  app.use((error, req, res, _next) => {
    if (error instanceof ZodError)
      return res.status(422).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Проверьте поля запроса.',
          details: error.issues.map((issue) => ({
            field: issue.path.join('.'),
            message: issue.message,
          })),
          requestId: req.requestId,
        },
      });
    const status =
      error instanceof ApiError
        ? error.status
        : error.type === 'entity.too.large'
          ? 413
          : error.type === 'entity.parse.failed'
            ? 400
            : 500;
    if (status === 500) console.error('Server error', req.requestId, error.code ?? error.name);
    res.status(status).json({
      error: {
        code:
          error instanceof ApiError
            ? error.code
            : status === 400
              ? 'INVALID_JSON'
              : status === 413
                ? 'PAYLOAD_TOO_LARGE'
                : 'INTERNAL_ERROR',
        message:
          error instanceof ApiError
            ? error.message
            : status === 400
              ? 'Некорректный JSON.'
              : status === 413
                ? 'Запрос слишком большой.'
                : 'Внутренняя ошибка сервера.',
        requestId: req.requestId,
      },
    });
  });
  return { app, db, spec };
}
