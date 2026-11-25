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
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { recoveryInterface, type RecoveryView } from './recovery-ui.js';
import { reportReady } from './ready.js';
import { verifyRelease } from './releases.js';
import { BackupService } from './backups.js';
import { OsProtector } from '../../server/src/security/protection.js';
import { safePath } from '../../../packages/contracts/src/paths.js';
import { FailingCandidateHost } from '../../../packages/test-support/src/update-host.js';
const root = process.argv[2]!; const testMode = process.argv.includes('--test'); await dataAccess(root); const current = installation(root, testMode);
const fixtureImprovement = process.argv.includes('--fixture-improvement'); if (fixtureImprovement && !testMode) throw new DomainError('fixture_improvement_denied');
if (await readOwner(root, 'supervisor', current.id, current.key)) throw new DomainError('supervisor_already_running');
const instance = await acquireInstance(root, 'supervisor', current.key);
const failHealth = process.argv.includes('--fixture-candidate-health-failure'); if (failHealth && (!testMode || !fixtureImprovement)) throw new DomainError('fixture_health_denied');
const host = failHealth ? new FailingCandidateHost(root, current.id, current.config, (await localStatus(root, testMode)).releaseId) : new ProcessHost(root, current.id, current.config, testMode); const supervisor = new Supervisor(root, current.key, host, { testMode });
const updateStore = new Store(root, { testMode }); const improvements = new ImprovementService(updateStore); const engine = new ImprovementEngine(improvements, supervisor, current.config, fixtureImprovement ? new FixtureImprovementWorker(root) : new NativeUpdateWorker(root, current.config, () => host.connectBroker()), new CandidateTools(root, current.config, testMode)); let ready = false; const updateTimer = setInterval(() => { if (ready) void engine.tick().catch(() => log.write({ operation: 'improvement.tick', result: 'blocked' })); }, 1000);
let stopping = false; let recoveryPage: Awaited<ReturnType<typeof recoveryInterface>> | null = null; let checkingRecovery = false;
async function syncRecovery() { if (checkingRecovery || stopping) return; checkingRecovery = true; try { if (supervisor.pointer().phase !== 'recovery') { await recoveryPage?.close(); recoveryPage = null; return; } recoveryPage ??= await recoveryInterface(async () => { const pointer = supervisor.pointer(); const releases: RecoveryView['releases'] = []; for (const id of [pointer.current, pointer.previous].filter((id): id is string => Boolean(id))) { try { verifyRelease(safePath(root, `releases/${id}`)); releases.push({ id, integrity: 'verified' }); } catch { releases.push({ id: /^[a-zA-Z0-9_.-]+$/.test(id) ? id : 'invalid', integrity: 'failed' }); } } const backups: RecoveryView['backups'] = []; const directory = join(root, 'backups'); if (existsSync(directory)) for (const name of readdirSync(directory).filter(name => /^backup-[0-9]+-[a-f0-9]+\.ceston$/.test(name)).sort().reverse().slice(0, 3)) { try { await new BackupService(updateStore, new OsProtector(current.id)).verify(safePath(directory, name)); backups.push({ name, verification: 'verified' }); } catch { backups.push({ name, verification: 'failed' }); } } return { state: 'frozen_recovery', current: pointer.current, previous: pointer.previous, releases, backups }; }); } finally { checkingRecovery = false; } }
const recoveryTimer = setInterval(() => { void syncRecovery().catch(() => {}); }, 1000);
const log = new RotatingLog(root, 'supervisor'); let pruning = false; const prune = async () => { if (pruning) return; pruning = true; const store = new Store(root, { testMode }); try { retention(store, false); await (await host.connectBroker()).prune(); log.write({ operation: 'retention', result: 'pass' }); } catch { log.write({ operation: 'retention', result: 'blocked' }); } finally { store.close(); pruning = false; } }; const timer = setInterval(() => { void prune(); }, 86400000);
const server = await startIpcServer({ root, name: 'supervisor', installationId: current.id, token: current.key }, async (method, payload) => {
  if (method === 'status') { z.strictObject({}).parse(payload); return { ...await localStatus(root, testMode, false), activeRuns: await host.activeRuns(), recoveryUrl: recoveryPage?.url ?? null }; }
  if (method === 'stage') { const p = z.strictObject({ updateId: z.uuid(), bundle: z.string().min(1).max(2048), requestHash: z.string().regex(/^[a-f0-9]{64}$/) }).parse(payload); return supervisor.stage(p.updateId, p.bundle, p.requestHash); }
  if (method === 'activate') { const p = z.strictObject({ updateId: z.uuid(), requestHash: z.string().regex(/^[a-f0-9]{64}$/) }).parse(payload); if (!current.config.updates.requestedLocalApply) throw new DomainError('local_apply_disabled', 422); return supervisor.activate(p.updateId, p.requestHash); }
  if (method === 'recover') { z.strictObject({}).parse(payload); const result = await supervisor.recover(true); ready = ['stable', 'applied', 'rolled_back'].includes(result.state); await syncRecovery(); return result; }
  if (method === 'stop') { const p = z.strictObject({ scope: z.enum(['coordinator', 'all']) }).parse(payload); if (engine.running()) throw new DomainError('improvement_in_progress', 409); await host.freeze(true); if (p.scope === 'all' && await host.activeRuns() > 0) { const broker = await host.connectBroker(); for (const run of await broker.sessions()) if (!['succeeded', 'failed', 'interrupted'].includes(run.state) && !(await broker.interrupt(run.runId)).acknowledged) throw new DomainError('stop_pending', 503); } await host.stopCoordinator(); const activeRuns = await host.activeRuns(); if (p.scope === 'all' && activeRuns > 0) return { state: 'reconciliation_required', activeRuns }; if (!activeRuns) await host.closeBroker(); setTimeout(() => { void close(); }, 100); return { state: 'stopped', brokerPreserved: activeRuns > 0, activeRuns }; }
  throw new DomainError('unsupported_operation', 422);
});
await writeOwner(root, 'supervisor', current.id, server.endpoint, current.key);
try { const pointer = supervisor.pointer(); await host.connectBroker(); if (pointer.phase !== 'recovery' && !await host.healthy(pointer.current)) await host.startCoordinator(pointer.current); const recovered = await supervisor.recover(); if (['stable', 'applied', 'rolled_back'].includes(recovered.state)) await host.freeze(false); await prune(); ready = ['stable', 'applied', 'rolled_back'].includes(recovered.state); await syncRecovery(); log.write({ operation: 'supervisor.start', result: 'ready' }); reportReady({ ready: true }); }
catch { await host.freeze(true).catch(() => {}); supervisor.markRecovery(); await syncRecovery(); reportReady({ ready: true, recovery: true }); }
async function close() { if (stopping) return; stopping = true; clearInterval(timer); clearInterval(updateTimer); clearInterval(recoveryTimer); await recoveryPage?.close(); recoveryPage = null; await engine.idle(); await server.close(); updateStore.close(); await instance.release(); if (process.connected) process.disconnect(); }
process.on('SIGTERM', () => { clearInterval(updateTimer); void engine.idle().then(() => host.freeze(true)).then(() => host.stopCoordinator()).then(close); });
