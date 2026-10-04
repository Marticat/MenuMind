import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  workers: 2,
  timeout: 45000,
  use: {
    baseURL: 'http://127.0.0.1:5174',
    headless: true,
    launchOptions: existsSync(chrome) ? { executablePath: chrome } : {},
  },
  webServer: [
    {
      command: 'node ../server/tests/e2e-server.mjs',
      url: 'http://127.0.0.1:3002/api/v1/health',
      reuseExistingServer: false,
    },
    {
      command: 'npm run dev -- --port 5174 --strictPort',
      url: 'http://127.0.0.1:5174',
      env: { API_PROXY_TARGET: 'http://127.0.0.1:3002' },
      reuseExistingServer: false,
    },
  ],
});
