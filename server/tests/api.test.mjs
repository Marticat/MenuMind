import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createApp } from '../app.mjs';
import { loadConfig } from '../config.mjs';
import { extractTags } from '../tags.mjs';
import { buildMessages, generateDescription } from '../generation.mjs';
import { checkGrounding } from '../grounding.mjs';
import { defaultProfile } from '../db.mjs';
import { createServer } from 'node:http';

function setup(t, options = {}) {
  const config = loadConfig({ DATABASE_PATH: ':memory:' });
  Object.assign(config, options.config);
  const instance = createApp({ config, disableRateLimits: true, ...options });
  t.after(() => instance.db.close());
  return { ...instance, config };
}

test('grounding rejects invented quantities, textures, inflected noodles and numbers, but permits supplied facts', () => {
  for (const text of [
    'Суп с лапшой.',
    'Суп со щепоткой соли.',
    'Жеңіл сорпа.',
    'Аз мөлшердегі тұз қосылған сорпа.',
    'Варить 25 минут.',
  ])
    assert.throws(() => checkGrounding(text, { name: 'Суп', ingredients: ['соль'] }), {
      code: 'UNSUPPORTED_FACT',
    });
  assert.doesNotThrow(() =>
    checkGrounding('Лапша с луком.', { name: 'Лапша', ingredients: ['лук'] }),
  );
  assert.doesNotThrow(() =>
    checkGrounding('25 минут.', { name: 'Суп', method: 'Варка 25 минут.' }),
  );
});

test('repair changes repeated channels, keeps real provider text and accounts for both calls', async () => {
  const previous = {
    texts: Object.fromEntries(['yandex', 'wolt', 'website', 'print'].map((id) => [id, 'Суп.'])),
    variant: 'Суп.',
  };
  let count = 0;
  const result = await generateDescription({
    recipe: { name: 'Суп', ingredients: [] },
    profile: defaultProfile('Test'),
    language: 'ru',
    tone: 'editorial',
    previous,
    config: loadConfig({
      LLM_PROVIDER: 'openai-compatible',
      LLM_API_KEY: 'test',
      LLM_MODEL: 'test',
    }).llm,
    fetchImpl: async (_url, options) => {
      count++;
      if (count === 2)
        assert.equal(
          JSON.parse(JSON.parse(options.body).messages[1].content).correction.reason,
          'LLM_REPEATED_OUTPUT',
        );
      const value = count === 1 ? 'Суп!' : 'В меню — суп.';
      return Response.json({
        id: `response-${count}`,
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: JSON.stringify({
                texts: Object.fromEntries(
                  ['yandex', 'wolt', 'website', 'print'].map((id) => [id, value]),
                ),
                variant: value,
              }),
            },
          },
        ],
      });
    },
  });
  assert.equal(count, 2);
  assert.equal(result.texts.yandex, 'В меню — суп.');
  assert.equal(result.providerResponseId, 'response-2');
  assert.equal(result.usage.totalTokens, 30);
  assert.equal(result.providerAttempts[0].code, 'LLM_REPEATED_OUTPUT');
});

test('repair shares a total timeout rather than resetting the latency budget', async () => {
  const upstream = createServer((_req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              message: {
                content: JSON.stringify({
                  texts: { yandex: 'Суп с лапшой.', wolt: 'Суп.', website: 'Суп.', print: 'Суп.' },
                  variant: 'Суп.',
                }),
              },
            },
          ],
        }),
      );
    }, 600);
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const start = Date.now();
  try {
    await assert.rejects(
      generateDescription({
        recipe: { name: 'Суп', ingredients: [] },
        profile: defaultProfile('Test'),
        language: 'ru',
        tone: 'editorial',
        config: loadConfig({
          LLM_PROVIDER: 'openai-compatible',
          LLM_API_KEY: 'test',
          LLM_MODEL: 'test',
          LLM_TIMEOUT_MS: '1150',
          LLM_BASE_URL: `http://127.0.0.1:${upstream.address().port}/v1`,
        }).llm,
      }),
      { code: 'LLM_TIMEOUT' },
    );
    assert.ok(Date.now() - start < 1500);
  } finally {
    upstream.closeAllConnections();
    await new Promise((resolve) => upstream.close(resolve));
  }
});
async function account(app, email = 'chef@example.test') {
  const client = request.agent(app);
  const response = await client
    .post('/api/v1/auth/register')
    .send({ name: 'Шеф', email, password: 'Correct-horse-42', restaurantName: 'Мой ресторан' })
    .expect(201);
  return {
    client,
    csrf: response.body.csrfToken,
    user: response.body.user,
    cookie: response.headers['set-cookie'][0],
  };
}
const mutation = (actor, method, path, body) =>
  actor.client[method](`/api/v1${path}`).set('X-CSRF-Token', actor.csrf).send(body);

