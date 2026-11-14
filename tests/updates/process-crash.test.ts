import { it, expect } from 'vitest';
import { fork } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createTestRoot, cleanupTestRoot } from '../../packages/test-support/src/index.js';
import { atomicJson, fileHash } from '../../packages/contracts/src/files.js';
import { inventory } from '../../apps/supervisor/src/releases.js';
import { Supervisor } from '../../apps/supervisor/src/activation.js';
import { SyntheticActivationHost } from '../fixtures/activation-host.js';
import { childEnvironment } from '../../apps/broker/src/policy/index.js';
it('T34 killing the actual supervisor process at every journal boundary recovers its on-disk pointer', async () => {
  for (const phase of ['preparing', 'before_switch', 'switched', 'checking', 'verified', 'applied']) {
    const t = createTestRoot(); const id = randomUUID(); let child: ReturnType<typeof fork> | undefined;
    try {
      for (const name of ['base', 'candidate']) { const directory = join(t.root, name); mkdirSync(join(directory, 'source/apps/web'), { recursive: true }); writeFileSync(join(directory, 'source/apps/web/filter.ts'), name); writeFileSync(join(directory, 'source/package.json'), '{}'); writeFileSync(join(directory, 'package-lock.json'), '{}'); atomicJson(join(directory, 'release-manifest.json'), { releaseId: name, sourceRevision: 'synthetic', sourceSnapshotHash: createHash('sha256').update(name).digest('hex'), createdAt: new Date().toISOString(), requestId: name === 'candidate' ? id : randomUUID(), baseReleaseId: name === 'candidate' ? 'base' : null, files: inventory(directory), nodeMajor: 24, lockfileHash: fileHash(join(directory, 'package-lock.json')), apiProtocol: 1, brokerProtocolRange: [1, 1], schemaReadRange: [3, 3], schemaWriteVersion: 3, migrationIds: [1, 2, 3], testEvidenceHashes: [], activationClass: 'coordinator' }); }
      child = fork(resolve('tests/fixtures/activation-process.ts'), [t.root, id, phase], { execArgv: ['--import', 'tsx'], env: childEnvironment(process.env), windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] }); const owned = child; let stderr = ''; child.stderr?.on('data', bytes => { stderr = (stderr + String(bytes)).slice(-2000); });
      await new Promise<void>((done, reject) => { const timer = setTimeout(() => reject(new Error(`Activation boundary timeout: ${stderr}`)), 10000); owned.once('message', value => { clearTimeout(timer); if ((value as { phase: string }).phase === phase) done(); else reject(new Error('Wrong boundary')); }); owned.once('exit', () => { clearTimeout(timer); reject(new Error(`Unexpected exit: ${stderr}`)); }); owned.once('error', reject); });
      const exited = new Promise<void>(done => owned.once('exit', () => done())); owned.kill('SIGKILL'); await exited;
      const recovered = new Supervisor(t.root, 'synthetic key', new SyntheticActivationHost(), { testMode: true }); const result = await recovered.recover(); expect(result.state).toBe(['verified', 'applied'].includes(phase) ? 'applied' : 'rolled_back'); expect(recovered.pointer().phase).toBe('stable'); expect(await recovered.recover()).toEqual(result);
    } finally { if (child && child.exitCode === null && child.signalCode === null) { const exited = new Promise<void>(done => child!.once('exit', () => done())); child.kill('SIGKILL'); await exited; } cleanupTestRoot(t.root, t.runId); }
  }
}, 60000);
