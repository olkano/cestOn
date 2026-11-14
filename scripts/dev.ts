import { createServer } from 'vite';
import { generateIcons } from './icons.js';
import { createApp } from '../apps/server/src/create-app.js';

await generateIcons();
const { app } = await createApp();
const apiPort = Number(process.env.CESTON_DEV_API_PORT ?? 4318);
await app.listen({ host: '127.0.0.1', port: apiPort });
const web = await createServer({ root: 'apps/web', server: { host: '127.0.0.1', port: Number(process.env.CESTON_DEV_WEB_PORT ?? 4317), strictPort: true, proxy: { '/api': `http://127.0.0.1:${apiPort}`, '/health': `http://127.0.0.1:${apiPort}` } } });
await web.listen(); web.printUrls();
let closing = false;
async function close() { if (closing) return; closing = true; await web.close(); await app.close(); }
process.on('SIGINT', () => { void close(); }); process.on('SIGTERM', () => { void close(); });
