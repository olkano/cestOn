import { it, expect } from 'vitest';
import { fork } from 'node:child_process';
import { Store } from '../../apps/server/src/db/store.js';
import { ProjectMemory } from '../../apps/server/src/db/memory.js';
import { createTestRoot, cleanupTestRoot } from '../../packages/test-support/src/index.js';

for (const boundary of ['before_commit', 'after_commit']) {
  for (const mode of ['command', 'memory']) it(`T05/M07 process kill ${boundary} preserves only committed ${mode}`, async () => {
    const t = createTestRoot();
    const child = fork('tests/integration/fixtures/commit-crash.ts', [t.root, boundary, mode], { execArgv: ['--import', 'tsx'], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    let stderr = ''; child.stderr?.on('data', b => { stderr += String(b); });
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Child boundary timeout: ${stderr}`)), 5000);
        child.once('error', error => { clearTimeout(timeout); reject(error); });
        child.once('message', () => { clearTimeout(timeout); resolve(); });
        child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Child exited ${code}: ${stderr}`)); });
      });
      const exit = new Promise<void>(resolve => child.once('exit', () => resolve())); child.kill('SIGKILL'); await exit;
      const store = new Store(t.root, { testMode: true });
      try {
        expect(store.db.pragma('integrity_check', { simple: true })).toBe('ok');
        const committed = boundary === 'after_commit' ? 1 : 0;
        expect(store.listTasks()).toHaveLength(mode === 'command' ? committed : 0);
        expect(store.db.prepare('SELECT * FROM outbox').all()).toHaveLength(mode === 'command' ? committed : 0);
        expect(new ProjectMemory(store).list().entries).toHaveLength(mode === 'memory' ? committed : 0);
        if (mode === 'memory') expect(store.events(0).filter(event => event.type === 'memory.changed')).toHaveLength(committed);
      } finally { store.close(); }
    } finally { if (child.exitCode === null && child.signalCode === null) { const exit = new Promise<void>(resolve => child.once('exit', () => resolve())); child.kill('SIGKILL'); await exit; } cleanupTestRoot(t.root, t.runId); }
  });
}
