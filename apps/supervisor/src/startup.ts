import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { installation } from './operations.js';
import { windowsHelperEnvironment } from '../../broker/src/windows-environment.js';
import { DomainError } from '../../../packages/contracts/src/commands.js';
import { dataAccess } from '../../server/src/security/access.js';
export async function startup(root: string, mode: 'Install' | 'Uninstall', plan = true, testMode = false) {
  await dataAccess(root); const current = installation(root, testMode); const taskName = `cestOn-${current.id}`; const script = join(root, 'supervisor/runtime/dist/apps/supervisor/src/cli.js');
  const result = { state: plan ? 'prepared' : mode === 'Install' ? 'installed' : 'removed', taskName, identity: 'current_user', executable: process.execPath, args: [script, 'start', '--root', root], changesPersistence: !plan };
  if (plan) return result; if (process.platform !== 'win32' || testMode) throw new DomainError('startup_registration_denied', 403);
  await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', join(root, 'supervisor/runtime/scripts/windows-startup.ps1'), '-Mode', mode, '-TaskName', taskName, '-Node', process.execPath, '-Script', script, '-Root', root, '-InstallationId', current.id], { env: windowsHelperEnvironment(), windowsHide: true, timeout: 15000 }); return result;
}