test('demo images load for new and legacy recipes and saved results without rewriting recipe data', async (t) => {
  const { app, db } = setup(t);
  const actor = await account(app);
  const recipes = (await actor.client.get('/api/v1/recipes').expect(200)).body.items;
  assert.deepEqual(
    new Set(recipes.filter((r) => r.id.startsWith('RCP-884')).map((r) => r.image)),
    new Set(['/dish.jpg', '/dishes/scallops.png', '/dishes/mushroom-risotto.png']),
  );
  const id = 'RCP-8842-SEA';
  const row = db
    .prepare('SELECT data FROM recipes WHERE user_id = ? AND id = ?')
    .get(actor.user.id, id);
  const legacy = JSON.parse(row.data);
  delete legacy.image;
  const original = JSON.stringify(legacy);
  db.prepare('UPDATE recipes SET data = ? WHERE user_id = ? AND id = ?').run(
    original,
    actor.user.id,
    id,
  );
  assert.equal(
    (await actor.client.get(`/api/v1/recipes/${id}`).expect(200)).body.image,
    '/dishes/scallops.png',
  );
  assert.equal(
    db.prepare('SELECT data FROM recipes WHERE user_id = ? AND id = ?').get(actor.user.id, id).data,
    original,
  );
  const generated = (await mutation(actor, 'post', '/generations', { recipeId: id }).expect(201))
    .body;
  assert.equal(generated.image, '/dishes/scallops.png');
  const oldGeneration = { ...generated, sourceFingerprint: JSON.stringify({ recipe: legacy }) };
  delete oldGeneration.image;
  db.prepare('UPDATE generations SET data = ? WHERE user_id = ? AND id = ?').run(
    JSON.stringify(oldGeneration),
    actor.user.id,
    generated.id,
  );
  const edited = { ...legacy, name: 'Новое блюдо', ingredients: ['Томат'] };
  await mutation(actor, 'put', `/recipes/${id}`, edited).expect(200);
  assert.equal((await actor.client.get(`/api/v1/recipes/${id}`).expect(200)).body.image, undefined);
  assert.equal(
    (await actor.client.get(`/api/v1/generations/${generated.id}`).expect(200)).body.image,
    '/dishes/scallops.png',
  );
  await mutation(actor, 'put', `/recipes/${id}`, {
    ...legacy,
    image: '/dishes/scallops.png',
  }).expect(200);
});

test('registration, normalized email, hashed passwords, cookie flags, login and logout', async (t) => {
  const { app, db } = setup(t);
  const actor = await account(app, 'CHEF@EXAMPLE.TEST');
  assert.equal(actor.user.email, 'chef@example.test');
  assert.match(actor.cookie, /HttpOnly/);
  assert.match(actor.cookie, /SameSite=Lax/);
  const row = db.prepare('SELECT * FROM users').get();
  assert.notEqual(row.password_hash, 'Correct-horse-42');
  assert.match(row.password_hash, /^[0-9a-f]{32}:[0-9a-f]{128}$/);
  assert.equal(db.prepare('SELECT token_hash FROM sessions').get().token_hash.length, 64);
  await request(app)
    .post('/api/v1/auth/register')
    .send({
      name: 'a',
      email: 'chef@example.test',
      password: 'Correct-horse-42',
      restaurantName: 'b',
    })
    .expect(409);
  await mutation(actor, 'post', '/auth/logout').expect(200);
  await actor.client.get('/api/v1/workspace').expect(401);
  await actor.client
    .post('/api/v1/auth/login')
    .send({ email: 'chef@example.test', password: 'bad-password' })
    .expect(401);
  await actor.client
    .post('/api/v1/auth/login')
    .send({ email: 'chef@example.test', password: 'Correct-horse-42' })
    .expect(200);
});

