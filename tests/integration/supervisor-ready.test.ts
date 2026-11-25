import { it, expect } from 'vitest';
import { fork } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTestRoot, cleanupTestRoot } from '../../packages/test-support/src/index.js';
import { awaitReady } from '../../apps/supervisor/src/ready.js';

// A synthetic supervisor that becomes ready after the starter has stopped waiting, as at Windows sign-in.
const slowSupervisor = `
import { writeFileSync } from 'node:fs';
setTimeout(() => { if (process.connected) process.send({ ready: true }); writeFileSync(process.argv[2], 'ready'); }, 1500);
setTimeout(() => process.exit(0), 20000);
`;

it('lets go of a supervisor that is slower than the wait, which keeps running and still becomes ready', async () => {
  const t = createTestRoot();
  const script = join(t.root, 'slow-supervisor.mjs');
  const marker = join(t.root, 'ready');
  writeFileSync(script, slowSupervisor);
  const child = fork(script, [marker], { detached: true, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  try {
    await expect(awaitReady(child, 200)).rejects.toMatchObject({ code: 'supervisor_start_pending' });
    expect(child.connected).toBe(false);
    await expect.poll(() => existsSync(marker), { timeout: 10000 }).toBe(true);
    expect(child.exitCode).toBeNull();
  } finally { child.kill(); cleanupTestRoot(t.root, t.runId); }
});

it('returns once a supervisor reports ready in time and leaves it running on its own', async () => {
  const t = createTestRoot();
  const script = join(t.root, 'slow-supervisor.mjs');
  writeFileSync(script, slowSupervisor);
  const child = fork(script, [join(t.root, 'ready')], { detached: true, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  try {
    await expect(awaitReady(child, 10000)).resolves.toBeUndefined();
    expect(child.connected).toBe(false);
    expect(child.exitCode).toBeNull();
  } finally { child.kill(); cleanupTestRoot(t.root, t.runId); }
});
