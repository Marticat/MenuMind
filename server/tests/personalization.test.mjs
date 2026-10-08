import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createApp } from '../app.mjs';
import { loadConfig } from '../config.mjs';
import { initialModel, scoreArm, chooseArm, updateModel, buildContext } from '../bandit.mjs';
import { describeText } from '../description-tags.mjs';
import { extractTags } from '../tags.mjs';
import { REWARD_WINDOW_MS, DECISION_TTL_MS } from '../personalization.mjs';

const recipeId = 'RCP-8843-VEG';

test('description tags reflect the exact RU/KK text and retain evidence from supplied facts', () => {
  const tags = extractTags({ name: 'Блюдо', ingredients: ['Курица', 'Рис'] });
  const short = describeText('Блюдо в меню.', tags, 'concise');
  assert.deepEqual(short.mentioned, []);
  assert.equal(short.short, true);
  const detailed = describeText('Курица с рисом.', tags, 'ingredients');
  assert.deepEqual(
    detailed.mentioned.map((t) => t.id),
    ['chicken', 'rice'],
  );
  assert.equal(detailed.mentioned[0].evidence.field, 'description');
  assert.equal(detailed.mentioned[0].sourceEvidence.field, 'ingredients');
  assert.deepEqual(
    describeText('Тауық және күріш.', tags).mentioned.map((t) => t.id),
    ['chicken', 'rice'],
  );
  assert.deepEqual(describeText('Рыба.', tags).mentioned, []);
  const customer = { preferredTags: ['chicken'], language: 'ru', descriptionPreference: 'auto' };
  const a = buildContext(customer, { tags }, 'website', {}, short);
  const b = buildContext(customer, { tags }, 'website', {}, detailed);
  assert.equal(a.length, b.length);
  assert.notDeepEqual(a, b);
  assert.ok(Math.abs(Math.hypot(...b) - 1) < 1e-12);
});

test('LinUCB evaluates and learns the actual per-variant context', () => {
  const contexts = { concise: [0, 1], ingredients: [1, 0] };
  const learned = updateModel(initialModel(2), [1, 0], 1);
  const choice = chooseArm(
    { concise: learned, ingredients: learned },
    contexts,
    ['concise', 'ingredients'],
    'auto',
    0,
  );
  assert.equal(choice.arm, 'ingredients');
});
async function account(app, email = `${randomUUID()}@example.test`) {
  const client = request.agent(app);
  const response = await client
    .post('/api/v1/auth/register')
    .send({
      name: 'Chef',
      email,
      password: 'Correct-horse-42',
      restaurantName: 'Ресторан',
    })
    .expect(201);
  return {
    client,
    csrf: response.body.csrfToken,
    id: response.body.user.id,
    cookie: response.headers['set-cookie'][0].split(';')[0],
  };
}
const mutate = (actor, method, path, body) =>
  actor.client[method](`/api/v1${path}`).set('X-CSRF-Token', actor.csrf).send(body);
async function setup(t, options = {}) {
  let clock = Date.now();
  const config = loadConfig({ DATABASE_PATH: ':memory:' });
  const instance = createApp({ config, disableRateLimits: true, now: () => clock, ...options });
  t.after(() => instance.db.close());
  const actor = await account(instance.app);
  return {
    ...instance,
    actor,
    advance: (ms) => {
      clock += ms;
    },
  };
}
const saveCustomer = (actor, id = 'guest', descriptionPreference = 'concise', extra = {}) =>
  mutate(actor, 'put', `/customers/${id}`, { name: id, descriptionPreference, ...extra }).expect(
    200,
  );
const prepare = (actor, extra = {}) =>
  mutate(actor, 'post', '/description-sets', { recipeId, ...extra }).expect(200);
const select = (actor, extra = {}) =>
  mutate(actor, 'post', '/personalizations', {
    requestId: randomUUID(),
    customerId: 'guest',
    recipeId,
    ...extra,
  });
