import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
export default defineConfig({
  testDir: './local-tests',
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: 'http://127.0.0.1:5175',
    headless: true,
    launchOptions: existsSync(chrome) ? { executablePath: chrome } : {},
  },
  webServer: [
    {
      command: 'node ../server/tests/local-e2e-server.mjs',
      url: 'http://127.0.0.1:3004/api/v1/health',
      reuseExistingServer: false,
    },
    {
      command: 'npm run dev -- --port 5175 --strictPort',
      url: 'http://127.0.0.1:5175',
      env: { API_PROXY_TARGET: 'http://127.0.0.1:3004' },
      reuseExistingServer: false,
    },
  ],
});
