import { mkdtempSync, writeFileSync, readFileSync, realpathSync, rmSync, existsSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export function createTestRoot() {
  const runId = randomUUID(); const installationId = randomUUID();
  const root = mkdtempSync(join(realpathSync.native(tmpdir()), 'ceston-test-'));
  writeFileSync(join(root, '.ceston-test.json'), JSON.stringify({ runId, installationId }), { flag: 'wx' });
  return { root, runId, installationId };
}
export function assertTestRoot(root: string, runId?: string) {
  const real = realpathSync.native(root);
  if (resolve(real).toLowerCase() !== resolve(root).toLowerCase() || !basename(real).startsWith('ceston-test-') || !resolve(real).toLowerCase().startsWith(resolve(realpathSync.native(tmpdir())).toLowerCase() + '\\'.replace('\\', process.platform === 'win32' ? '\\' : '/'))) throw new Error('Not an isolated temporary test root');
  if (existsSync(join(real, '.git'))) throw new Error('Source checkout is not a test data root');
  let marker: { runId: string; installationId: string };
  try { marker = JSON.parse(readFileSync(join(real, '.ceston-test.json'), 'utf8')) as typeof marker; } catch { throw new Error('Test root marker required'); }
  if (!/^[0-9a-f-]{36}$/.test(marker.runId) || !/^[0-9a-f-]{36}$/.test(marker.installationId) || (runId !== undefined && marker.runId !== runId)) throw new Error('Test root ownership mismatch');
  return marker;
}
export function cleanupTestRoot(root: string, runId: string): void {
  assertTestRoot(root, runId);
  const owned = realpathSync.native(root);
  for (const entry of readdirSync(owned)) if (entry !== '.ceston-test.json') rmSync(join(owned, entry), { recursive: true, force: false, maxRetries: 20, retryDelay: 100 });
  assertTestRoot(root, runId); unlinkSync(join(owned, '.ceston-test.json')); rmdirSync(owned);
  if (existsSync(root)) throw new Error('Test cleanup failed');
}
export class FakeClock {
  constructor(public now = 0) {}
  advance(ms: number) { this.now += ms; }
}