const show = (actor, id) => mutate(actor, 'post', `/personalizations/${id}/impression`, {});
const reward = (actor, id) =>
  mutate(actor, 'post', `/personalizations/${id}/feedback`, { event: 'add_to_cart' });

test('LinUCB matches analytical ridge estimates and reduces uncertainty in observed directions', () => {
  const initial = initialModel(2);
  assert.deepEqual(scoreArm(initial, [1, 0], 0.5), { estimate: 0, uncertainty: 1, score: 0.5 });
  const updated = updateModel(initial, [1, 0], 1);
  const score = scoreArm(updated, [1, 0], 0.5);
  assert.ok(Math.abs(score.estimate - 0.5) < 1e-12);
  assert.ok(Math.abs(score.uncertainty - Math.sqrt(0.5)) < 1e-12);
  assert.equal(scoreArm(updated, [0, 1]).uncertainty, 1);
  assert.deepEqual(initial.b, [0, 0]);
  const zero = updateModel(initial, [1, 0], 0);
  assert.equal(scoreArm(zero, [1, 0]).estimate, 0);
  assert.ok(scoreArm(zero, [1, 0]).uncertainty < 1);
});

test('online LinUCB learns opposite rewards for two guest contexts and explores both arms', () => {
  const models = { concise: initialModel(2), ingredients: initialModel(2) };
  const choices = new Set();
  for (let step = 0; step < 300; step++) {
    const context = step % 2 ? [1, 0] : [0, 1];
    const expected = step % 2 ? 'concise' : 'ingredients';
    const choice = chooseArm(models, context, Object.keys(models), 'auto', 2);
    choices.add(`${step % 2}:${choice.arm}`);
    models[choice.arm] = updateModel(models[choice.arm], context, Number(choice.arm === expected));
  }
  assert.equal(choices.size, 4);
  assert.equal(chooseArm(models, [1, 0], Object.keys(models)).arm, 'concise');
  assert.equal(chooseArm(models, [0, 1], Object.keys(models)).arm, 'ingredients');
});

test('guest preferences choose descriptions for the same dish; templates and feature snapshots stay factual', async (t) => {
  const { actor, db } = await setup(t);
  await saveCustomer(actor, 'short', 'concise', { preferredTags: ['mushrooms'] });
  await saveCustomer(actor, 'detail', 'ingredients');
  const set = (await prepare(actor)).body;
  assert.equal(set.variants.length, 3);
  assert.equal(set.variants[0].texts.website, 'Ризотто с лесными грибами с пармезаном.');
  assert.match(set.variants[1].texts.website, /В составе: Рис карнароли/);
  assert.match(set.variants[2].texts.website, /^Постепенное введение/);
  const a = (await select(actor, { customerId: 'short' }).expect(200)).body;
  const b = (await select(actor, { customerId: 'detail' }).expect(200)).body;
  assert.equal(a.style, 'concise');
  assert.equal(b.style, 'ingredients');
  assert.notEqual(a.text, b.text);
  assert.equal(a.algorithm, 'LinUCB');
  assert.equal(a.descriptionTags.charLength, a.text.length);
  assert.deepEqual(a.descriptionTags, set.variants[0].descriptionTags.website);
  assert.equal(a.shownAt, null);
  const contexts = db.prepare('SELECT context FROM personalization_decisions ORDER BY rowid').all();
  assert.notEqual(contexts[0].context, contexts[1].context);
  assert.ok(Math.abs(Math.hypot(...JSON.parse(contexts[0].context)) - 1) < 1e-12);
  assert.equal((await prepare(actor)).body.id, set.id);
});

