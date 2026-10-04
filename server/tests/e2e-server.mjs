import { createApp } from '../app.mjs';
import { loadConfig } from '../config.mjs';
const config = loadConfig({
  DATABASE_PATH: ':memory:',
  PORT: '3002',
  APP_ORIGIN: 'http://127.0.0.1:5174',
  LLM_PROVIDER: 'template',
});
const { app, db } = createApp({ config, disableRateLimits: true });
const server = app.listen(config.port, '127.0.0.1');
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () =>
    server.close(() => {
      db.close();
      process.exit(0);
    }),
  );
