import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import { loadConfig } from '../config.mjs';
import { generateDescription } from '../generation.mjs';
import { defaultProfile } from '../db.mjs';
import { createApp } from '../app.mjs';

const manifest = JSON.parse(
  readFileSync(new URL('../../experiments/lora-study/final_model.json', import.meta.url)),
);
const recipe = {
  id: 'local-test',
  name: 'Индейка с булгуром',
  ingredients: ['индейка', 'булгур', 'морковь'],
  method: 'тушение',
};
const description =
  'Индейка с булгуром. Состав: индейка, булгур, морковь. Способ приготовления: тушение.';
const accepted = (overrides = {}) => ({
  accepted: true,
  description,
  model_version: manifest.model_version,
  adapter_sha256: manifest.adapter_sha256,
  base_revision: manifest.base_revision,
  validation_version: 'final-v1',
  validation_errors: [],
  requires_human_review: true,
  input_tokens: 120,
  generated_tokens: 40,
  device: 'cpu',
  ...overrides,
});
const localConfig = () =>
  loadConfig({
    LLM_PROVIDER: 'local-lora',
    LLM_API_KEY: 'do-not-send',
    LLM_BASE_URL: 'https://api.openai.com/v1',
  });
const options = (fetchImpl, extra = {}) => ({
  recipe,
  profile: defaultProfile('Test'),
  tone: 'editorial',
  language: 'ru',
  config: localConfig().llm,
  fetchImpl,
  ...extra,
});

test('local configuration ignores paid credentials, pins saved model and allows only loopback', () => {
  const config = localConfig().llm;
  assert.equal(config.provider, 'local-lora');
  assert.equal(config.baseUrl, 'http://127.0.0.1:8008');
  assert.equal(config.apiKey, '');
  assert.equal(config.model, manifest.model_version);
  assert.equal(config.timeoutMs, 120000);
  for (const url of [
    'https://api.example.com',
    'http://127.0.0.1:8008/path',
    'http://user:pass@localhost:8008',
    'http://localhost:8008/?q=x',
  ])
    assert.throws(() => loadConfig({ LLM_PROVIDER: 'local-lora', LOCAL_LORA_URL: url }));
  assert.throws(() => loadConfig({ LLM_PROVIDER: 'local-lora', LOCAL_LORA_TIMEOUT_MS: '200000' }));
});

test('local provider sends only the supported recipe contract and preserves the real output', async () => {
  let calls = 0;
  const result = await generateDescription(
    options(async (url, req) => {
      calls++;
      assert.equal(url, 'http://127.0.0.1:8008/generate');
      assert.equal(req.redirect, 'error');
      assert.equal(req.headers.Authorization, undefined);
      assert.deepEqual(JSON.parse(req.body), {
        language: 'ru',
        recipe: { name: recipe.name, ingredients: recipe.ingredients, method: recipe.method },
        channel: 'website',
        tone: 'neutral',
        maxLength: 250,
      });
      return Response.json(accepted());
    }),
  );
  assert.equal(calls, 1);
  assert.deepEqual(Object.values(result.texts), Array(4).fill(description));
  assert.equal(result.variant, description);
  assert.equal(result.provider, 'local-lora');
  assert.equal(result.providerModel, manifest.model_version);
  assert.equal(result.localInference.channelMode, 'shared');
  assert.equal(result.localInference.adapterSha256, manifest.adapter_sha256);
  assert.deepEqual(result.referencesUsed, []);
  assert.equal(result.requiresReview, true);
});

test('missing facts and unsupported tones are rejected before calling the model', async () => {
  const unexpected = () => {
    throw new Error('should not call model');
  };
  for (const incomplete of [
    { ...recipe, method: '' },
    { ...recipe, ingredients: [] },
  ])
    await assert.rejects(generateDescription(options(unexpected, { recipe: incomplete })), {
      code: 'LORA_INPUT_INVALID',
    });
  await assert.rejects(generateDescription(options(unexpected, { tone: 'bistro' })), {
    code: 'LORA_UNSUPPORTED_STYLE',
  });
});

test('accepted local descriptions are preserved byte-for-byte including surrounding spaces', async () => {
  const original = `  ${description}  `;
  const result = await generateDescription(
    options(async () => Response.json(accepted({ description: original }))),
  );
  assert.deepEqual(Object.values(result.texts), Array(4).fill(original));
  assert.equal(result.variant, original);
});

