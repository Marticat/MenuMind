import { createApp } from './app.mjs';
import { loadConfig } from './config.mjs';
const config = loadConfig();
const { app, db } = createApp({ config });
const server = app.listen(config.port, config.host, () =>
  console.log(
    `MenuMind: http://${config.host}:${config.port} | API: /api/docs | provider: ${config.llm.provider}`,
  ),
);
server.on('error', (error) => {
  console.error(error.message);
  db.close();
  process.exitCode = 1;
});
for (const signal of ['SIGTERM', 'SIGINT'])
  process.once(signal, () =>
    server.close(() => {
      db.close();
      process.exit(0);
    }),
  );