test('validation, expired sessions, CSRF and foreign origins', async (t) => {
  const { app, db } = setup(t);
  const actor = await account(app);
  await actor.client.post('/api/v1/recipes').send({ name: 'Суп' }).expect(403);
  await mutation(actor, 'post', '/recipes', { name: 'Суп' })
    .set('Origin', 'https://foreign.test')
    .expect(403);
  await mutation(actor, 'post', '/recipes', { name: '' }).expect(422);
  await mutation(actor, 'post', '/recipes', { name: 'Суп', ingredients: 'не список' }).expect(422);
  await mutation(actor, 'post', '/generations', { recipe: { name: 'Суп' }, language: 'en' }).expect(
    422,
  );
  await mutation(actor, 'post', '/generations', { recipe: { name: 'Суп' }, maxLength: 1 }).expect(
    422,
  );
  await mutation(actor, 'post', '/generations', { recipeId: 'a', recipe: { name: 'Суп' } }).expect(
    422,
  );
  await actor.client
    .post('/api/v1/recipes')
    .set('X-CSRF-Token', actor.csrf)
    .set('Content-Type', 'application/json')
    .send('{no')
    .expect(400);
  db.prepare('UPDATE sessions SET expires_at = 0').run();
  await actor.client.get('/api/v1/workspace').expect(401);
});

test('recipe CRUD and all resource boundaries isolate two users', async (t) => {
  const { app } = setup(t);
  const a = await account(app, 'a@example.test');
  const b = await account(app, 'b@example.test');
  const created = await mutation(a, 'post', '/recipes', {
    name: 'Тыквенный суп',
    ingredients: ['Тыква', 'Сливочное масло'],
  }).expect(201);
  const id = created.body.id;
  assert.ok(created.body.tags.some((tag) => tag.id === 'milk'));
  await b.client.get(`/api/v1/recipes/${id}`).expect(404);
  await mutation(b, 'put', `/recipes/${id}`, { name: 'Украдено' }).expect(404);
  await mutation(b, 'delete', `/recipes/${id}`).expect(404);
  const generation = await mutation(a, 'post', '/generations', { recipeId: id }).expect(201);
  await b.client.get(`/api/v1/generations/${generation.body.id}`).expect(404);
  await mutation(b, 'put', `/generations/${generation.body.id}/feedback`, { value: 1 }).expect(404);
  const update = await mutation(a, 'put', `/recipes/${id}`, {
    name: 'Суп',
    ingredients: ['Тыква'],
  }).expect(200);
  assert.ok(!update.body.tags.some((tag) => tag.id === 'milk'));
  await mutation(a, 'delete', `/recipes/${id}`).expect(200);
  await a.client.get(`/api/v1/recipes/${id}`).expect(404);
  await a.client.get(`/api/v1/generations/${generation.body.id}`).expect(200);
});

test('extractor returns grounded RU/KK tags and never infers absent allergens or diets', () => {
  const tags = extractTags({
    name: 'Овощной суп',
    ingredients: ['сүт', 'жұмыртқа', 'жаңғақ'],
    method: 'пеште пісіру',
  });
  assert.deepEqual(
    tags
      .filter((tag) => tag.kind === 'allergen')
      .map((tag) => tag.id)
      .sort(),
    ['egg', 'milk', 'nuts'],
  );
  assert.ok(tags.every((tag) => tag.evidence.text && !tag.confirmed));
  assert.deepEqual(extractTags({ name: 'Цезарь' }), []);
  assert.ok(!extractTags({ name: 'Яйцо', ingredients: [] }).some((tag) => tag.id === 'egg'));
  assert.ok(
    !extractTags({ name: 'Кокос', ingredients: ['Оливковое масло'] }).some(
      (tag) => tag.id === 'milk' || tag.id === 'nuts',
    ),
  );
});

