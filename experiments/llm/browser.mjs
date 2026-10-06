import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { createApp } from '../../server/app.mjs';
import { loadConfig } from '../../server/config.mjs';
import { root, observer, fingerprint } from './run.mjs';

const out = process.env.MENUMIND_EVIDENCE_DIR ? resolve(process.env.MENUMIND_EVIDENCE_DIR) : resolve(root, 'results');
mkdirSync(out, { recursive: true });
const faultsOnly = process.argv.includes('--faults-only');
const reportPath = resolve(out, faultsOnly ? 'browser-faults.json' : 'browser.json');
if (existsSync(reportPath)) throw new Error('Refusing to overwrite browser evidence.');
const config = loadConfig();
assert.equal(config.llm.provider, 'openai-compatible');
assert.ok(config.llm.apiKey && config.llm.model);
config.databasePath = ':memory:';
config.host = '127.0.0.1';
config.origin = 'http://127.0.0.1:3187';
config.production = false;
const calls = [];
const { app, db } = createApp({ config, fetchImpl: observer(calls), disableRateLimits: true });
const server = app.listen(3187, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const report = { startedAt: new Date().toISOString(), fingerprints: fingerprint(),
  description: 'Real built frontend -> real Express route -> native fetch to configured LLM. Isolated in-memory account. No Playwright route interception.',
  live: [], injectedFaults: [], calls };
let browser, upstream;
try {
  const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  browser = await chromium.launch({ headless: true, ...(existsSync(chrome) ? { executablePath: chrome } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(20000);
  await page.goto(`${config.origin}/#register`);
  await page.getByLabel('Ваше имя').fill('Live verification');
  await page.getByLabel('Название ресторана').fill('Acceptance study');
  await page.getByLabel('Email').fill(`live-${Date.now()}@example.test`);
  await page.getByLabel('Пароль', { exact: true }).fill('Verification-only-password-42');
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await page.getByRole('button', { name: /Выбранное блюдо/ }).click();
  await page.getByLabel('Название блюда', { exact: true }).fill('Суп из тыквы');
  await page.getByLabel('Дополнение к названию').fill('');
  await page.getByRole('textbox', { name: /Ингредиенты/ }).fill('Тыква\nВода\nСоль');
  await page.getByLabel('Метод приготовления').fill('Варка.');
  await page.getByRole('button', { name: 'Сохранить карту' }).click();
  const button = page.getByRole('button', { name: 'Сгенерировать для всех каналов' });
  const waitGeneration = () => page.waitForResponse(r => r.url().endsWith('/api/v1/generations') && r.request().method() === 'POST');
  for (const [index, language] of (faultsOnly ? [] : ['ru', 'ru', 'kk']).entries()) {
    await page.getByLabel('Язык описания', { exact: true }).selectOption(language);
    const pending = waitGeneration();
    const before = calls.length;
    const started = performance.now();
    await button.click();
    const response = await pending;
    const data = await response.json();
    const item = { language, regeneration: index === 1, status: response.status(),
      apiElapsedMs: Math.round(performance.now() - started), request: response.request().postDataJSON(), response: data };
    report.live.push(item);
    assert.equal(response.status(), 201, JSON.stringify(data));
    assert.ok(calls.length > before && calls.length <= before + 2);
    const call = calls.at(-1);
    assert.equal(new URL(call.endpoint).hostname, 'api.openai.com');
    assert.equal(call.httpStatus, 200);
    assert.equal(data.provider, 'openai-compatible');
    assert.equal(data.providerResponseId, call.response.id);
    assert.equal(data.usage.totalTokens, calls.slice(before).reduce((sum, c) => sum + c.response.usage.total_tokens, 0));
    const raw = JSON.parse(call.response.choices[0].message.content);
    for (const channel of ['yandex', 'wolt', 'website', 'print']) {
      assert.equal(data.texts[channel], raw.texts[channel].trim());
      assert.equal(data.limits[channel], 250);
    }
    await page.waitForFunction(text => document.querySelector('.marketplace .editorial-text')?.textContent.includes(text), data.texts.yandex);
    item.visibleText = await page.locator('.marketplace .editorial-text').innerText();
    item.visibleMatchesProvider = item.visibleText.includes(raw.texts.yandex.trim());
    item.renderElapsedMs = Math.round(performance.now() - started);
    assert.ok(item.visibleMatchesProvider);
    if (index === 1) assert.notEqual(data.texts.yandex, report.live[0].response.texts.yandex);
    await page.screenshot({ path: resolve(out, `browser-${index}-${language}.png`), fullPage: true });
    console.log(`Browser ${language}: ${item.renderElapsedMs} ms; native provider response == API == visible text`);
  }
  // Controlled outage tests are separate from live evidence and never return generated text.
  upstream = createServer((_req, res) => { if (config.llm.timeoutMs !== 400) { res.writeHead(503); res.end('{}'); } });
  upstream.listen(0, '127.0.0.1');
  await new Promise(resolve => upstream.once('listening', resolve));
  config.llm.baseUrl = `http://127.0.0.1:${upstream.address().port}/v1`;
  config.llm.apiKey = 'fault-injection-not-a-secret';
  for (const fault of ['http503', 'timeout']) {
    if (fault === 'timeout') config.llm.timeoutMs = 400;
    const generationsBefore = db.prepare('SELECT COUNT(*) AS n FROM generations').get().n;
    const pending = waitGeneration();
    const started = performance.now();
    await button.click();
    const response = await pending;
    const data = await response.json();
    await page.getByRole('status').filter({ hasText: data.error.message }).first().waitFor();
    const item = { fault, injected: true, status: response.status(), response: data,
      elapsedMs: Math.round(performance.now() - started), visibleError: data.error.message,
      generationsBefore, generationsAfter: db.prepare('SELECT COUNT(*) AS n FROM generations').get().n };
    report.injectedFaults.push(item);
    assert.equal(item.status, fault === 'timeout' ? 504 : 502);
    assert.equal(item.generationsBefore, item.generationsAfter);
    assert.ok(item.elapsedMs < 10000);
    console.log(`Injected ${fault}: visible error, no fallback and no new saved generation`);
  }
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = { name: error.name, message: error.message };
  process.exitCode = 1;
  console.error(error.message);
} finally {
  report.completedAt = new Date().toISOString();
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  await browser?.close();
  upstream?.closeAllConnections();
  upstream?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  db.close();
}
