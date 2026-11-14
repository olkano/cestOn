import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { Broker } from './runtime.js';
import { startIpcServer } from './ipc.js';
import { installationSecrets } from './certification.js';
import { parseConfig } from '../../../packages/contracts/src/config.js';
import { DomainError } from '../../../packages/contracts/src/commands.js';

const root = process.argv[2]!; const installationId = process.argv[3]!; const testMode = process.argv.includes('--test');
const config = parseConfig(JSON.parse(readFileSync(join(root, 'state', 'config.json'), 'utf8')), { testMode });
const broker = new Broker(root, config, { testMode, fixtureDelayMs: testMode ? 100 : 0 });
const runSchema = z.strictObject({ runId: z.string().min(1).max(100) });
const server = await startIpcServer({ root, name: 'broker', installationId, token: installationSecrets(root).broker }, async (method, payload) => {
  if (method === 'start') return broker.start(payload);
  if (method === 'receipt') return broker.lookup(z.strictObject({ commandId: z.uuid() }).parse(payload).commandId);
  if (method === 'events') { const p = z.strictObject({ runId: z.string().max(100), after: z.number().int().nonnegative() }).parse(payload); return broker.events(p.runId, p.after); }
  if (method === 'reconcile') return broker.reconcile(runSchema.parse(payload).runId);
  if (method === 'interrupt') return broker.interrupt(runSchema.parse(payload).runId);
  if (method === 'steer') { const p = z.strictObject({ runId: z.string().max(100), text: z.string().min(1).max(32768), turnId: z.string().max(100) }).parse(payload); return broker.steer(p.runId, p.text, p.turnId); }
  if (method === 'sessions') { z.strictObject({}).parse(payload); return broker.sessions(); }
  if (method === 'discover') { const p = z.strictObject({ providerId: z.string().max(80), cursor: z.uuid().optional() }).parse(payload); return broker.discover(p.providerId, p.cursor); }
  if (method === 'history') { const p = z.strictObject({ providerId: z.string().max(80), id: z.uuid(), after: z.number().int().nonnegative().default(0) }).parse(payload); return broker.history(p.providerId, p.id, p.after); }
  if (method === 'probe') { z.strictObject({}).parse(payload); return broker.probes(); }
  throw new DomainError('unsupported_capability', 422);
});
process.send?.({ ready: true, endpoint: server.endpoint });
let closing = false;
async function close() { if (closing) return; closing = true; await broker.close(); await server.close(); if (process.connected) process.disconnect(); }
process.on('SIGINT', () => { void close(); }); process.on('SIGTERM', () => { void close(); });
process.on('message', message => { if ((message as { type?: string })?.type === 'shutdown') void close(); });