test('generation for both languages fits limits and name-only input adds no recipe facts', async (t) => {
  const { app } = setup(t);
  const a = await account(app);
  for (const language of ['ru', 'kk']) {
    const name = language === 'ru' ? 'Суп' : 'Сорпа';
    const { body } = await mutation(a, 'post', '/generations', {
      recipe: { name },
      language,
      maxLength: 60,
    }).expect(201);
    assert.equal(body.language, language);
    assert.equal(body.provider, 'template');
    assert.equal(body.requiresReview, true);
    for (const text of [...Object.values(body.texts), body.variant]) {
      assert.ok(text.length > 0 && text.length <= 60);
      assert.ok(text.includes(name));
      assert.doesNotMatch(text, /куриц|тауық|морков|сәбіз/iu);
    }
  }
});

test('inline recipe requests retain regeneration context and reject another dish as previous', async (t) => {
  const contexts = [];
  const config = loadConfig({
    DATABASE_PATH: ':memory:',
    LLM_PROVIDER: 'openai-compatible',
    LLM_API_KEY: 'test',
    LLM_MODEL: 'test',
  });
  const { app } = setup(t, {
    config,
    fetchImpl: async (_url, options) => {
      const context = JSON.parse(JSON.parse(options.body).messages[1].content);
      contexts.push(context);
      const value = context.previous ? 'В меню — суп.' : 'Суп — блюдо в меню.';
      return Response.json({
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: JSON.stringify({
                texts: Object.fromEntries(
                  ['yandex', 'wolt', 'website', 'print'].map((id) => [id, value]),
                ),
                variant: value,
              }),
            },
          },
        ],
      });
    },
  });
  const actor = await account(app);
  const input = { recipe: { name: 'Суп' } };
  const first = (await mutation(actor, 'post', '/generations', input).expect(201)).body;
  const next = (await mutation(actor, 'post', '/generations', input).expect(201)).body;
  assert.equal(contexts[0].previous, null);
  assert.deepEqual(contexts[1].previous.texts, first.texts);
  assert.notEqual(next.texts.yandex, first.texts.yandex);
  const mismatch = await mutation(actor, 'post', '/generations', {
    recipe: { name: 'Рис' },
    previousId: first.id,
  }).expect(422);
  assert.equal(mismatch.body.error.code, 'RECIPE_MISMATCH');
  const other = await account(app, 'other-inline@example.test');
  await mutation(other, 'post', '/generations', input).expect(201);
  assert.equal(contexts[2].previous, null);
});

test('regeneration varies, idempotency persists and different payloads conflict', async (t) => {
  const { app } = setup(t);
  const a = await account(app);
  const body = { recipeId: 'RCP-8841-BRX' };
  const first = await mutation(a, 'post', '/generations', body)
    .set('Idempotency-Key', 'request-1')
    .expect(201);
  const retry = await mutation(a, 'post', '/generations', body)
    .set('Idempotency-Key', 'request-1')
    .expect(201);
  assert.equal(first.body.id, retry.body.id);
  await mutation(a, 'post', '/generations', { ...body, language: 'kk' })
    .set('Idempotency-Key', 'request-1')
    .expect(409);
  const again = await mutation(a, 'post', '/generations', {
    ...body,
    previousId: first.body.id,
  }).expect(201);
  assert.notEqual(first.body.texts.yandex, again.body.texts.yandex);
  const list = await a.client.get('/api/v1/generations').expect(200);
  assert.equal(list.body.items.length, 2);
  const tooLong = {
    texts: { ...again.body.texts, yandex: 'x'.repeat(251) },
    variant: again.body.variant,
  };
  await mutation(a, 'patch', `/generations/${again.body.id}`, tooLong).expect(422);
  const edit = {
    texts: { ...again.body.texts, yandex: 'Редакция шефа.' },
    variant: again.body.variant,
  };
  await mutation(a, 'patch', `/generations/${again.body.id}`, edit).expect(200);
  assert.equal(
    (await a.client.get(`/api/v1/generations/${again.body.id}`)).body.texts.yandex,
    'Редакция шефа.',
  );
});

