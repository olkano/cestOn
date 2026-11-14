import { existsSync, readFileSync, readdirSync, mkdirSync, copyFileSync, statfsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import Database from 'better-sqlite3';
import { parseConfig, type Config } from '../../../packages/contracts/src/config.js';
import { validateDataRoot } from '../../../packages/contracts/src/paths.js';
import { atomicJson } from '../../../packages/contracts/src/files.js';
import { DomainError } from '../../../packages/contracts/src/commands.js';
import { assertTestRoot } from '../../../packages/test-support/src/index.js';
import { dataAccess } from '../../server/src/security/access.js';
import { Store } from '../../server/src/db/store.js';
import { AuthService } from '../../server/src/auth/service.js';
import { installationSecrets, certificationValid } from '../../broker/src/certification.js';
import { readOwner } from '../../broker/src/registry.js';
import { ipcRequest } from '../../broker/src/ipc.js';
import { childEnvironment } from '../../broker/src/policy/index.js';
import { verifyRelease } from './releases.js';
import { Supervisor, type Pointer } from './activation.js';
import { ProcessHost } from './host.js';
import { BackupService } from './backups.js';
import { OsProtector } from '../../server/src/security/protection.js';
import { releaseSchema } from '../../../packages/contracts/src/release.js';
export async function initializeInstallation(root: string, bundle: string, input: unknown, testMode = false) {
  if (testMode) assertTestRoot(root); else validateDataRoot(root);
  const config = parseConfig(input, { testMode }); validateDataRoot(root, testMode ? [] : config.projects.map(project => project.root));
  mkdirSync(root, { recursive: true }); if (readdirSync(root).some(name => name !== '.ceston-test.json')) throw new DomainError('installation_target_not_empty');
  const release = verifyRelease(bundle); await dataAccess(root, true); atomicJson(join(root, 'state/config.json'), config);
  const store = new Store(root, { testMode }); try { for (const project of config.projects) store.registerProject(project); const id = store.installation().id; const key = installationSecrets(root).supervisor;
    const supervisor = new Supervisor(root, key, new ProcessHost(root, id, config, testMode), { testMode }); await supervisor.initialize(bundle);
    const stable = join(root, 'supervisor/runtime'); for (const file of [...release.manifest.files, { path: 'release-manifest.json' }]) { const target = join(stable, file.path); mkdirSync(dirname(target), { recursive: true }); copyFileSync(join(bundle, file.path), target); } verifyRelease(stable, release.hash);
    store.db.prepare('UPDATE installations SET active_release=?').run(release.manifest.releaseId); return { state: 'installed_stopped', installationId: id, releaseId: release.manifest.releaseId, startupInstalled: false };
  } finally { store.close(); }
}
export function installation(root: string, testMode = false) {
  if (testMode) assertTestRoot(root); else validateDataRoot(root);
  const config = parseConfig(JSON.parse(readFileSync(join(root, 'state/config.json'), 'utf8')), { testMode });
  const db = new Database(join(root, 'state/ceston.sqlite'), { readonly: true }); try { const row = db.prepare('SELECT id FROM installations').get() as { id: string }; return { id: z.uuid().parse(row.id), config, key: installationSecrets(root).supervisor }; } finally { db.close(); }
}
export async function supervisorRequest<T>(root: string, method: string, payload: unknown = {}, testMode = false): Promise<T> {
  const current = installation(root, testMode); const owner = await readOwner(root, 'supervisor', current.id, current.key); if (!owner) throw new DomainError('supervisor_not_running', 503);
  const requestId = randomUUID(); const reply = await ipcRequest(owner.endpoint, { protocol: 1, requestId, installationId: current.id, token: current.key, method, payload }, method === 'stage' || method === 'activate' ? 1800000 : method === 'stop' ? 120000 : 15000);
  if (reply.error || reply.requestId !== requestId) throw new DomainError(reply.error?.code ?? 'supervisor_wrong_response', 503); return reply.data as T;
}
export async function startInstallation(root: string, testMode = false) {
  await dataAccess(root); const current = installation(root, testMode); const owner = await readOwner(root, 'supervisor', current.id, current.key); if (owner) return supervisorRequest(root, 'status', {}, testMode);
  const stable = join(root, 'supervisor/runtime'); verifyRelease(stable); const credentials = [current.config.voice.credentialEnv, current.config.push.privateKeyEnv, ...(current.config.providers.some(provider => provider.kind === 'claude' && provider.billingMode === 'metered') ? ['ANTHROPIC_API_KEY'] : [])].filter((value): value is string => Boolean(value));
  const child = fork(join(stable, 'dist/apps/supervisor/src/main.js'), [root, ...(testMode ? ['--test'] : [])], { cwd: stable, execArgv: [], detached: true, windowsHide: true, env: childEnvironment(process.env, credentials), stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  await new Promise<void>((done, reject) => { const timer = setTimeout(() => reject(new DomainError('supervisor_start_pending', 503)), 60000); child.once('error', () => { clearTimeout(timer); reject(new DomainError('supervisor_start_failed', 503)); }); child.once('exit', () => { clearTimeout(timer); reject(new DomainError('supervisor_start_failed', 503)); }); child.once('message', message => { clearTimeout(timer); if ((message as { ready?: boolean }).ready) done(); else reject(new DomainError('supervisor_start_failed', 503)); }); });
  child.disconnect(); child.unref(); return supervisorRequest(root, 'status', {}, testMode);
}
export async function localStatus(root: string, testMode = false, integrity = true) {
  const current = installation(root, testMode); const pointer = JSON.parse(readFileSync(join(root, 'supervisor/active.json'), 'utf8')) as Pointer; const release = integrity ? verifyRelease(join(root, 'releases', pointer.current)).manifest : releaseSchema.parse(JSON.parse(readFileSync(join(root, 'releases', pointer.current, 'release-manifest.json'), 'utf8'))); const owner = await readOwner(root, 'supervisor', current.id, current.key);
  return { state: owner ? 'running' : 'stopped', installationId: current.id, releaseId: release.releaseId, previousRelease: pointer.previous, recovery: pointer.phase === 'recovery', protocol: release.apiProtocol, integrity: integrity ? 'verified' : 'not_rechecked' };
}
export async function pairingInvitation(root: string, testMode = false) { await dataAccess(root); const store = new Store(root, { testMode }); try { return new AuthService(store).invite(); } finally { store.close(); } }
export async function backupInstallation(root: string) { await dataAccess(root); const store = new Store(root); try { return await new BackupService(store, new OsProtector(store.installation().id)).create(); } finally { store.close(); } }
export async function doctor(root: string, testMode = false) {
  const checks: { capability: string; status: 'ready' | 'degraded' | 'blocked'; code?: string }[] = []; const check = async (capability: string, action: () => unknown | Promise<unknown>) => { try { await action(); checks.push({ capability, status: 'ready' }); } catch (error) { checks.push({ capability, status: 'blocked', code: error instanceof DomainError ? error.code : 'check_failed' }); } };
  await check('node', () => { if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error(); }); await check('data_access', () => dataAccess(root));
  let current: ReturnType<typeof installation> | undefined; await check('configuration', () => { current = installation(root, testMode); });
  await check('database', () => { const db = new Database(join(root, 'state/ceston.sqlite'), { readonly: true }); try { if (db.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error(); } finally { db.close(); } });
  await check('release', () => localStatus(root, testMode)); await check('disk', () => { const space = statfsSync(root); if (space.bavail * space.bsize < 256 * 1048576) throw new Error(); });
  await check('clock', () => { if (Date.now() < Date.parse('2026-01-01') || Date.now() > Date.parse('2100-01-01')) throw new Error(); });
  if (current) { for (const project of current.config.projects) await check(`project:${project.id}`, () => { if (!existsSync(resolve(project.root))) throw new Error(); }); for (const provider of current.config.providers) checks.push({ capability: `provider:${provider.id}`, status: provider.kind === 'fixture' && testMode || certificationValid(root, provider) ? 'ready' : 'blocked', code: 'live_certification_required' });
    await check('supervisor', () => supervisorRequest(root, 'status', {}, testMode)); if (!current.config.voice.enabled) checks.push({ capability: 'voice', status: 'degraded', code: 'disabled' }); if (!current.config.push.enabled) checks.push({ capability: 'push', status: 'degraded', code: 'disabled' }); }
  return { state: checks.some(item => item.status === 'blocked') ? 'blocked' : checks.some(item => item.status === 'degraded') ? 'degraded' : 'ready', checks, note: 'Clock check detects implausible local time, not authenticated network skew. Provider certificates require separate live evidence.' };
}
export function defaultRoot() { return join(process.env.LOCALAPPDATA ?? process.env.XDG_DATA_HOME ?? join(process.env.HOME ?? '.', '.local/share'), 'ceston'); }
export type InstallationConfig = Config;
