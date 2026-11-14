import { defineConfig } from '@playwright/test';
import { createServer } from 'node:net';

async function port() { const server = createServer(); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('Port allocation failed'); const value = address.port; await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); return value; }
const webPort = Number(process.env.CESTON_E2E_WEB_PORT ?? await port()); const apiPort = Number(process.env.CESTON_E2E_API_PORT ?? await port());
process.env.CESTON_E2E_WEB_PORT = String(webPort); process.env.CESTON_E2E_API_PORT = String(apiPort);

export default defineConfig({ testDir: 'tests/e2e', fullyParallel: false, workers: 1, timeout: 30000,
  use: { baseURL: `http://127.0.0.1:${webPort}`, headless: true, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'npm run dev', url: `http://127.0.0.1:${webPort}`, reuseExistingServer: false, timeout: process.env.CI ? 90000 : 30000, env: { CESTON_DEV_WEB_PORT: String(webPort), CESTON_DEV_API_PORT: String(apiPort) }, gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 } },
  projects: [{ name: 'chromium', use: { browserName: 'chromium', launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] } } }],
});
