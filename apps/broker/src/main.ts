import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { Broker } from './runtime.js';
import { startIpcServer } from './ipc.js';
import { installationSecrets } from './certification.js';
import { parseConfig } from '../../../packages/contracts/src/config.js';
import { DomainError } from '../../../packages/contracts/src/commands.js';
import { writeOwner } from './registry.js';
import { acquireInstance } from './instance.js';

const root = process.argv[2]!; const installationId = process.argv[3]!; const testMode = process.argv.includes('--test');
const config = parseConfig(JSON.parse(readFileSync(join(root, 'state', 'config.json'), 'utf8')), { testMode });
const fixtureDelay = Number(process.argv.find(value => value.startsWith('--fixture-delay='))?.split('=')[1] ?? 100);
if (testMode && (!Number.isInteger(fixtureDelay) || fixtureDelay < 0 || fixtureDelay > 5000)) throw new DomainError('invalid_fixture_delay');
const broker = new Broker(root, config, { testMode, fixtureDelayMs: testMode ? fixtureDelay : 0 });
const instance = await acquireInstance(root, 'broker', installationSecrets(root).broker);
const runSchema = z.strictObject({ runId: z.string().min(1).max(100) });
const server = await startIpcServer({ root, name: 'broker', installationId, token: installationSecrets(root).broker }, async (method, payload) => {
  if (method === 'start') return broker.start(payload);
  if (method === 'workspace') { const p = z.strictObject({ projectId: z.uuid(), taskId: z.uuid(), scopeRevisionId: z.uuid() }).parse(payload); return broker.workspace(p.projectId, p.taskId, p.scopeRevisionId); }
  if (method === 'receipt') return broker.lookup(z.strictObject({ commandId: z.uuid() }).parse(payload).commandId);
  if (method === 'events') { const p = z.strictObject({ runId: z.string().max(100), after: z.number().int().nonnegative() }).parse(payload); return broker.events(p.runId, p.after); }
  if (method === 'reconcile') return broker.reconcile(runSchema.parse(payload).runId);
  if (method === 'interrupt') return broker.interrupt(runSchema.parse(payload).runId);
  if (method === 'steer') { const p = z.strictObject({ runId: z.string().max(100), text: z.string().min(1).max(32768), turnId: z.string().max(100) }).parse(payload); return broker.steer(p.runId, p.text, p.turnId); }
  if (method === 'sessions') { z.strictObject({}).parse(payload); return broker.sessions(); }
  if (method === 'discover') { const p = z.strictObject({ providerId: z.string().max(80), cursor: z.uuid().optional() }).parse(payload); return broker.discover(p.providerId, p.cursor); }
  if (method === 'history') { const p = z.strictObject({ providerId: z.string().max(80), id: z.uuid(), after: z.number().int().nonnegative().default(0) }).parse(payload); return broker.history(p.providerId, p.id, p.after); }
  if (method === 'probe') { z.strictObject({}).parse(payload); return broker.probes(); }
  if (method === 'prune') { z.strictObject({}).parse(payload); return broker.prune(); }
  if (method === 'shutdown') { z.strictObject({}).parse(payload); if (broker.sessions().some(run => !['succeeded','failed','interrupted'].includes(run.state))) throw new DomainError('broker_not_idle'); setTimeout(() => { void close(); }, 100); return { stopping: true }; }
  if (method === 'infer') { const p = z.strictObject({ providerId: z.string().max(80), kind: z.enum(['plan', 'intent']), prompt: z.string().min(1).max(65536).refine(text => Buffer.byteLength(text) <= 65536) }).parse(payload); return broker.infer(p.providerId, p.kind, p.prompt); }
  if (method === 'recipe') { const p = z.strictObject({ runId: z.string().max(100), recipeId: z.string().max(80) }).parse(payload); return broker.recipe(p.runId, p.recipeId); }
  throw new DomainError('unsupported_capability', 422);
});
await writeOwner(root, 'broker', installationId, server.endpoint, installationSecrets(root).broker);
process.send?.({ ready: true, endpoint: server.endpoint });
let closing = false;
async function close() { if (closing) return; closing = true; await broker.close(); await server.close(); await instance.release(); if (process.connected) process.disconnect(); }
process.on('SIGINT', () => { void close(); }); process.on('SIGTERM', () => { void close(); });
process.on('message', message => { if ((message as { type?: string })?.type === 'shutdown') void close(); });
