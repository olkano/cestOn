import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { childEnvironment } from '../apps/broker/src/policy/index.js';
import { createTestRoot, cleanupTestRoot } from '../packages/test-support/src/index.js';
if (process.platform !== 'win32') console.log(JSON.stringify({ result: 'not_applicable', capability: 'Windows helper startup' }));
else {
  const environment = childEnvironment(process.env); if (!environment.SYSTEMROOT || !environment.PATH) throw new Error('required_windows_environment_missing');
  const t = createTestRoot();
  try {
    for (const [name, args] of [
      ['startup', ['-Command', "[Console]::Write('ready')"]],
      ['process-cmdlet', ['-Command', "$ErrorActionPreference='Stop'; $item=Get-Process -Id ([Diagnostics.Process]::GetCurrentProcess().Id); if(!$item.StartTime){throw 'missing identity'}; [Console]::Write('ready')"]],
      ['dpapi', ['-Command', "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $encrypted=[Security.Cryptography.ProtectedData]::Protect([byte[]](1,2,3),[byte[]](4),[Security.Cryptography.DataProtectionScope]::CurrentUser); if($encrypted.Length -lt 3){throw 'missing encryption'}; [Console]::Write('ready')"]],
      ['acl', ['-File', 'scripts/windows-access.ps1', '-Root', t.root, '-Mode', 'Set']],
    ] as const) {
      console.log(JSON.stringify({ stage: name, state: 'started', modelTurns: 0 })); const start = Date.now();
      const result = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', ...args], { env: environment, windowsHide: true, timeout: 60000, maxBuffer: 4096 });
      if (name === 'acl' ? JSON.parse(result.stdout).ownerOnly !== true : result.stdout !== 'ready') throw new Error('unexpected_windows_helper_response');
      console.log(JSON.stringify({ stage: name, state: 'ready', elapsedMs: Date.now() - start, modelTurns: 0 }));
    }
  } finally { cleanupTestRoot(t.root, t.runId); }
}
