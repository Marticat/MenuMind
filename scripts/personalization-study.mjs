import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runStudy } from '../server/personalization-study.mjs';

const destination = new URL('../experiments/personalization-demo/', import.meta.url);
const result = await runStudy();
result.sourceHashNormalization = 'UTF-8 LF';
result.sourceHashes = Object.fromEntries(
  [
    'bandit.mjs',
    'personalization-study.mjs',
    'demo-recipes.mjs',
    'description-tags.mjs',
    'generation.mjs',
    'tags.mjs',
  ].map((name) => [
    name,
    createHash('sha256')
      .update(
        readFileSync(new URL('../server/' + name, import.meta.url), 'utf8').replace(/\r\n/g, '\n'),
      )
      .digest('hex'),
  ]),
);
mkdirSync(destination, { recursive: true });
writeFileSync(new URL('results.json', destination), JSON.stringify(result, null, 2) + '\n');
const summary = {
  ...result,
  scenarios: result.scenarios.map(({ events, ...scenario }) => scenario),
};
writeFileSync(new URL('summary.json', destination), JSON.stringify(summary, null, 2) + '\n');
console.log('Synthetic results saved to', fileURLToPath(destination));
for (const scenario of summary.scenarios)
  console.log(
    scenario.id,
    scenario.policies
      .map((p) => `${p.id}: ${p.additions}/${p.impressions} (${(100 * p.rate).toFixed(1)}%)`)
      .join('; '),
  );