test('preferences, feedback and brand settings persist and change ranking', async (t) => {
  const { app } = setup(t);
  const a = await account(app);
  const profile = (await a.client.get('/api/v1/profile')).body;
  profile.preferredTags = ['mushrooms'];
  profile.avoidedTags = ['beef'];
  profile.language = 'kk';
  profile.restaurantName = 'Жаңа мейрамхана';
  await mutation(a, 'put', '/profile', profile).expect(200);
  let recommendations = (await a.client.get('/api/v1/recommendations')).body.items;
  assert.ok(recommendations[0].tags.some((tag) => tag.id === 'mushrooms'));
  assert.equal(recommendations[0].score, 3);
  assert.ok(recommendations[0].reasons.length);
  const generation = await mutation(a, 'post', '/generations', { recipeId: 'RCP-8843-VEG' }).expect(
    201,
  );
  assert.equal(generation.body.language, 'kk');
  await mutation(a, 'put', `/generations/${generation.body.id}/feedback`, { value: 1 }).expect(200);
  recommendations = (await a.client.get('/api/v1/recommendations')).body.items;
  assert.equal(recommendations[0].id, 'RCP-8843-VEG');
  assert.equal(recommendations[0].score, 4);
  profile.avoidedTags = ['mushrooms'];
  await mutation(a, 'put', '/profile', profile).expect(422);
  profile.avoidedTags = [];
  profile.preferredTags = ['unknown'];
  await mutation(a, 'put', '/profile', profile).expect(422);
});

test('API keys are hashed, scoped to owner, revocable and cannot mint other keys', async (t) => {
  const { app, db } = setup(t);
  const a = await account(app);
  const b = await account(app, 'second@example.test');
  const { body: key } = await mutation(a, 'post', '/api-keys', { name: 'POS' }).expect(201);
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM api_keys').all()).includes(key.token));
  const headers = { Authorization: `Bearer ${key.token}` };
  await request(app)
    .post('/api/v1/generations')
    .set(headers)
    .send({ recipe: { name: 'Суп' } })
    .expect(201);
  await request(app).post('/api/v1/api-keys').set(headers).send({ name: 'Bad' }).expect(403);
  await mutation(b, 'delete', `/api-keys/${key.id}`).expect(404);
  const listed = await a.client.get('/api/v1/api-keys').expect(200);
  assert.equal(listed.body.items[0].token, undefined);
  await mutation(a, 'delete', `/api-keys/${key.id}`).expect(200);
  await request(app).get('/api/v1/recipes').set(headers).expect(401);
});

test('password change revokes other sessions and retains the current one', async (t) => {
  const { app } = setup(t);
  const a = await account(app);
  const other = request.agent(app);
  await other
    .post('/api/v1/auth/login')
    .send({ email: a.user.email, password: 'Correct-horse-42' })
    .expect(200);
  await mutation(a, 'put', '/account/password', {
    currentPassword: 'Correct-horse-42',
    newPassword: 'New-password-43',
  }).expect(200);
  await other.get('/api/v1/workspace').expect(401);
  await a.client.get('/api/v1/workspace').expect(200);
});

test('OpenAPI is live and documents every business endpoint', async (t) => {
  const { app } = setup(t);
  const { body } = await request(app).get('/api/openapi.json').expect(200);
  assert.equal(body.openapi, '3.1.0');
  assert.ok(body.paths['/generations'].post.requestBody);
  assert.ok(body.paths['/recipes/{id}'].delete);
  assert.ok(body.paths['/tags/extract'].post);
  await request(app).get('/api/docs/').expect(200);
  await request(app).get('/api/v1/no-such-route').expect(404);
});

test('file database retains workspace and sessions after reopening', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'menumind-db-'));
  const config = loadConfig({ DATABASE_PATH: join(dir, 'db.sqlite') });
  let db;
  try {
    let instance = createApp({ config, disableRateLimits: true });
    db = instance.db;
    const actor = await account(instance.app);
    await mutation(actor, 'post', '/recipes', { name: 'Сохранённый суп' }).expect(201);
    db.close();
    db = null;
    instance = createApp({ config, disableRateLimits: true });
    db = instance.db;
    const response = await request(instance.app)
      .get('/api/v1/recipes')
      .set('Cookie', actor.cookie.split(';')[0])
      .expect(200);
    assert.ok(response.body.items.some((r) => r.name === 'Сохранённый суп'));
  } finally {
    db?.close();
    if (!resolve(dir).startsWith(resolve(tmpdir()) + sep + 'menumind-db-'))
      throw new Error('Unsafe cleanup path');
    rmSync(dir, { recursive: true });
  }
});

