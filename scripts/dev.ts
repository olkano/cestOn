import { createServer } from 'vite';
import { generateIcons } from './icons.js';
import { coordinator } from '../apps/server/src/runtime.js';
import { createTestRoot, assertTestRoot, cleanupTestRoot } from '../packages/test-support/src/index.js';
import { fixtureConfig } from './fixture-config.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

await generateIcons();
const apiPort = Number(process.env.CESTON_DEV_API_PORT ?? 4318);
const webPort = Number(process.env.CESTON_DEV_WEB_PORT ?? 4317);
const owned = process.env.CESTON_E2E_ROOT ? null : createTestRoot(); const root = process.env.CESTON_E2E_ROOT ?? owned!.root;
assertTestRoot(root); if (!existsSync(join(root, 'state/config.json'))) fixtureConfig(root);
const runtime = await coordinator(root, { testMode: true, origin: `http://127.0.0.1:${webPort}` });
await runtime.app.listen({ host: '127.0.0.1', port: apiPort });
const web = await createServer({ root: 'apps/web', server: { host: '127.0.0.1', port: webPort, strictPort: true, proxy: { '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false }, '/health': `http://127.0.0.1:${apiPort}` } } });
await web.listen(); web.printUrls();
if (owned) console.log(`Synthetic development installation. Pairing code (10 minutes, one use): ${runtime.auth!.invite()}`);
let closing = false;
async function close() { if (closing) return; closing = true; await web.close(); await runtime.close(); if (owned) cleanupTestRoot(root, owned.runId); }
process.on('SIGINT', () => { void close(); }); process.on('SIGTERM', () => { void close(); });