test('editing a description recomputes text tags instead of retaining stale mentions', async (t) => {
  const { actor } = await setup(t);
  const generated = (
    await mutate(actor, 'post', '/generations', {
      recipe: { name: 'Обед', ingredients: ['Курица', 'Рис'] },
    }).expect(201)
  ).body;
  assert.ok(generated.descriptionTags.website.mentioned.some((tag) => tag.id === 'chicken'));
  const texts = Object.fromEntries(
    ['yandex', 'wolt', 'website', 'print'].map((channel) => [channel, 'Обед в меню.']),
  );
  const edited = (
    await mutate(actor, 'patch', `/generations/${generated.id}`, {
      texts,
      variant: 'Сегодня в меню: обед.',
    }).expect(200)
  ).body;
  assert.deepEqual(edited.descriptionTags.website.mentioned, []);
  assert.deepEqual(edited.variantTags.mentioned, []);
});

test('impressions and feedback are idempotent, train only the selected arm and retain decision-time context', async (t) => {
  const { actor, db } = await setup(t);
  await saveCustomer(actor);
  await prepare(actor);
  const requestId = randomUUID();
  const selection = (await select(actor, { requestId }).expect(200)).body;
  assert.equal((await select(actor, { requestId })).body.id, selection.id);
  await select(actor, { requestId, channel: 'print' }).expect(409);
  await reward(actor, selection.id).expect(409);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bandit_models').get().n, 0);
  const shown = (await show(actor, selection.id).expect(200)).body;
  assert.equal((await show(actor, selection.id)).body.feedbackDeadline, shown.feedbackDeadline);
  const snapshot = db
    .prepare('SELECT context FROM personalization_decisions WHERE id = ?')
    .get(selection.id).context;
  await saveCustomer(actor, 'guest', 'method', { preferredTags: ['beef'] });
  const first = await reward(actor, selection.id).expect(200);
  assert.equal(first.body.reward, 1);
  assert.equal(first.body.duplicate, false);
  const duplicate = await reward(actor, selection.id).expect(200);
  assert.equal(duplicate.body.duplicate, true);
  const rows = db.prepare('SELECT arm, data FROM bandit_models').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].arm, selection.style);
  const model = JSON.parse(rows[0].data);
  assert.equal(model.observations, 1);
  assert.deepEqual(model.b, JSON.parse(snapshot));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM personalization_decisions').get().n, 1);
  const next = (await select(actor).expect(200)).body;
  assert.equal(next.observations, 1);
  assert.equal(next.style, selection.style);
});

test('only confirmed impressions expire to zero; delayed positives and late impressions are rejected', async (t) => {
  const { actor, db, advance } = await setup(t);
  await saveCustomer(actor);
  await prepare(actor);
  const shown = (await select(actor).expect(200)).body;
  const unseen = (await select(actor).expect(200)).body;
  await show(actor, shown.id).expect(200);
  advance(REWARD_WINDOW_MS - 1);
  assert.equal(
    (await actor.client.get('/api/v1/personalization/stats')).body.items[0].observations,
    0,
  );
  advance(1);
  await reward(actor, shown.id).expect(409);
  const stats = (await actor.client.get('/api/v1/personalization/stats')).body.items[0];
  assert.equal(stats.decisions, 2);
  assert.equal(stats.impressions, 1);
  assert.equal(stats.observations, 1);
  assert.equal(stats.additions, 0);
  assert.equal(stats.pending, 0);
  await show(actor, unseen.id).expect(409);
  assert.equal(
    db.prepare('SELECT reward FROM personalization_decisions WHERE id = ?').get(unseen.id).reward,
    null,
  );
  assert.equal(JSON.parse(db.prepare('SELECT data FROM bandit_models').get().data).observations, 1);
  const next = (await select(actor).expect(200)).body;
  assert.notEqual(next.style, shown.style);
});

