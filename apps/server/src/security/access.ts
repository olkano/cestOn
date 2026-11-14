import { mkdirSync, chmodSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { canonicalPath } from '../../../../packages/contracts/src/paths.js';
import { windowsHelperEnvironment } from '../../../broker/src/windows-environment.js';
import { DomainError } from '../../../../packages/contracts/src/commands.js';
export async function dataAccess(root: string, set = false) {
  if (set) mkdirSync(root, { recursive: true }); const path = canonicalPath(root);
  if (process.platform === 'win32') { try { const result = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', resolve('scripts/windows-access.ps1'), '-Root', path, '-Mode', set ? 'Set' : 'Check'], { windowsHide: true, env: windowsHelperEnvironment(), timeout: 5000 }); if ((JSON.parse(result.stdout) as { ownerOnly?: boolean }).ownerOnly !== true) throw new Error(); } catch { throw new DomainError('data_root_access_denied', 403); } }
  else { if (set) chmodSync(path, 0o700); if (statSync(path).mode & 0o077) throw new DomainError('data_root_access_denied', 403); }
  return { ownerOnly: true };
}
