import { fork, type ChildProcess } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import Database from 'better-sqlite3';
import { parseConfig, type Config } from '../../../packages/contracts/src/config.js';
import { DomainError } from '../../../packages/contracts/src/commands.js';
import { atomicJson } from '../../../packages/contracts/src/files.js';
import { childEnvironment } from '../../broker/src/policy/index.js';
import { ensureBroker, type BrokerClient } from '../../broker/src/client.js';
import { installationSecrets } from '../../broker/src/certification.js';
import { readOwner } from '../../broker/src/registry.js';
import { sameProcess } from '../../broker/src/process-identity.js';
import { coordinatorControl } from './control.js';
import { validateCandidate } from './validation.js';
import { verifyRelease } from './releases.js';
import type { SupervisorHost } from './activation.js';
import { Store } from '../../server/src/db/store.js';
import { BackupService } from './backups.js';
import { OsProtector, TestProtector } from '../../server/src/security/protection.js';
import { AuthService } from '../../server/src/auth/service.js';
import { createTestRoot, cleanupTestRoot } from '../../../packages/test-support/src/index.js';
export class ProcessHost implements SupervisorHost {
  private child: ChildProcess | null = null; private broker: Awaited<ReturnType<typeof ensureBroker>> | null = null;
  constructor(readonly root: string, readonly installationId: string, readonly config: Config, readonly testMode = false) {}
  private key() { return installationSecrets(this.root).supervisor; }
  async connectBroker() { this.broker ??= await ensureBroker(this.root, this.installationId, this.testMode); return this.broker.client; }
  async activeRuns() { const client = await this.connectBroker(); const sessions = await client.sessions(); let coordinator = 0; try { coordinator = (await coordinatorControl<{ activeRuns: number }>(this.root, this.installationId, this.key(), 'status')).activeRuns; } catch { /* Durable leases below prevent an unknown stopped coordinator from making a broker restart look safe. */ } const db = new Database(join(this.root, 'state/ceston.sqlite'), { readonly: true }); try { return Math.max(coordinator, sessions.filter(session => !['succeeded', 'failed', 'interrupted'].includes(session.state)).length, (db.prepare('SELECT COUNT(*) AS n FROM leases').get() as { n: number }).n); } finally { db.close(); } }
  async freeze(frozen: boolean) { try { await coordinatorControl(this.root, this.installationId, this.key(), 'freeze', { frozen }); } catch (error) { if (!(error instanceof DomainError) || error.code !== 'coordinator_not_running') throw error; } }
  async backup() { const store = new Store(this.root, { testMode: this.testMode }); try { await new BackupService(store, this.testMode ? new TestProtector(this.root) : new OsProtector(this.installationId)).create(); } finally { store.close(); } }
  async capture() { const db = new Database(join(this.root, 'state/ceston.sqlite'), { readonly: true }); try { return db.transaction(() => { const max = (db.prepare('SELECT COALESCE(MAX(rowid),0) AS n FROM commands').get() as { n: number }).n; const hash = createHash('sha256'); let count = 0; for (const row of db.prepare('SELECT id,payload_hash,device_id,idempotency_key FROM commands WHERE rowid<=? ORDER BY rowid').iterate(max)) { hash.update(JSON.stringify(row)); count++; } return JSON.stringify({ max, count, hash: hash.digest('hex') }); })(); } finally { db.close(); } }
  async preserved(checkpoint: string) { const expected = JSON.parse(checkpoint) as { max: number; count: number; hash: string }; const db = new Database(join(this.root, 'state/ceston.sqlite'), { readonly: true }); try { const hash = createHash('sha256'); let count = 0; for (const row of db.prepare('SELECT id,payload_hash,device_id,idempotency_key FROM commands WHERE rowid<=? ORDER BY rowid').iterate(expected.max)) { hash.update(JSON.stringify(row)); count++; } return count === expected.count && hash.digest('hex') === expected.hash && db.pragma('integrity_check', { simple: true }) === 'ok'; } finally { db.close(); } }
  validate(bundle: string) { return validateCandidate(this.root, bundle, this.config, this.testMode); }
  async stopCoordinator() {
    const owner = await readOwner(this.root, 'coordinator', this.installationId, this.key()); if (!owner) return;
    try { await coordinatorControl(this.root, this.installationId, this.key(), 'shutdown'); } catch { /* Read back the exact process identity before any further action. */ }
    const deadline = Date.now() + 10000; while (Date.now() < deadline) { if (!await sameProcess(owner)) { this.child = null; return; } await delay(200); }
    if (await sameProcess(owner)) process.kill(owner.pid, 'SIGTERM');
    const terminal = Date.now() + 5000; while (Date.now() < terminal) { if (!await sameProcess(owner)) { this.child = null; return; } await delay(200); }
    throw new DomainError('coordinator_stop_pending', 503);
  }
  async startCoordinator(releaseId: string) {
    const releaseRoot = join(this.root, 'releases', releaseId); verifyRelease(releaseRoot); await this.connectBroker();
    const db = new Database(join(this.root, 'state/ceston.sqlite')); try { db.prepare('UPDATE installations SET active_release=?').run(releaseId); } finally { db.close(); }
    const credentials = [this.config.voice.credentialEnv, this.config.push.privateKeyEnv].filter((value): value is string => Boolean(value));
    this.child = fork(join(releaseRoot, 'dist/apps/server/src/main.js'), [this.root, join(releaseRoot, 'apps/web/dist'), '--frozen', ...(this.testMode ? ['--test'] : [])], { cwd: releaseRoot, execArgv: [], env: childEnvironment(process.env, credentials), stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true });
    this.child.stderr?.on('data', () => {}); const child = this.child;
    await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new DomainError('coordinator_start_timeout', 503)), 60000); child.once('error', () => { clearTimeout(timer); reject(new DomainError('coordinator_start_failed', 503)); }); child.once('exit', () => { clearTimeout(timer); reject(new DomainError('coordinator_start_failed', 503)); }); child.once('message', value => { clearTimeout(timer); if ((value as { ready?: boolean }).ready) resolve(); else reject(new DomainError('coordinator_start_failed', 503)); }); });
  }
  async healthy(releaseId: string) { try { const status = await coordinatorControl<{ release: string; protocol: number; schema: number; staticBundle: string }>(this.root, this.installationId, this.key(), 'status'); const release = verifyRelease(join(this.root, 'releases', releaseId)); const staticManifest = JSON.parse(readFileSync(join(this.root, 'releases', releaseId, 'apps/web/dist/release.json'), 'utf8')) as { staticBundle: string }; return status.release === releaseId && status.protocol === release.manifest.apiProtocol && status.schema >= release.manifest.schemaReadRange[0] && status.schema <= release.manifest.schemaReadRange[1] && status.staticBundle === staticManifest.staticBundle; } catch { return false; } }
  async observe(releaseId: string, milliseconds: number) { const deadline = Date.now() + milliseconds; while (Date.now() < deadline) { if (!await this.healthy(releaseId)) return false; await delay(Math.min(1000, Math.max(0, deadline - Date.now()))); } return this.healthy(releaseId); }
  async canary(releaseId: string) { return runCanary(join(this.root, 'releases', releaseId)); }
  async closeBroker() { if (this.broker) { if (await this.activeRuns() > 0) throw new DomainError('broker_not_idle'); if (this.broker.child) await this.broker.close(); else await this.broker.client.shutdown(); this.broker = null; } }
  get brokerClient(): BrokerClient | null { return this.broker?.client ?? null; }
}
export async function runCanary(releaseRoot: string, sourceMode = false) {
  const t = createTestRoot(); let child: ChildProcess | null = null; let store: Store | null = null;
  try {
    const socket = createServer(); await new Promise<void>(resolve => socket.listen(0, '127.0.0.1', resolve)); const address = socket.address(); if (!address || typeof address === 'string') throw new DomainError('canary_port_failed'); const port = address.port; await new Promise<void>(resolve => socket.close(() => resolve()));
    mkdirSync(join(t.root, 'project')); mkdirSync(join(t.root, 'state')); const projectId = randomUUID(); const config = parseConfig({ listen: { port }, projects: [{ id: projectId, displayName: 'Synthetic canary', root: join(t.root, 'project'), kind: 'documents', providerId: 'fixture', operations: ['read', 'edit', 'test'], recipes: [{ id: 'check', operation: 'test', executable: 'fixture:assert-artifact', args: ['result.txt'] }] }], providers: [{ id: 'fixture', kind: 'fixture', executable: '', version: '1', profile: 'constrained' }] }, { testMode: true }); atomicJson(join(t.root, 'state/config.json'), config);
    const staticRoot = sourceMode ? join(t.root, 'static') : join(releaseRoot, 'apps/web/dist');
    if (sourceMode) { mkdirSync(staticRoot); atomicJson(join(staticRoot, 'release.json'), { protocol: 1, staticBundle: 'synthetic-api-canary' }); atomicJson(join(staticRoot, 'index.html'), 'Synthetic API canary shell'); }
    child = fork(join(releaseRoot, sourceMode ? 'apps/server/src/main.ts' : 'dist/apps/server/src/main.js'), [t.root, staticRoot, '--test'], { cwd: releaseRoot, execArgv: sourceMode ? ['--import', 'tsx'] : [], env: childEnvironment(process.env), stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true }); child.stderr?.on('data', () => {}); const launched = child;
    await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new DomainError('canary_start_timeout')), 15000); launched.once('message', () => { clearTimeout(timer); resolve(); }); launched.once('exit', () => { clearTimeout(timer); reject(new DomainError('canary_start_failed')); }); launched.once('error', reject); });
    store = new Store(t.root, { testMode: true }); const invitation = new AuthService(store).invite(); const origin = `http://127.0.0.1:${port}`;
    const paired = await fetch(`${origin}/api/v1/pairing/redeem`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ invitation, deviceName: 'Isolated canary' }), signal: AbortSignal.timeout(5000) }); if (!paired.ok) return false; const session = await paired.json() as { data: { csrf: string } }; const headers = { Origin: origin, Cookie: paired.headers.get('set-cookie')!.split(';')[0]!, 'X-CSRF-Token': session.data.csrf, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() };
    const task = await fetch(`${origin}/api/v1/commands`, { method: 'POST', headers, body: JSON.stringify({ type: 'task.create', payload: { projectId, title: 'Synthetic release canary', goal: 'Create a synthetic artifact', requestedScope: { operations: ['read', 'edit', 'test'] } } }), signal: AbortSignal.timeout(5000) }); if (task.status !== 202) return false; const receipt = await task.json() as { data: { taskId: string; id: string } }; const repeated = await fetch(`${origin}/api/v1/commands`, { method: 'POST', headers, body: JSON.stringify({ type: 'task.create', payload: { projectId, title: 'Synthetic release canary', goal: 'Create a synthetic artifact', requestedScope: { operations: ['read', 'edit', 'test'] } } }), signal: AbortSignal.timeout(5000) }); if ((await repeated.json() as { data: { id: string } }).data.id !== receipt.data.id) return false;
    const deadline = Date.now() + 10000; while (Date.now() < deadline) { if (store.getTask(receipt.data.taskId).state === 'review_ready') return existsSync(join(t.root, 'project/result.txt')); await delay(100); } return false;
  } finally {
    store?.close(); if (child && child.exitCode === null && child.signalCode === null) { const exited = new Promise<void>(resolve => child!.once('exit', () => resolve())); if (child.connected) child.send({ type: 'shutdown' }); else child.kill(); await exited; } cleanupTestRoot(t.root, t.runId);
  }
}
