// Explicit live test: build the website and start serve.py before running this script.
// Uses real saved weights, an isolated in-memory database and a temporary account.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { chromium, expect } from '@playwright/test';
import { createApp } from '../server/app.mjs';
import { loadConfig } from '../server/config.mjs';
import { localModelManifest } from '../server/local-lora.mjs';

assert.ok(existsSync('frontend/dist/index.html'), 'Run npm run build first');
const config = loadConfig({ LLM_PROVIDER: 'local-lora', DATABASE_PATH: ':memory:' });
const { app, db } = createApp({ config, disableRateLimits: true });
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const baseURL = `http://127.0.0.1:${server.address().port}`;
config.origin = baseURL;
let browser;
try {
  const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  browser = await chromium.launch({
    headless: true,
    ...(existsSync(chrome) ? { executablePath: chrome } : {}),
  });
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  const reg = await context.request.post('/api/v1/auth/register', {
    data: {
      name: 'Local smoke',
      email: 'smoke@example.test',
      password: 'Smoke-test-password-42',
      restaurantName: 'Local smoke',
    },
  });
  assert.equal(reg.status(), 201);
  await page.goto('/#studio');
  const results = [];
  for (const language of ['ru', 'kk']) {
    const example = JSON.parse(
      readFileSync(`experiments/lora-study/examples/new-${language}.json`, 'utf8'),
    );
    await page.getByRole('button', { name: /Выбранное блюдо/ }).click();
    await page.getByLabel('Название блюда', { exact: true }).fill(example.recipe.name);
    await page.getByLabel('Дополнение к названию').fill('');
    await page
      .getByRole('textbox', { name: /Ингредиенты/ })
      .fill(example.recipe.ingredients.join('\n'));
    await page.getByLabel('Метод приготовления').fill(example.recipe.method);
    await page.getByRole('button', { name: 'Сохранить карту' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByLabel('Язык описания').selectOption(language);
    const pending = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/generations') && response.request().method() === 'POST',
      { timeout: 185000 },
    );
    await page.getByRole('button', { name: /Получить описание LoRA/ }).click();
    const response = await pending;
    const result = await response.json();
    assert.equal(response.status(), 201, JSON.stringify(result));
    assert.equal(result.provider, 'local-lora');
    assert.equal(result.providerModel, localModelManifest.model_version);
    assert.equal(result.localInference.adapterSha256, localModelManifest.adapter_sha256);
    assert.equal(new Set(Object.values(result.texts)).size, 1);
    await expect(page.locator('.marketplace .editorial-text')).toContainText(result.texts.website);
    results.push({
      language,
      model: result.providerModel,
      device: result.localInference.device,
      durationMs: result.durationMs,
      description: result.texts.website,
    });
    console.log(JSON.stringify(results.at(-1)));
  }
  mkdirSync('.cache', { recursive: true });
  writeFileSync('.cache/local-lora-live.json', JSON.stringify(results, null, 2));
  await page.screenshot({ path: '.cache/local-lora-live.png', fullPage: true });
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  db.close();
}