test('restaurants, API keys, demo learning and live learning are isolated', async (t) => {
  const { app, actor, db } = await setup(t);
  const other = await account(app);
  await saveCustomer(actor);
  await prepare(actor);
  const selection = (await select(actor, { mode: 'demo' }).expect(200)).body;
  await other.client.get('/api/v1/customers/guest').expect(404);
  assert.deepEqual((await other.client.get('/api/v1/customers')).body.items, []);
  await show(other, selection.id).expect(404);
  await reward(other, selection.id).expect(404);
  await select(other).expect(404);
  await actor.client.post('/api/v1/personalizations').send({}).expect(403);
  await request(app).get('/api/v1/customers').expect(401);
  await saveCustomer(other, 'guest', 'method');
  assert.equal(
    (await actor.client.get('/api/v1/customers/guest')).body.descriptionPreference,
    'concise',
  );
  await show(actor, selection.id).expect(200);
  await reward(actor, selection.id).expect(200);
  assert.equal(db.prepare('SELECT mode FROM bandit_models').get().mode, 'demo');
  const live = (await select(actor).expect(200)).body;
  assert.equal(live.observations, 0);
  assert.equal(live.style, 'concise');
  const key = (await mutate(actor, 'post', '/api-keys', { name: 'Integration' }).expect(201)).body
    .token;
  await request(app)
    .put('/api/v1/customers/from-api')
    .set('Authorization', `Bearer ${key}`)
    .send({ name: 'API guest', descriptionPreference: 'ingredients' })
    .expect(200);
  const external = await request(app)
    .post('/api/v1/personalizations')
    .set('Authorization', `Bearer ${key}`)
    .send({ requestId: randomUUID(), customerId: 'from-api', recipeId })
    .expect(200);
  assert.equal(external.body.style, 'ingredients');
});

test('changed recipes and brand settings invalidate cached variants and unshown decisions', async (t) => {
  const { actor } = await setup(t);
  await saveCustomer(actor);
  await select(actor).expect(409);
  const set = (await prepare(actor)).body;
  const decision = (await select(actor).expect(200)).body;
  const recipe = (await actor.client.get(`/api/v1/recipes/${recipeId}`)).body;
  await mutate(actor, 'put', `/recipes/${recipeId}`, { ...recipe, name: 'Ризотто' }).expect(200);
  await show(actor, decision.id).expect(409);
  await select(actor).expect(409);
  const updated = (await prepare(actor)).body;
  assert.notEqual(updated.id, set.id);
  const profile = (await actor.client.get('/api/v1/profile')).body;
  await mutate(actor, 'put', '/settings', {
    ...profile.settings,
    limits: { ...profile.settings.limits, website: 100 },
  }).expect(200);
  await select(actor).expect(409);
  const resized = (await prepare(actor)).body;
  assert.notEqual(resized.id, updated.id);
  assert.ok(resized.variants.every((variant) => variant.texts.website.length <= 100));
});

test('language and available facts control the variant set; invalid fields do not enter the learner', async (t) => {
  const { actor, advance } = await setup(t);
  await mutate(actor, 'put', '/customers/bad', {
    name: 'Test',
    preferredTags: ['invented'],
  }).expect(422);
  await mutate(actor, 'put', '/customers/bad', {
    name: 'Test',
    descriptionPreference: 'invented',
  }).expect(422);
  await saveCustomer(actor, 'guest', 'method', { language: 'kk' });
  const recipe = (await mutate(actor, 'post', '/recipes', { name: 'Сорпа' }).expect(201)).body;
  const set = (await prepare(actor, { recipeId: recipe.id, language: 'kk' })).body;
  assert.deepEqual(
    set.variants.map((variant) => variant.style),
    ['concise'],
  );
  assert.equal(set.variants[0].texts.website, 'Сорпа.');
  const selected = (await select(actor, { recipeId: recipe.id }).expect(200)).body;
  assert.equal(selected.style, 'concise');
  assert.equal(selected.language, 'kk');
  advance(DECISION_TTL_MS);
  await show(actor, selected.id).expect(409);
  await select(actor, { mode: 'invalid' }).expect(422);
  await select(actor, { requestId: 'bad' }).expect(422);
  await mutate(actor, 'post', `/personalizations/${selected.id}/feedback`, {
    event: 'click',
    reward: 1,
  }).expect(422);
});