test('provider prompt uses real facts, selected references and the requested language', () => {
  const profile = defaultProfile('Test');
  profile.settings.samples = ['Тыква. Короткое предложение.', 'Рыба в меню.', 'Тыква и овощи.'];
  const messages = buildMessages(
    { name: 'Тыква', ingredients: ['Тыква'], method: '', category: '' },
    profile,
    'kk',
    'bistro',
    { yandex: 250 },
    null,
  );
  assert.match(messages[0].content, /Kazakh/);
  assert.match(messages[0].content, /ONLY supplied recipe facts/);
  const context = JSON.parse(messages[1].content);
  assert.deepEqual(context.styleExamples, ['Тыква. Короткое предложение.', 'Тыква и овощи.']);
});

for (const [name, fetchImpl, status, code] of [
  [
    'connection failure',
    async () => {
      throw new TypeError('fetch failed');
    },
    502,
    'LLM_UNAVAILABLE',
  ],
  ['upstream unavailable', async () => new Response('{}', { status: 503 }), 502, 'LLM_UNAVAILABLE'],
  [
    'upstream rate limited',
    async () => new Response('{}', { status: 429 }),
    503,
    'LLM_UNAVAILABLE',
  ],
  [
    'timeout',
    async () => {
      throw new DOMException('Timeout', 'TimeoutError');
    },
    504,
    'LLM_TIMEOUT',
  ],
  ['invalid JSON', async () => new Response('not json'), 502, 'LLM_INVALID_OUTPUT'],
  [
    'invalid shape',
    async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{}' } }] }),
    502,
    'LLM_CONSTRAINT_FAILED',
  ],
])
  test(`LLM error: ${name} is meaningful and never silently falls back`, async (t) => {
    const config = loadConfig({
      DATABASE_PATH: ':memory:',
      LLM_PROVIDER: 'openai-compatible',
      LLM_API_KEY: 'test-secret',
      LLM_MODEL: 'test-model',
    });
    const { app } = setup(t, { config, fetchImpl });
    const a = await account(app);
    const result = await mutation(a, 'post', '/generations', { recipe: { name: 'Суп' } }).expect(
      status,
    );
    assert.equal(result.body.error.code, code);
    assert.ok(!JSON.stringify(result.body).includes('test-secret'));
    assert.equal((await a.client.get('/api/v1/generations')).body.items.length, 0);
  });

for (const reasoningEffort of [undefined, 'none'])
  test(`configured provider request and response: reasoning ${reasoningEffort ?? 'omitted'}`, async (t) => {
    const config = loadConfig({
      DATABASE_PATH: ':memory:',
      LLM_PROVIDER: 'openai-compatible',
      LLM_API_KEY: 'test-secret',
      LLM_MODEL: 'test-model',
      LLM_REASONING_EFFORT: reasoningEffort,
    });
    const texts = {
      yandex: 'Асқабақ сорпасы.',
      wolt: 'Асқабақ сорпасы.',
      website: 'Асқабақ сорпасы.',
      print: 'Асқабақ сорпасы.',
    };
    const { app } = setup(t, {
      config,
      fetchImpl: async (url, options) => {
        assert.equal(url, 'https://api.openai.com/v1/chat/completions');
        assert.equal(options.headers.Authorization, 'Bearer test-secret');
        const body = JSON.parse(options.body);
        assert.equal(body.model, 'test-model');
        assert.equal(body.reasoning_effort, reasoningEffort);
        assert.equal(body.response_format.type, 'json_object');
        return Response.json({
          id: 'chatcmpl-verification',
          model: 'test-model-snapshot',
          usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 },
          choices: [
            {
              finish_reason: 'stop',
              message: {
                content: JSON.stringify({ texts, variant: 'Мәзірден: асқабақ сорпасы.' }),
              },
            },
          ],
        });
      },
    });
    const a = await account(app);
    const { body } = await mutation(a, 'post', '/generations', {
      recipe: { name: 'Асқабақ сорпасы' },
      language: 'kk',
    }).expect(201);
    assert.equal(body.provider, 'openai-compatible');
    assert.equal(body.providerResponseId, 'chatcmpl-verification');
    assert.equal(body.providerModel, 'test-model-snapshot');
    assert.equal(body.usage.totalTokens, 140);
    assert.deepEqual(body.limits, { yandex: 250, wolt: 250, website: 250, print: 250 });
    const saved = (await a.client.get(`/api/v1/generations/${body.id}`)).body;
    assert.deepEqual(saved.usage, body.usage);
    assert.deepEqual(body.texts, texts);
  });

