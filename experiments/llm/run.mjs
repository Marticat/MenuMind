// Live experiment: every recorded provider call below uses native fetch, never a mock.
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../../server/config.mjs';
import { defaultProfile } from '../../server/db.mjs';
import { recipeSchema } from '../../server/schemas.mjs';
import { generateDescription } from '../../server/generation.mjs';

export const root = dirname(fileURLToPath(import.meta.url));
export const sha = (value) => createHash('sha256').update(value).digest('hex');
export const inputs = JSON.parse(readFileSync(resolve(root, 'inputs.json'), 'utf8'));
export function simpleMessages(detailed) {
  const data = JSON.parse(detailed[1].content);
  return [
    { role: 'system', content: 'Write an attractive restaurant menu description. Return JSON only: {"texts":{"yandex":"...","wolt":"...","website":"...","print":"..."},"variant":"..."}.' },
    { role: 'user', content: JSON.stringify({ recipe: data.recipe, language: data.language,
      tone: data.tone, limits: data.limits, previous: data.previous }) },
  ];
}

// Logs allowlisted request fields and response bodies only: Authorization is never recorded.
export function observer(records, strategy = 'detailed') {
  return async (url, options) => {
    const body = JSON.parse(options.body);
    if (strategy === 'simple') body.messages = simpleMessages(body.messages);
    const record = { endpoint: String(url), startedAt: new Date().toISOString(), request: body,
      promptSha256: sha(JSON.stringify(body.messages)), transport: 'native_fetch_live' };
    records.push(record);
    const start = performance.now();
    try {
      const response = await fetch(url, { ...options, body: JSON.stringify(body) });
      record.httpStatus = response.status;
      record.requestId = response.headers.get('x-request-id');
      record.response = await response.clone().json();
      return response;
    } catch (error) {
      record.transportError = { name: error.name, message: error.message, code: error.cause?.code ?? null };
      throw error;
    } finally { record.durationMs = Math.round(performance.now() - start); }
  };
}

export function fingerprint() {
  const files = ['server/generation.mjs', 'server/tags.mjs', 'server/schemas.mjs',
    'server/db.mjs', 'experiments/llm/run.mjs', 'experiments/llm/inputs.json'];
  return Object.fromEntries(files.map(file => [file, sha(readFileSync(resolve(root, '../..', file)))]));
}

async function main() {
  const phase = process.argv[2];
  if (!['smoke', 'dev', 'final'].includes(phase)) throw new Error('Usage: node experiments/llm/run.mjs smoke|dev|final');
  const config = loadConfig();
  if (config.llm.provider !== 'openai-compatible' || !config.llm.apiKey || !config.llm.model)
    throw new Error('A real configured LLM is required; template mode is forbidden for this experiment.');
  const out = resolve(root, 'results');
  mkdirSync(out, { recursive: true });
  const path = resolve(out, `${phase}.jsonl`);
  if (existsSync(path)) throw new Error(`Refusing to overwrite ${path}; archive previous run explicitly.`);
  if (phase === 'final') {
    const freeze = JSON.parse(readFileSync(resolve(out, 'freeze.json'), 'utf8'));
    if (JSON.stringify(freeze.fingerprints) !== JSON.stringify(fingerprint()))
      throw new Error('Frozen experiment sources changed. Freeze before inspecting final results.');
  }
  const manifest = { runId: randomUUID(), phase, startedAt: new Date().toISOString(),
    provider: config.llm.provider, model: config.llm.model, reasoningEffort: config.llm.reasoningEffort,
    timeoutMs: config.llm.timeoutMs, fingerprints: fingerprint(),
    protocol: 'One attempt per arm; paired prompts; alternating arm order; grouped holdout; no automatic retries; raw rejected responses retained.' };
  writeFileSync(resolve(out, `${phase}-manifest.json`), JSON.stringify(manifest, null, 2));
  let rows = inputs.filter(row => row.split === phase);
  if (phase === 'smoke') rows = [inputs[0]];
  let failures = 0;
  for (const [index, row] of rows.entries()) {
    const strategies = phase === 'smoke' ? ['detailed'] : index % 2 ? ['detailed', 'simple'] : ['simple', 'detailed'];
    for (const strategy of strategies) {
      let previous = null;
      // Regeneration is measured for one complete and one sparse group per split, in both languages.
      const regenGroups = phase === 'dev' ? ['pumpkin', 'caesar'] : ['buckwheat', 'beshbarmak'];
      const rounds = phase !== 'smoke' && strategy === 'detailed' && regenGroups.includes(row.group) ? 2 : 1;
      for (let repetition = 0; repetition < rounds; repetition++) {
        if (repetition && !previous) continue;
        const calls = [];
        const start = performance.now();
        const record = { id: `${row.id}:${strategy}:${repetition}`, runId: manifest.runId,
          phase, input: row, strategy, repetition, previousId: previous?.id ?? null, calls };
        try {
          record.result = await generateDescription({ recipe: recipeSchema.parse(row.recipe),
            profile: defaultProfile('Acceptance study'), language: row.language, tone: row.tone,
            maxLength: row.maxLength, previous, config: config.llm, fetchImpl: observer(calls, strategy) });
          previous = record.result;
          record.accepted = true;
        } catch (error) {
          record.accepted = false;
          record.error = { status: error.status ?? null, code: error.code ?? error.name, message: error.message };
          failures++;
        }
        record.elapsedMs = Math.round(performance.now() - start);
        appendFileSync(path, JSON.stringify(record) + '\n');
        console.log(`${phase} ${record.id}: ${record.accepted ? 'OK' : record.error.code}, ${record.elapsedMs} ms, tokens=${calls[0]?.response?.usage?.total_tokens ?? 'unknown'}`);
        // Authentication/model access failures are global; do not waste a whole corpus.
        if ([401, 403, 404].includes(calls[0]?.httpStatus)) throw new Error('Provider access failed; inspect saved response. Experiment stopped.');
        if (phase === 'smoke' && calls[0]?.transportError) throw new Error('Live transport failed; rerun after resolving network access.');
      }
    }
  }
  manifest.completedAt = new Date().toISOString();
  manifest.rejectedAttempts = failures;
  writeFileSync(resolve(out, `${phase}-manifest.json`), JSON.stringify(manifest, null, 2));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