test('local failures never trigger a paid fallback or a repair request', async () => {
  for (const [status, payload, code] of [
    [422, accepted({ accepted: false, description: null }), 'LORA_REJECTED'],
    [503, { error: 'busy' }, 'LORA_BUSY'],
    [400, { error: 'too long' }, 'LORA_INPUT_INVALID'],
    [200, accepted({ model_version: 'other-model' }), 'LORA_MODEL_MISMATCH'],
    [200, accepted({ description: '' }), 'LORA_INVALID_OUTPUT'],
  ]) {
    let calls = 0;
    await assert.rejects(
      generateDescription(
        options(async () => {
          calls++;
          return Response.json(payload, { status });
        }),
      ),
      { code },
    );
    assert.equal(calls, 1);
  }
  await assert.rejects(
    generateDescription(
      options(async () => {
        throw new TypeError('fetch failed');
      }),
    ),
    { code: 'LORA_UNAVAILABLE' },
  );
  await assert.rejects(
    generateDescription(
      options(async () => {
        throw new DOMException('timeout', 'TimeoutError');
      }),
    ),
    { code: 'LORA_TIMEOUT' },
  );
});

test('local output respects every channel limit without truncation and repeated output is explained', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return Response.json(accepted());
  };
  await assert.rejects(generateDescription(options(fetchImpl, { maxLength: 50 })), {
    code: 'LORA_LENGTH_LIMIT',
  });
  assert.equal(calls, 1);
  const previous = await generateDescription(options(fetchImpl));
  await assert.rejects(
    generateDescription(
      options(fetchImpl, {
        previous,
      }),
    ),
    { code: 'LORA_DETERMINISTIC' },
  );
  assert.equal(calls, 3);
});

test('website API persists local model provenance and prepares a single honest personalization option', async (t) => {
  let calls = 0;
  const config = localConfig();
  config.databasePath = ':memory:';
  const { app, db } = createApp({
    config,
    disableRateLimits: true,
    fetchImpl: async () => {
      calls++;
      return Response.json(accepted());
    },
  });
  t.after(() => db.close());
  const client = request.agent(app);
  const registered = await client
    .post('/api/v1/auth/register')
    .send({
      name: 'Chef',
      email: 'local@example.test',
      password: 'Correct-horse-42',
      restaurantName: 'Local',
    })
    .expect(201);
  const csrf = registered.body.csrfToken;
  const profile = (await client.get('/api/v1/profile')).body;
  await client
    .put('/api/v1/profile')
    .set('X-CSRF-Token', csrf)
    .send({ ...profile, tone: 'bistro' })
    .expect(200);
  await client.post('/api/v1/recipes').set('X-CSRF-Token', csrf).send(recipe).expect(201);
  const generated = await client
    .post('/api/v1/generations')
    .set('X-CSRF-Token', csrf)
    .send({ recipeId: recipe.id, language: 'ru' })
    .expect(201);
  assert.equal(generated.body.providerModel, manifest.model_version);
  assert.equal(generated.body.texts.website, description);
  const path = '/api/v1/description-sets';
  const prepared = await client
    .post(path)
    .set('X-CSRF-Token', csrf)
    .send({ recipeId: recipe.id, language: 'ru' })
    .expect(200);
  assert.equal(prepared.body.variants.length, 1);
  assert.equal(prepared.body.variants[0].label, 'Нейтральное описание · LoRA');
  assert.equal(prepared.body.variants[0].localInference.modelVersion, manifest.model_version);
  assert.equal(calls, 2);
  await client
    .post(path)
    .set('X-CSRF-Token', csrf)
    .send({ recipeId: recipe.id, language: 'ru' })
    .expect(200);
  assert.equal(calls, 2);
});

test('local text can refresh changed recipe metadata without becoming permanently stale', async () => {
  const fetchImpl = async () => Response.json(accepted());
  const first = await generateDescription(
    options(fetchImpl, { recipe: { ...recipe, price: 1000 } }),
  );
  const updated = await generateDescription(
    options(fetchImpl, { recipe: { ...recipe, price: 2000 }, previous: first }),
  );
  assert.equal(updated.price, 2000);
  assert.equal(updated.texts.website, description);
  assert.notEqual(updated.sourceFingerprint, first.sourceFingerprint);
});