for (const [name, text, code] of [
  ['unprovided ingredient', 'Суп с курицей.', 'UNSUPPORTED_FACT'],
  ['advertising claim', 'Лучший суп.', 'LLM_CONSTRAINT_FAILED'],
  ['excess length', 'Суп '.repeat(100), 'LLM_CONSTRAINT_FAILED'],
])
  test(`provider output rejects ${name}`, async (t) => {
    const config = loadConfig({
      DATABASE_PATH: ':memory:',
      LLM_PROVIDER: 'openai-compatible',
      LLM_API_KEY: 'test-key',
      LLM_MODEL: 'test-model',
    });
    const { app } = setup(t, {
      config,
      fetchImpl: async () =>
        Response.json({
          choices: [
            {
              finish_reason: 'stop',
              message: {
                content: JSON.stringify({
                  texts: { yandex: text, wolt: text, website: text, print: text },
                  variant: text,
                }),
              },
            },
          ],
        }),
    });
    const actor = await account(app);
    const response = await mutation(actor, 'post', '/generations', {
      recipe: { name: 'Суп' },
      maxLength: 60,
    }).expect(502);
    assert.equal(response.body.error.code, code);
  });

test('real HTTP provider timeout cancels the request', async (t) => {
  const upstream = createServer((_req, _res) => {
    /* intentionally never sends a response */
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    upstream.closeAllConnections();
    upstream.close();
  });
  const config = loadConfig({
    DATABASE_PATH: ':memory:',
    LLM_PROVIDER: 'openai-compatible',
    LLM_API_KEY: 'test-key',
    LLM_MODEL: 'test-model',
    LLM_BASE_URL: `http://127.0.0.1:${upstream.address().port}/v1`,
    LLM_TIMEOUT_MS: '150',
  });
  const { app } = setup(t, { config });
  const actor = await account(app);
  const start = Date.now();
  const response = await mutation(actor, 'post', '/generations', {
    recipe: { name: 'Суп' },
  }).expect(504);
  assert.equal(response.body.error.code, 'LLM_TIMEOUT');
  assert.ok(Date.now() - start < 2000);
});

test('concurrent idempotency key cannot execute the provider twice', async (t) => {
  let release;
  let entered;
  const enteredPromise = new Promise((resolve) => {
    entered = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const config = loadConfig({
    DATABASE_PATH: ':memory:',
    LLM_PROVIDER: 'openai-compatible',
    LLM_API_KEY: 'test-key',
    LLM_MODEL: 'test-model',
  });
  const { app } = setup(t, {
    config,
    fetchImpl: async () => {
      calls++;
      entered();
      await gate;
      return Response.json({
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: JSON.stringify({
                texts: { yandex: 'Суп.', wolt: 'Суп.', website: 'Суп.', print: 'Суп.' },
                variant: 'В меню: суп.',
              }),
            },
          },
        ],
      });
    },
  });
  const actor = await account(app);
  const first = mutation(actor, 'post', '/generations', { recipe: { name: 'Суп' } })
    .set('Idempotency-Key', 'parallel')
    .then((response) => response);
  await enteredPromise;
  try {
    await mutation(actor, 'post', '/generations', { recipe: { name: 'Суп' } })
      .set('Idempotency-Key', 'parallel')
      .expect(409);
  } finally {
    release();
  }
  assert.equal((await first).status, 201);
  assert.equal(calls, 1);
});
