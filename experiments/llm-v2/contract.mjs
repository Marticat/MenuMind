import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
process.env.MENUMIND_EVIDENCE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'results');
await import('../llm/contract.mjs');
