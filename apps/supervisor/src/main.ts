import { z } from 'zod';
import { startIpcServer } from '../../broker/src/ipc.js';
import { writeOwner, readOwner } from '../../broker/src/registry.js';
import { dataAccess } from '../../server/src/security/access.js';
import { DomainError } from '../../../packages/contracts/src/commands.js';
import { installation, localStatus } from './operations.js';
import { Supervisor } from './activation.js';
import { ProcessHost } from './host.js';
import { RotatingLog } from './logs.js';
import { Store } from '../../server/src/db/store.js';
import { retention } from './retention.js';
import { acquireInstance } from '../../broker/src/instance.js';
import { ImprovementService } from '../../server/src/updates/service.js';
import { ImprovementEngine } from './improvement.js';
import { NativeUpdateWorker } from './update-worker.js';
import { CandidateTools } from './candidate-tools.js';
import { FixtureImprovementWorker } from '../../../packages/test-support/src/improvement-worker.js';
const root = process.argv[2]!; const testMode = process.argv.includes('--test'); await dataAccess(root); const current = installation(root, testMode);
const fixtureImprovement = process.argv.includes('--fixture-improvement'); if (fixtureImprovement && !testMode) throw new DomainError('fixture_improvement_denied');
if (await readOwner(root, 'supervisor', current.id, current.key)) throw new DomainError('supervisor_already_running');
const instance = await acquireInstance(root, 'supervisor', current.key);
const host = new ProcessHost(root, current.id, current.config, testMode); const supervisor = new Supervisor(root, current.key, host, { testMode });
const updateStore = new Store(root, { testMode }); const improvements = new ImprovementService(updateStore); const engine = new ImprovementEngine(improvements, supervisor, current.config, fixtureImprovement ? new FixtureImprovementWorker(root) : new NativeUpdateWorker(root, current.config), new CandidateTools(root, current.config, testMode)); const updateTimer = setInterval(() => { void engine.tick().catch(() => log.write({ operation: 'improvement.tick', result: 'blocked' })); }, 1000);
let stopping = false;
const log = new RotatingLog(root, 'supervisor'); let pruning = false; const prune = async () => { if (pruning) return; pruning = true; const store = new Store(root, { testMode }); try { retention(store, false); await (await host.connectBroker()).prune(); log.write({ operation: 'retention', result: 'pass' }); } catch { log.write({ operation: 'retention', result: 'blocked' }); } finally { store.close(); pruning = false; } }; const timer = setInterval(() => { void prune(); }, 86400000);
const server = await startIpcServer({ root, name: 'supervisor', installationId: current.id, token: current.key }, async (method, payload) => {
  if (method === 'status') { z.strictObject({}).parse(payload); return { ...await localStatus(root, testMode, false), activeRuns: await host.activeRuns() }; }
  if (method === 'stage') { const p = z.strictObject({ updateId: z.uuid(), bundle: z.string().min(1).max(2048), requestHash: z.string().regex(/^[a-f0-9]{64}$/) }).parse(payload); return supervisor.stage(p.updateId, p.bundle, p.requestHash); }
  if (method === 'activate') { const p = z.strictObject({ updateId: z.uuid(), requestHash: z.string().regex(/^[a-f0-9]{64}$/) }).parse(payload); if (!current.config.updates.requestedLocalApply) throw new DomainError('local_apply_disabled', 422); return supervisor.activate(p.updateId, p.requestHash); }
  if (method === 'recover') { z.strictObject({}).parse(payload); return supervisor.recover(); }
  if (method === 'stop') { const p = z.strictObject({ scope: z.enum(['coordinator', 'all']) }).parse(payload); if (engine.running()) throw new DomainError('improvement_in_progress', 409); await host.freeze(true); if (p.scope === 'all' && await host.activeRuns() > 0) { const broker = await host.connectBroker(); for (const run of await broker.sessions()) if (!['succeeded', 'failed', 'interrupted'].includes(run.state) && !(await broker.interrupt(run.runId)).acknowledged) throw new DomainError('stop_pending', 503); } await host.stopCoordinator(); const activeRuns = await host.activeRuns(); if (p.scope === 'all' && activeRuns > 0) return { state: 'reconciliation_required', activeRuns }; if (!activeRuns) await host.closeBroker(); setTimeout(() => { void close(); }, 100); return { state: 'stopped', brokerPreserved: activeRuns > 0, activeRuns }; }
  throw new DomainError('unsupported_operation', 422);
});
await writeOwner(root, 'supervisor', current.id, server.endpoint, current.key);
try { const pointer = supervisor.pointer(); await host.connectBroker(); if (!await host.healthy(pointer.current)) await host.startCoordinator(pointer.current); const recovered = await supervisor.recover(); if (['stable', 'applied', 'rolled_back'].includes(recovered.state)) await host.freeze(false); await prune(); log.write({ operation: 'supervisor.start', result: 'ready' }); process.send?.({ ready: true }); }
catch { await host.freeze(true); process.send?.({ ready: true, recovery: true }); }
async function close() { if (stopping) return; stopping = true; clearInterval(timer); clearInterval(updateTimer); await engine.idle(); await server.close(); updateStore.close(); await instance.release(); if (process.connected) process.disconnect(); }
process.on('SIGTERM', () => { clearInterval(updateTimer); void engine.idle().then(() => host.freeze(true)).then(() => host.stopCoordinator()).then(close); });
