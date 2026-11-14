import { it, expect } from 'vitest';
import { fork } from 'node:child_process';
import { resolve } from 'node:path';
import { Store } from '../../apps/server/src/db/store.js';
import { childEnvironment } from '../../apps/broker/src/policy/index.js';
import { createTestRoot, cleanupTestRoot } from '../../packages/test-support/src/index.js';
it('T03 T05 a new connection waits for a concurrent writer before checking and projecting its latest schema state', async () => {
  const t = createTestRoot(); const initial = new Store(t.root, { testMode: true }); initial.close(); const child = fork(resolve('tests/fixtures/database-writer.ts'), [t.root], { execArgv: ['--import', 'tsx'], env: childEnvironment(process.env), stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true }); child.stderr?.on('data', () => {}); const exited = new Promise<void>(done => child.once('exit', () => done()));
  try { await new Promise<void>((done, reject) => { child.once('message', () => done()); child.once('error', reject); child.once('exit', code => { if (code) reject(new Error('Writer failed')); }); }); const opened = new Store(t.root, { testMode: true }); try { expect(opened.installation().revision).toBe(2); } finally { opened.close(); } await exited;
  } finally { if (child.exitCode === null && child.signalCode === null) { child.kill(); await exited; } cleanupTestRoot(t.root, t.runId); }
});
