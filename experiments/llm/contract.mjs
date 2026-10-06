// Additional live API checks, outside the frozen prompt comparison.
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { createApp } from '../../server/app.mjs';
import { loadConfig } from '../../server/config.mjs';
import { root, observer } from './run.mjs';
const path = resolve(process.env.MENUMIND_EVIDENCE_DIR || resolve(root, 'results'), 'contract.json');
assert.ok(!existsSync(path), 'Do not overwrite evidence.');
const config = loadConfig();
assert.equal(config.llm.provider, 'openai-compatible');
config.databasePath = ':memory:';
const calls = [];
const { app, db } = createApp({ config, fetchImpl: observer(calls), disableRateLimits: true });
const actor = request.agent(app);
const registration = await actor.post('/api/v1/auth/register').send({
  name: 'Contract check', restaurantName: 'Acceptance study', email: 'contract@example.test', password: 'Contract-password-42',
});
assert.equal(registration.status, 201);
const report = { checks: [], calls, startedAt: new Date().toISOString() };
try {
  for (const [language, tone, maxLength] of [
    ['ru', 'editorial', 60], ['kk', 'editorial', 60], ['ru', 'bistro', 250], ['ru', 'concierge', 250],
  ]) {
    const body = { recipe: { name: 'Суп из тыквы', ingredients: ['Тыква', 'Вода', 'Соль'], method: 'Варка.' }, language, tone, maxLength };
    const started = performance.now();
    const response = await actor.post('/api/v1/generations')
      .set('X-CSRF-Token', registration.body.csrfToken).send(body);
    const item = { input: body, status: response.status, elapsedMs: Math.round(performance.now() - started), response: response.body };
    report.checks.push(item);
    item.accepted = response.status === 201;
    if (item.accepted) {
      item.allWithinLimit = [...Object.values(response.body.texts), response.body.variant].every(text => text.length <= maxLength);
      assert.ok(item.allWithinLimit);
      assert.equal(response.body.providerResponseId, calls.at(-1).response.id);
    }
    console.log(`${language} ${tone} max=${maxLength}: HTTP ${response.status}, ${item.elapsedMs} ms`);
  }
} finally {
  report.completedAt = new Date().toISOString();
  writeFileSync(path, JSON.stringify(report, null, 2));
  db.close();
}
