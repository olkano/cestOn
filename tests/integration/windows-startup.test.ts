import { it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createTestRoot, cleanupTestRoot } from '../../packages/test-support/src/index.js';

const run = promisify(execFile);
const powershell = (args: string[]) => run('powershell.exe', ['-NoProfile', '-NonInteractive', ...args], { windowsHide: true, timeout: 60000 });

// Registers a real current-user sign-in task under a random installation id, against a synthetic data root, and
// always removes it. A local account is read back without its computer name, which must still count as the owner.
// Runs on the owner's Windows PC. The hosted runner's disposable owner account has no interactive sign-in session, and
// registering a sign-in task there does not complete.
it.skipIf(process.platform !== 'win32' || process.env.GITHUB_ACTIONS === 'true')('installs, reinstalls and removes the sign-in task of the current user', async () => {
  const t = createTestRoot();
  const id = randomUUID();
  const taskName = `cestOn-${id}`;
  const script = join(t.root, 'supervisor', 'runtime', 'dist', 'apps', 'supervisor', 'src', 'cli.js');
  const startup = (mode: 'Install' | 'Uninstall', node = process.execPath) => powershell(['-File', resolve('scripts/windows-startup.ps1'),
    '-Mode', mode, '-TaskName', taskName, '-Node', node, '-Script', script, '-Root', t.root, '-InstallationId', id]);
  const registered = async () => (await powershell(['-Command', `if (Get-ScheduledTask -TaskName '${taskName}' -ErrorAction SilentlyContinue) { 'yes' } else { 'no' }`])).stdout.trim();
  try {
    await startup('Install');
    expect(await registered()).toBe('yes');
    await startup('Install');
    await expect(startup('Install', join(t.root, 'other-node.exe'))).rejects.toThrow(/does not match this installation/);
    await startup('Uninstall');
    expect(await registered()).toBe('no');
  } finally {
    await powershell(['-Command', `Unregister-ScheduledTask -TaskName '${taskName}' -Confirm:$false -ErrorAction SilentlyContinue`]).catch(() => {});
    cleanupTestRoot(t.root, t.runId);
  }
}, 120000);