test('LLM receives the requested style without guest data, concurrent preparation is cached, duplicate texts are collapsed', async (t) => {
  const config = loadConfig({
    DATABASE_PATH: ':memory:',
    LLM_PROVIDER: 'openai-compatible',
    LLM_API_KEY: 'fake',
    LLM_MODEL: 'test',
  });
  const prompts = [];
  const { actor, db } = await setup(t, {
    config,
    fetchImpl: async (_url, options) => {
      const input = JSON.parse(options.body);
      const payload = JSON.parse(input.messages[1].content);
      prompts.push(payload);
      assert.match(input.messages[0].content, /descriptionStyle/);
      const text = 'Рис с грибами.';
      return Response.json({
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
      });
    },
  });
  await saveCustomer(actor, 'private-guest');
  const sets = await Promise.all([prepare(actor), prepare(actor)]);
  assert.equal(sets[0].body.id, sets[1].body.id);
  assert.equal(prompts.length, 3);
  assert.equal(new Set(prompts.map((prompt) => prompt.descriptionStyle.label)).size, 3);
  assert.ok(!JSON.stringify(prompts).includes('private-guest'));
  const selection = (await select(actor, { customerId: 'private-guest' }).expect(200)).body;
  assert.equal(selection.scores.length, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM description_sets').get().n, 1);
});

test('failed variant generation stores no partial set or decision', async (t) => {
  const config = loadConfig({
    DATABASE_PATH: ':memory:',
    LLM_PROVIDER: 'openai-compatible',
    LLM_API_KEY: 'fake',
    LLM_MODEL: 'test',
  });
  const { actor, db } = await setup(t, {
    config,
    fetchImpl: async () => new Response('{}', { status: 503 }),
  });
  await saveCustomer(actor);
  await mutate(actor, 'post', '/description-sets', { recipeId }).expect(502);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM description_sets').get().n, 0);
  await select(actor).expect(409);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM personalization_decisions').get().n, 0);
});

test('guest, variants, pending shows, models and retry deduplication survive database reopening', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'menumind-personalization-'));
  const config = loadConfig({ DATABASE_PATH: join(dir, 'db.sqlite') });
  let db;
  try {
    let instance = createApp({ config, disableRateLimits: true });
    db = instance.db;
    const actor = await account(instance.app);
    await saveCustomer(actor);
    const set = (await prepare(actor)).body;
    const selected = (await select(actor).expect(200)).body;
    await show(actor, selected.id).expect(200);
    await reward(actor, selected.id).expect(200);
    const pending = (await select(actor).expect(200)).body;
    await show(actor, pending.id).expect(200);
    db.close();
    db = null;
    instance = createApp({ config, disableRateLimits: true });
    db = instance.db;
    await request(instance.app)
      .get('/api/v1/customers/guest')
      .set('Cookie', actor.cookie)
      .expect(200);
    assert.equal(JSON.parse(db.prepare('SELECT data FROM description_sets').get().data).id, set.id);
    assert.equal(
      JSON.parse(db.prepare('SELECT data FROM bandit_models').get().data).observations,
      1,
    );
    assert.equal(
      db.prepare('SELECT reward FROM personalization_decisions WHERE id = ?').get(pending.id)
        .reward,
      null,
    );
    const response = await request(instance.app)
      .post(`/api/v1/personalizations/${selected.id}/feedback`)
      .set('Cookie', actor.cookie)
      .set('X-CSRF-Token', actor.csrf)
      .send({ event: 'add_to_cart' })
      .expect(200);
    assert.equal(response.body.duplicate, true);
    assert.equal(
      JSON.parse(db.prepare('SELECT data FROM bandit_models').get().data).observations,
      1,
    );
  } finally {
    db?.close();
    if (!resolve(dir).startsWith(resolve(tmpdir()) + sep + 'menumind-personalization-'))
      throw new Error('Unsafe cleanup path');
    rmSync(dir, { recursive: true });
  }
});
