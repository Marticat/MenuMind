import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { digest } from './auth.mjs';
import { fail, languageSchema, channelSchema } from './schemas.mjs';
import { tagCatalog } from './tags.mjs';
import { generateDescription } from './generation.mjs';
import { availableStyles, descriptionStyles } from './description-styles.mjs';
import {
  MODEL_VERSION,
  ALPHA,
  buildContext,
  chooseArm,
  initialModel,
  updateModel,
} from './bandit.mjs';

export const REWARD_WINDOW_MS = 30 * 60_000;
export const DECISION_TTL_MS = 10 * 60_000;
const customerId = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9_-]+$/);
const customerSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    language: languageSchema.default('ru'),
    descriptionPreference: z.enum(['auto', 'concise', 'ingredients', 'method']).default('auto'),
    preferredTags: z
      .array(z.enum(tagCatalog.map((tag) => tag.id)))
      .max(30)
      .default([]),
  })
  .strict();
const prepareSchema = z
  .object({ recipeId: customerId, language: languageSchema.default('ru') })
  .strict();
const selectSchema = z
  .object({
    requestId: z.uuid(),
    customerId,
    recipeId: customerId,
    channel: channelSchema.default('website'),
    mode: z.enum(['live', 'demo']).default('live'),
  })
  .strict();
const emptySchema = z.object({}).strict();
const feedbackSchema = z.object({ event: z.literal('add_to_cart') }).strict();

