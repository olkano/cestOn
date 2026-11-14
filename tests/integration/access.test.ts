import { it, expect } from 'vitest';
import { dataAccess } from '../../apps/server/src/security/access.js';
import { createTestRoot, cleanupTestRoot } from '../../packages/test-support/src/index.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { childEnvironment } from '../../apps/broker/src/policy/index.js';
it('T27 data root protection reads back owner-only access under the current OS identity', async () => { const t = createTestRoot(); try { expect(await dataAccess(t.root, true)).toEqual({ ownerOnly: true }); expect(await dataAccess(t.root)).toEqual({ ownerOnly: true }); } finally { cleanupTestRoot(t.root, t.runId); } });
it('T27 a permissive private child ACL blocks startup even when its parent remains private', async () => {
  const t = createTestRoot();
  try { await dataAccess(t.root, true); const directory = join(t.root, 'state'); mkdirSync(directory); const file = join(directory, 'synthetic-secret.json'); writeFileSync(file, '{}');
    if (process.platform === 'win32') { const script = join(t.root, 'grant-synthetic-access.ps1'); writeFileSync(script, "param([string]$Target)\n$ErrorActionPreference='Stop'\n$acl=Get-Acl -LiteralPath $Target\n$sid=New-Object Security.Principal.SecurityIdentifier('S-1-1-0')\n$rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,'Read','Allow')\n$acl.AddAccessRule($rule)\nSet-Acl -LiteralPath $Target -AclObject $acl\n"); await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', script, '-Target', file], { windowsHide: true, env: childEnvironment(process.env) }); await expect(dataAccess(t.root)).rejects.toThrow('data_root_access_denied'); }
    else expect(await dataAccess(t.root)).toEqual({ ownerOnly: true });
  } finally { cleanupTestRoot(t.root, t.runId); }
});
