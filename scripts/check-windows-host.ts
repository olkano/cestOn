import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { windowsHelperEnvironment } from '../apps/broker/src/windows-environment.js';
import { createTestRoot, cleanupTestRoot } from '../packages/test-support/src/index.js';
import { OsProtector } from '../apps/server/src/security/protection.js';
import { acquireInstance } from '../apps/broker/src/instance.js';
import { startIpcServer, ipcRequest } from '../apps/broker/src/ipc.js';
if (process.platform !== 'win32') console.log(JSON.stringify({ result: 'not_applicable', capability: 'Windows helper startup' }));
else {
  const environment = windowsHelperEnvironment(); if (!environment.SYSTEMROOT || !environment.PATH) throw new Error('required_windows_environment_missing');
  const t = createTestRoot();
  try {
    for (const [name, args] of [
      ['startup', ['-Command', "[Console]::Write('ready')"]],
      ['process-identity', ['-Command', "$ErrorActionPreference='Stop'; $item=[Diagnostics.Process]::GetCurrentProcess(); if(!$item.StartTime){throw 'missing identity'}; [Console]::Write('ready')"]],
      ['acl', ['-File', 'scripts/windows-access.ps1', '-Root', t.root, '-Mode', 'Set']],
    ] as const) {
      console.log(JSON.stringify({ stage: name, state: 'started', modelTurns: 0 })); const start = Date.now();
      const result = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', ...args], { env: environment, windowsHide: true, timeout: 60000, maxBuffer: 4096 });
      if (name === 'acl' ? JSON.parse(result.stdout).ownerOnly !== true : result.stdout !== 'ready') throw new Error('unexpected_windows_helper_response');
      console.log(JSON.stringify({ stage: name, state: 'ready', elapsedMs: Date.now() - start, modelTurns: 0 }));
    }
    let start = Date.now(); const protector = new OsProtector(t.installationId); if (await protector.open(await protector.seal('Synthetic startup check', 'host-check'), 'host-check') !== 'Synthetic startup check') throw new Error('dpapi_readback_failed'); console.log(JSON.stringify({ stage: 'dpapi-round-trip', state: 'ready', elapsedMs: Date.now() - start, modelTurns: 0 }));
    start = Date.now(); const lock = await acquireInstance(t.root, 'host-check', 'synthetic'); await lock.release(); console.log(JSON.stringify({ stage: 'mutex', state: 'ready', elapsedMs: Date.now() - start, modelTurns: 0 }));
    start = Date.now(); const server = await startIpcServer({ root: t.root, name: 'host-check', installationId: t.installationId, token: t.runId }, async () => ({ ready: true })); try { const response = await ipcRequest(server.endpoint, { protocol: 1, installationId: t.installationId, token: t.runId, requestId: t.runId, method: 'host-check', payload: {} }); if (!(response.data as { ready?: boolean })?.ready) throw new Error('ipc_readback_failed'); } finally { await server.close(); } console.log(JSON.stringify({ stage: 'owner-only-ipc', state: 'ready', elapsedMs: Date.now() - start, modelTurns: 0 }));
  } finally { cleanupTestRoot(t.root, t.runId); }
}
