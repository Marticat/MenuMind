import { createApp } from '../app.mjs';
import { loadConfig } from '../config.mjs';
import { localModelManifest } from '../local-lora.mjs';
// Browser contract fixture. Real saved weights are checked separately by the live smoke test.
const config = loadConfig({
  DATABASE_PATH: ':memory:',
  PORT: '3004',
  APP_ORIGIN: 'http://127.0.0.1:5175',
  LLM_PROVIDER: 'local-lora',
});
const { app, db } = createApp({
  config,
  disableRateLimits: true,
  fetchImpl: async (_url, request) => {
    const { recipe } = JSON.parse(request.body);
    return Response.json({
      accepted: true,
      description: `${recipe.name}. Состав: ${recipe.ingredients.join(', ')}. Способ приготовления: ${recipe.method}.`,
      model_version: localModelManifest.model_version,
      adapter_sha256: localModelManifest.adapter_sha256,
      base_revision: localModelManifest.base_revision,
      validation_version: 'final-v1',
      validation_errors: [],
      requires_human_review: true,
      device: 'cpu',
    });
  },
});
const server = app.listen(config.port, '127.0.0.1');
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () =>
    server.close(() => {
      db.close();
      process.exit(0);
    }),
  );
