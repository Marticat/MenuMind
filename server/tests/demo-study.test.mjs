import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { demonstrationDishes } from '../demo-recipes.mjs';
import { runStudy } from '../personalization-study.mjs';
import { generateDescription } from '../generation.mjs';
import { defaultProfile } from '../db.mjs';
import { loadConfig } from '../config.mjs';
import { createApp } from '../app.mjs';
import { tagCatalog } from '../tags.mjs';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

test('every demo dish has three distinct factual template variants in all channels', async () => {
  const ids = new Set();
  const languages = new Set();
  const categories = new Set();
  for (const { recipe, language } of demonstrationDishes) {
    assert.ok(!ids.has(recipe.id));
    ids.add(recipe.id);
    languages.add(language);
    categories.add(recipe.category);
    const results = [];
    for (const style of ['concise', 'ingredients', 'method']) {
      results.push(
        await generateDescription({
          recipe,
          language,
          tone: 'editorial',
          profile: defaultProfile('Demo'),
          config: loadConfig({}).llm,
          descriptionStyle: style,
          fetchImpl: () => {
            throw new Error('No external API calls allowed');
          },
        }),
      );
    }
    for (const channel of ['website', 'yandex', 'wolt', 'print']) {
      const texts = results.map((r) => r.texts[channel]);
      assert.equal(new Set(texts).size, 3, recipe.name);
      for (const text of texts) {
        assert.ok(text.length > 0 && text.length <= 250, recipe.name);
        assert.ok(text.includes(recipe.name), recipe.name);
      }
      assert.ok(texts[2].includes(recipe.method));
      for (const item of recipe.ingredients) assert.ok(texts[1].includes(item));
    }
  }
  assert.deepEqual(languages, new Set(['ru', 'kk']));
  assert.ok(categories.size >= 4);
  assert.equal(ids.size, 12);
});

test('study is reproducible, balances comparisons and has an exact no-effect control', async () => {
  const options = { seeds: [11], steps: 24 };
  const a = await runStudy(options);
  assert.deepEqual(a, await runStudy(options));
  assert.equal(a.dataSource, 'synthetic');
  assert.equal(a.realOrderUpliftEstablished, false);
  for (const guest of a.guests)
    for (const tag of guest.preferredTags)
      assert.ok(
        tagCatalog.some((t) => t.id === tag),
        `Unknown guest tag: ${tag}`,
      );
  const control = a.scenarios.find((s) => s.id === 'no-effect');
  assert.equal(new Set(control.policies.map((p) => p.additions)).size, 1);
  for (const scenario of a.scenarios) {
    for (const policy of scenario.policies) {
      assert.equal(policy.impressions, 24);
      assert.ok(policy.additions <= policy.impressions);
    }
    assert.equal(scenario.events.length, 24);
  }
});

test('demo import is authenticated, idempotent and preserves edited recipes and live models', async (t) => {
  const { app, db } = createApp({
    config: loadConfig({ DATABASE_PATH: ':memory:' }),
    disableRateLimits: true,
  });
  t.after(() => db.close());
  await request(app).post('/api/v1/recipes/demo').send({}).expect(401);
  const client = request.agent(app);
  const reg = await client
    .post('/api/v1/auth/register')
    .send({
      name: 'Chef',
      email: `${randomUUID()}@example.test`,
      password: 'Correct-horse-42',
      restaurantName: 'Demo',
    })
    .expect(201);
  const csrf = reg.body.csrfToken;
  const first = demonstrationDishes[0].recipe;
  await client
    .put(`/api/v1/recipes/${first.id}`)
    .set('X-CSRF-Token', csrf)
    .send({ ...first, name: 'Моё название' })
    .expect(200);
  await client
    .delete(`/api/v1/recipes/${demonstrationDishes[1].recipe.id}`)
    .set('X-CSRF-Token', csrf)
    .expect(200);
  const result = await client
    .post('/api/v1/recipes/demo')
    .set('X-CSRF-Token', csrf)
    .send({})
    .expect(200);
  assert.equal(result.body.added, 1);
  assert.equal(result.body.items.find((r) => r.id === first.id).name, 'Моё название');
  const second = await client
    .post('/api/v1/recipes/demo')
    .set('X-CSRF-Token', csrf)
    .send({})
    .expect(200);
  assert.equal(second.body.added, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bandit_models').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM personalization_decisions').get().n, 0);
});

test('saved report matches event outcomes and current source files', () => {
  const full = JSON.parse(
    readFileSync(
      new URL('../../experiments/personalization-demo/results.json', import.meta.url),
      'utf8',
    ),
  );
  const summary = JSON.parse(
    readFileSync(
      new URL('../../experiments/personalization-demo/summary.json', import.meta.url),
      'utf8',
    ),
  );
  assert.deepEqual(summary, {
    ...full,
    scenarios: full.scenarios.map(({ events, ...scenario }) => scenario),
  });
  for (const [name, hash] of Object.entries(full.sourceHashes)) {
    const actual = createHash('sha256')
      .update(readFileSync(new URL('../' + name, import.meta.url), 'utf8').replace(/\r\n/g, '\n'))
      .digest('hex');
    assert.equal(actual, hash, `Regenerate study after changing ${name}`);
  }
  for (const scenario of full.scenarios) {
    for (const event of scenario.events)
      for (const decision of Object.values(event.decisions)) {
        assert.equal(decision.reward, Number(event.draw < event.probabilities[decision.style]));
      }
    for (const policy of scenario.policies) {
      assert.equal(policy.impressions, scenario.events.length);
      assert.equal(
        policy.additions,
        scenario.events.reduce((sum, event) => sum + event.decisions[policy.id].reward, 0),
      );
    }
  }
});

test('reading synthetic results does not create customer events or train database models', async (t) => {
  const { app, db } = createApp({
    config: loadConfig({ DATABASE_PATH: ':memory:' }),
    disableRateLimits: true,
  });
  t.after(() => db.close());
  await request(app).get('/api/v1/personalization/study').expect(401);
  const client = request.agent(app);
  await client
    .post('/api/v1/auth/register')
    .send({
      name: 'Chef',
      email: `${randomUUID()}@example.test`,
      password: 'Correct-horse-42',
      restaurantName: 'Demo',
    })
    .expect(201);
  const report = await client.get('/api/v1/personalization/study').expect(200);
  assert.equal(report.body.dataSource, 'synthetic');
  assert.equal(report.body.realOrderUpliftEstablished, false);
  assert.equal(report.body.scenarios.length, 3);
  assert.ok(report.body.scenarios.every((s) => !s.events));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM personalization_decisions').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bandit_models').get().n, 0);
});
