import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import statics from '@fastify/static';
import { z } from 'zod';
import { coordinator } from './runtime.js';
import { startIpcServer } from '../../broker/src/ipc.js';
import { writeOwner } from '../../broker/src/registry.js';
import { installationSecrets } from '../../broker/src/certification.js';
import { DomainError } from '../../../packages/contracts/src/commands.js';

const root = process.argv[2]!; const testMode = process.argv.includes('--test'); const staticRoot = resolve(process.argv[3] ?? 'apps/web/dist');
const runtime = await coordinator(root, { testMode, dispatchFrozen: process.argv.includes('--frozen') }); const config = runtime.config; const secret = installationSecrets(root); const installationId = runtime.store.installation().id;
const release = JSON.parse(readFileSync(join(staticRoot, 'release.json'), 'utf8')) as { protocol: number; staticBundle: string };
if (release.protocol !== 1) throw new DomainError('static_protocol_incompatible');
await runtime.app.register(statics, { root: staticRoot, prefix: '/', wildcard: false, cacheControl: true, maxAge: '1h' });
runtime.app.setNotFoundHandler((request, reply) => { if (request.url.startsWith('/api/')) return reply.code(404).send({ error: { code: 'not_found', message: 'This API route is unavailable.', retryable: false }, meta: { requestId: request.id } }); return reply.header('Cache-Control', 'no-cache').sendFile('index.html'); });
let closing = false;
const control = await startIpcServer({ root, name: 'coordinator', installationId, token: secret.supervisor }, async (method, payload) => {
  if (method === 'status') { z.strictObject({}).parse(payload); return { protocol: 1, release: runtime.store.installation().active_release ?? 'development', schema: runtime.store.installation().schema_version, staticBundle: release.staticBundle, activeRuns: runtime.scheduler.activeCount() }; }
  if (method === 'freeze') { const input = z.strictObject({ frozen: z.boolean() }).parse(payload); runtime.freeze(input.frozen); return { frozen: input.frozen }; }
  if (method === 'shutdown') { z.strictObject({}).parse(payload); setTimeout(() => { void close(); }, 100); return { stopping: true }; }
  throw new DomainError('unsupported_operation', 422);
});
if (process.argv.includes('--frozen')) runtime.freeze(true);
await runtime.app.listen(config.listen);
await writeOwner(root, 'coordinator', installationId, control.endpoint, secret.supervisor); process.send?.({ ready: true, port: config.listen.port });
async function close() { if (closing) return; closing = true; await control.close(); await runtime.close(); if (process.connected) process.disconnect(); }
process.on('message', value => { if ((value as { type?: string })?.type === 'shutdown') void close(); }); process.on('SIGINT', () => { void close(); }); process.on('SIGTERM', () => { void close(); });