export function registerPersonalization({
  route,
  db,
  config,
  fetchImpl,
  findRecipe,
  readProfile,
  now = Date.now,
}) {
  const inFlight = new Map();
  const findCustomer = (userId, id) => {
    const row = db
      .prepare('SELECT data FROM customers WHERE user_id = ? AND id = ?')
      .get(userId, id);
    if (!row) fail(404, 'CUSTOMER_NOT_FOUND', 'Профиль гостя не найден.');
    return { ...JSON.parse(row.data), id };
  };
  const fingerprint = (recipe, profile, language) =>
    digest(
      JSON.stringify({
        version: 'description-styles-v2-tags',
        recipe,
        language,
        brand: {
          restaurantName: profile.restaurantName,
          cuisine: profile.cuisine,
          brandInstructions: profile.brandInstructions,
          tone: profile.tone,
          settings: profile.settings,
        },
        provider: config.llm.provider,
        model: config.llm.model,
        baseUrl: config.llm.baseUrl,
        reasoningEffort: config.llm.reasoningEffort,
      }),
    );
  const currentSource = (userId, recipeId, language) => {
    const recipe = findRecipe(userId, recipeId);
    const profile = readProfile(userId);
    return { recipe, profile, hash: fingerprint(recipe, profile, language) };
  };
  const findSet = (userId, recipeId, hash) => {
    const row = db
      .prepare(
        'SELECT data FROM description_sets WHERE user_id = ? AND recipe_id = ? AND source_hash = ?',
      )
      .get(userId, recipeId, hash);
    return row ? JSON.parse(row.data) : null;
  };
  const readModel = (userId, mode, arm, dimension, version = MODEL_VERSION) => {
    const row = db
      .prepare(
        'SELECT data FROM bandit_models WHERE user_id = ? AND mode = ? AND version = ? AND arm = ?',
      )
      .get(userId, mode, version, arm);
    return row ? JSON.parse(row.data) : initialModel(dimension);
  };
  // Call only inside a synchronous SQLite transaction. A decision updates its arm once.
  const finalize = (decision, reward) => {
    if (decision.reward !== null) return;
    const context = JSON.parse(decision.context);
    const model = readModel(
      decision.user_id,
      decision.mode,
      decision.arm,
      context.length,
      decision.model_version,
    );
    const updated = updateModel(model, context, reward);
    db.prepare(
      'INSERT INTO bandit_models VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, mode, version, arm) DO UPDATE SET data = excluded.data',
    ).run(
      decision.user_id,
      decision.mode,
      decision.model_version,
      decision.arm,
      JSON.stringify(updated),
    );
    db.prepare(
      'UPDATE personalization_decisions SET reward = ?, finalized_at = ? WHERE id = ? AND user_id = ?',
    ).run(reward, now(), decision.id, decision.user_id);
  };
  const settleExpired = (userId, mode) => {
    const pending = db
      .prepare(
        'SELECT * FROM personalization_decisions WHERE user_id = ? AND mode = ? AND reward IS NULL AND expires_at <= ?',
      )
      .all(userId, mode, now());
    for (const decision of pending) finalize(decision, 0);
  };
  const findDecision = (userId, id) => {
    const row = db
      .prepare('SELECT * FROM personalization_decisions WHERE user_id = ? AND id = ?')
      .get(userId, id);
    if (!row) fail(404, 'DECISION_NOT_FOUND', 'Показ не найден.');
    return row;
  };
  const resultFor = (decision) => ({
    ...JSON.parse(decision.selection),
    shownAt: decision.shown_at === null ? null : new Date(decision.shown_at).toISOString(),
    feedbackDeadline:
      decision.expires_at === null ? null : new Date(decision.expires_at).toISOString(),
    reward: decision.reward,
  });

  route('get', '/customers', 'Профили гостей ресторана', null, (req) => ({
    items: db
      .prepare(
        'SELECT id, data FROM customers WHERE user_id = ? ORDER BY updated_at DESC, id LIMIT 200',
      )
      .all(req.user.id)
      .map((row) => ({ ...JSON.parse(row.data), id: row.id })),
  }));
  route(
    'get',
    '/personalization/study',
    'Сохранённая синтетическая демонстрация, не реальные заказы',
    null,
    () =>
      JSON.parse(
        readFileSync(
          new URL('../experiments/personalization-demo/summary.json', import.meta.url),
          'utf8',
        ),
      ),
  );
  route('get', '/customers/:id', 'Получение профиля гостя', null, (req) =>
    findCustomer(req.user.id, req.params.id),
  );
  route(
    'put',
    '/customers/:id',
    'Создание или замена профиля гостя',
    customerSchema,
    (req, _res, input) => {
      const id = customerId.parse(req.params.id);
      const value = { ...input, preferredTags: [...new Set(input.preferredTags)] };
      db.prepare(
        'INSERT INTO customers VALUES (?, ?, ?, ?) ON CONFLICT(user_id, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at',
      ).run(req.user.id, id, JSON.stringify(value), new Date(now()).toISOString());
      return { ...value, id };
    },
  );

  route(
    'post',
    '/description-sets',
    'Подготовка и кеширование вариантов описания RU/KK',
    prepareSchema,
    async (req, _res, input) => {
      const userId = req.user.id;
      const { recipe, profile, hash } = currentSource(userId, input.recipeId, input.language);
      const cached = findSet(userId, input.recipeId, hash);
      if (cached) return cached;
      const lock = `${userId}:${hash}`;
      if (inFlight.has(lock)) return inFlight.get(lock);
      if ([...inFlight.keys()].filter((key) => key.startsWith(`${userId}:`)).length >= 2)
        fail(429, 'GENERATION_LIMIT', 'Дождитесь подготовки текущих описаний.');
      const work = (async () => {
        // All calls finish before releasing the concurrency slot, even if one fails.
        const generated = await Promise.allSettled(
          availableStyles(recipe).map(async (style) => {
            const result = await generateDescription({
              recipe,
              profile,
              language: input.language,
              tone: profile.tone,
              descriptionStyle: style,
              config: config.llm,
              fetchImpl,
            });
            return {
              style,
              label: descriptionStyles[style].label,
              texts: result.texts,
              descriptionTags: result.descriptionTags,
              limits: result.limits,
            };
          }),
        );
        const failed = generated.find((item) => item.status === 'rejected');
        if (failed) throw failed.reason;
        if (currentSource(userId, recipe.id, input.language).hash !== hash)
          fail(
            409,
            'SOURCE_CHANGED',
            'Техкарта или настройки изменились. Подготовьте описания заново.',
          );
        const result = {
          id: randomUUID(),
          recipeId: recipe.id,
          language: input.language,
          sourceHash: hash,
          provider: config.llm.provider,
          requiresReview: true,
          createdAt: new Date(now()).toISOString(),
          variants: generated.map((item) => item.value),
        };
        db.prepare('INSERT INTO description_sets VALUES (?, ?, ?, ?, ?, ?)').run(
          result.id,
          userId,
          recipe.id,
          hash,
          JSON.stringify(result),
          result.createdAt,
        );
        return result;
      })();
      inFlight.set(lock, work);
      try {
        return await work;
      } finally {
        inFlight.delete(lock);
      }
    },
  );

  route(
    'post',
    '/personalizations',
    'Выбор описания LinUCB; requestId обеспечивает идемпотентность',
    selectSchema,
    (req, _res, input) => {
      const userId = req.user.id;
      const inputHash = digest(JSON.stringify(input));
      return db.transaction(() => {
        settleExpired(userId, input.mode);
        const existing = db
          .prepare('SELECT * FROM personalization_decisions WHERE user_id = ? AND request_id = ?')
          .get(userId, input.requestId);
        if (existing) {
          if (existing.input_hash !== inputHash)
            fail(409, 'IDEMPOTENCY_CONFLICT', 'requestId уже использован для другого запроса.');
          return resultFor(existing);
        }
        const customer = findCustomer(userId, input.customerId);
        const { recipe, hash } = currentSource(userId, input.recipeId, customer.language);
        const set = findSet(userId, recipe.id, hash);
        if (!set)
          fail(
            409,
            'DESCRIPTIONS_REQUIRED',
            'Сначала подготовьте варианты описаний для блюда и языка гостя.',
          );
        // Identical texts in a short channel must not compete as distinct actions.
        const seen = new Set();
        const variants = set.variants.filter((variant) => {
          const text = variant.texts[input.channel].trim().replace(/\s+/g, ' ').toLowerCase();
          if (seen.has(text)) return false;
          seen.add(text);
          return true;
        });
        const history = Object.fromEntries(
          db
            .prepare(
              `SELECT arm, COUNT(*) AS observations, SUM(reward) AS rewards
        FROM personalization_decisions WHERE user_id = ? AND customer_id = ? AND mode = ? AND model_version = ? AND reward IS NOT NULL GROUP BY arm`,
            )
            .all(userId, customer.id, input.mode, MODEL_VERSION)
            .map((row) => [row.arm, row]),
        );
        const contexts = Object.fromEntries(
          variants.map((variant) => [
            variant.style,
            buildContext(
              customer,
              recipe,
              input.channel,
              history,
              variant.descriptionTags[input.channel],
            ),
          ]),
        );
        const models = Object.fromEntries(
          variants.map(({ style }) => [
            style,
            readModel(userId, input.mode, style, contexts[style].length),
          ]),
        );
        const choice = chooseArm(
          models,
          contexts,
          variants.map((v) => v.style),
          customer.descriptionPreference,
        );
        const variant = variants.find((v) => v.style === choice.arm);
        const context = contexts[choice.arm];
        const result = {
          id: randomUUID(),
          requestId: input.requestId,
          customerId: customer.id,
          recipeId: recipe.id,
          descriptionSetId: set.id,
          sourceHash: hash,
          style: variant.style,
          label: variant.label,
          text: variant.texts[input.channel],
          descriptionTags: variant.descriptionTags[input.channel],
          language: customer.language,
          channel: input.channel,
          mode: input.mode,
          provider: set.provider,
          requiresReview: set.requiresReview,
          algorithm: 'LinUCB',
          modelVersion: MODEL_VERSION,
          alpha: ALPHA,
          scores: choice.scores,
          observations: Object.values(models).reduce((sum, model) => sum + model.observations, 0),
          createdAt: new Date(now()).toISOString(),
        };
        db.prepare(
          `INSERT INTO personalization_decisions
        (id, user_id, customer_id, request_id, input_hash, mode, model_version, arm, context, selection, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          result.id,
          userId,
          customer.id,
          input.requestId,
          inputHash,
          input.mode,
          MODEL_VERSION,
          choice.arm,
          JSON.stringify(context),
          JSON.stringify(result),
          now(),
        );
        return resultFor(findDecision(userId, result.id));
      })();
    },
  );

  route(
    'post',
    '/personalizations/:id/impression',
    'Подтвердить фактический показ; повтор не продлевает окно 30 минут',
    emptySchema,
    (req) => {
      return db.transaction(() => {
        const decision = findDecision(req.user.id, req.params.id);
        if (decision.shown_at !== null) return resultFor(decision);
        if (now() >= decision.created_at + DECISION_TTL_MS)
          fail(
            409,
            'DECISION_EXPIRED',
            'Выбор устарел. Запросите новое описание с новым requestId.',
          );
        const selection = JSON.parse(decision.selection);
        if (
          currentSource(req.user.id, selection.recipeId, selection.language).hash !==
          selection.sourceHash
        )
          fail(
            409,
            'SOURCE_CHANGED',
            'Техкарта или настройки изменились. Запросите новое описание.',
          );
        db.prepare(
          'UPDATE personalization_decisions SET shown_at = ?, expires_at = ? WHERE user_id = ? AND id = ?',
        ).run(now(), now() + REWARD_WINDOW_MS, req.user.id, decision.id);
        return resultFor(findDecision(req.user.id, decision.id));
      })();
    },
  );

  route(
    'post',
    '/personalizations/:id/feedback',
    'Добавление в корзину после показа; повтор учитывается один раз',
    feedbackSchema,
    (req) => {
      const original = findDecision(req.user.id, req.params.id);
      // Persist expired negatives even when this particular feedback will be rejected.
      db.transaction(() => settleExpired(req.user.id, original.mode))();
      return db.transaction(() => {
        const decision = findDecision(req.user.id, original.id);
        if (decision.shown_at === null)
          fail(409, 'IMPRESSION_REQUIRED', 'Сначала подтвердите показ описания.');
        if (decision.reward === 0)
          fail(
            409,
            'FEEDBACK_EXPIRED',
            'Окно реакции завершено; показ учтён без добавления в корзину.',
          );
        const duplicate = decision.reward === 1;
        if (!duplicate) finalize(decision, 1);
        return { ...resultFor(findDecision(req.user.id, decision.id)), duplicate };
      })();
    },
  );

  route(
    'get',
    '/personalization/stats',
    'Показы и результаты отдельно для рабочих и тестовых запросов',
    null,
    (req) =>
      db.transaction(() => {
        for (const mode of ['live', 'demo']) settleExpired(req.user.id, mode);
        const items = db
          .prepare(
            `SELECT mode, arm AS style, COUNT(*) AS decisions,
      COUNT(shown_at) AS impressions, COUNT(reward) AS observations,
      COALESCE(SUM(reward), 0) AS additions,
      SUM(CASE WHEN shown_at IS NOT NULL AND reward IS NULL THEN 1 ELSE 0 END) AS pending
      FROM personalization_decisions WHERE user_id = ? AND model_version = ? GROUP BY mode, arm`,
          )
          .all(req.user.id, MODEL_VERSION);
        return { algorithm: 'LinUCB', modelVersion: MODEL_VERSION, rewardWindowMinutes: 30, items };
      })(),
  );
}
