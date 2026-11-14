import { it, expect } from 'vitest';
import { mkdirSync, writeFileSync, symlinkSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { Supervisor, InjectedSupervisorCrash, type SupervisorHost, type Validation } from '../../apps/supervisor/src/activation.js';
import { inventory, verifyRelease } from '../../apps/supervisor/src/releases.js';
import { createTestRoot, cleanupTestRoot } from '../../packages/test-support/src/index.js';
import { atomicJson, fileHash } from '../../packages/contracts/src/files.js';
function bundle(root: string, name: string, base: string | null, requestId: string, protectedEdit = false) {
  const directory = join(root, name); mkdirSync(join(directory, 'source/apps/web'), { recursive: true }); writeFileSync(join(directory, 'source/apps/web/filter.ts'), name); writeFileSync(join(directory, 'source/package.json'), '{}'); writeFileSync(join(directory, 'package-lock.json'), '{}');
  if (protectedEdit) { mkdirSync(join(directory, 'source/apps/server/src/auth'), { recursive: true }); writeFileSync(join(directory, 'source/apps/server/src/auth/service.ts'), 'unsafe candidate'); }
  atomicJson(join(directory, 'release-manifest.json'), { releaseId: name, sourceRevision: 'synthetic', sourceSnapshotHash: createHash('sha256').update(name).digest('hex'), createdAt: new Date().toISOString(), requestId, baseReleaseId: base, files: inventory(directory), nodeMajor: 24, lockfileHash: fileHash(join(directory, 'package-lock.json')), apiProtocol: 1, brokerProtocolRange: [1, 1], schemaReadRange: [2, 2], schemaWriteVersion: 2, migrationIds: [1, 2], testEvidenceHashes: [], activationClass: 'coordinator' }); return directory;
}
class Host implements SupervisorHost {
  frozen = false; fail = new Set<string>(); validationFails = false; runs = 0;
  async validate(): Promise<Validation> { return { certifiedHost: false, checks: (['verify', 'security', 'updates', 'canary'] as const).map(name => ({ name, result: this.validationFails ? 'fail' : 'pass', evidenceHash: 'a'.repeat(64) })) }; }
  async freeze(value: boolean) { this.frozen = value; } async activeRuns() { return this.runs; } async backup() {} async capture() { return 'unchanged-durable-commands'; } async preserved(value: string) { return value === 'unchanged-durable-commands'; } async stopCoordinator() {} async startCoordinator() {} async healthy(id: string) { return !this.fail.has(id); } async canary(id: string) { return !this.fail.has(id); } async observe(id: string, duration: number) { expect(duration).toBe(120000); return !this.fail.has(id); }
}
it('T30 T34 broker-declared candidates wait for idle and incompatible schemas cannot switch', async () => {
  const t = createTestRoot(); const host = new Host(); const supervisor = new Supervisor(t.root, 'synthetic key', host, { testMode: true }); const id = randomUUID();
  try { await supervisor.initialize(bundle(t.root, 'base', null, randomUUID())); const candidate = bundle(t.root, 'candidate', 'base', id); const path = join(candidate, 'release-manifest.json'); const manifest = JSON.parse(readFileSync(path, 'utf8')); manifest.activationClass = 'broker'; atomicJson(path, manifest); await supervisor.stage(id, candidate, 'request'); host.runs = 2; expect((await supervisor.activate(id, 'request')).state).toBe('waiting_for_safe_point'); expect(host.frozen).toBe(false); expect(supervisor.pointer().current).toBe('base'); host.runs = 0; expect((await supervisor.activate(id, 'request')).state).toBe('applied');
    const nextId = randomUUID(); const incompatible = bundle(t.root, 'incompatible', 'candidate', nextId); const incompatiblePath = join(incompatible, 'release-manifest.json'); const next = JSON.parse(readFileSync(incompatiblePath, 'utf8')); next.schemaWriteVersion = 4; next.schemaReadRange = [4, 4]; atomicJson(incompatiblePath, next); await supervisor.stage(nextId, incompatible, 'next-request'); await expect(supervisor.activate(nextId, 'next-request')).rejects.toThrow('migration_compatibility_proof_required'); expect(supervisor.pointer().current).toBe('candidate');
  } finally { cleanupTestRoot(t.root, t.runId); }
});
it('T32 fake reports, tampered bytes, unsafe paths and protected edits cannot activate', async () => {
  const t = createTestRoot(); const host = new Host(); const supervisor = new Supervisor(t.root, 'synthetic key', host, { testMode: true }); const requestId = randomUUID();
  try { await supervisor.initialize(bundle(t.root, 'base', null, randomUUID())); const candidate = bundle(t.root, 'candidate', 'base', requestId);
    await expect(supervisor.activate(requestId, 'request')).rejects.toThrow('trusted_validation_required');
    host.validationFails = true; await expect(supervisor.stage(requestId, candidate, 'request')).rejects.toThrow('candidate_verification_failed'); host.validationFails = false;
    expect((await supervisor.stage(requestId, bundle(t.root, 'protected', 'base', requestId, true), 'request')).state).toBe('needs_authority');
    writeFileSync(join(candidate, 'source/apps/web/filter.ts'), 'tampered'); expect(() => verifyRelease(candidate)).toThrow('release_integrity_failed');
    symlinkSync(join(t.root, 'base'), join(candidate, 'escape'), process.platform === 'win32' ? 'junction' : 'dir'); expect(() => verifyRelease(candidate)).toThrow('release_path_denied'); expect(supervisor.pointer().current).toBe('base');
  } finally { cleanupTestRoot(t.root, t.runId); }
});
it('T33 verified candidates apply once; failed health rolls back; failed rollback freezes recovery', async () => {
  for (const mode of ['pass', 'bad', 'both']) {
    const t = createTestRoot(); const host = new Host(); const supervisor = new Supervisor(t.root, 'synthetic key', host, { testMode: true }); const requestId = randomUUID();
    try { await supervisor.initialize(bundle(t.root, 'base', null, randomUUID())); const candidate = bundle(t.root, 'candidate', 'base', requestId); expect((await supervisor.stage(requestId, candidate, 'request')).state).toBe('staged'); if (mode !== 'pass') host.fail.add('candidate'); if (mode === 'both') host.fail.add('base');
      const result = await supervisor.activate(requestId, 'request'); expect(result.state).toBe(mode === 'pass' ? 'applied' : mode === 'bad' ? 'rolled_back' : 'recovery'); expect(host.frozen).toBe(mode === 'both'); expect(supervisor.pointer().current).toBe(mode === 'pass' ? 'candidate' : 'base'); expect(await supervisor.activate(requestId, 'request')).toEqual(result);
    } finally { cleanupTestRoot(t.root, t.runId); }
  }
});
it('T34 a crash at every journal boundary recovers from signed state without restoring an old database', async () => {
  for (const phase of ['preparing', 'before_switch', 'switched', 'checking', 'verified', 'applied']) {
    const t = createTestRoot(); const host = new Host(); const requestId = randomUUID();
    try { const supervisor = new Supervisor(t.root, 'synthetic key', host, { testMode: true, crash: value => { if (value === phase) throw new InjectedSupervisorCrash(); } }); await supervisor.initialize(bundle(t.root, 'base', null, randomUUID())); await supervisor.stage(requestId, bundle(t.root, 'candidate', 'base', requestId), 'request'); await expect(supervisor.activate(requestId, 'request')).rejects.toBeInstanceOf(InjectedSupervisorCrash);
      const recovered = new Supervisor(t.root, 'synthetic key', host, { testMode: true }); const result = await recovered.recover(); expect(result.state).toBe(['verified', 'applied'].includes(phase) ? 'applied' : 'rolled_back'); expect(host.frozen).toBe(false);
    } finally { cleanupTestRoot(t.root, t.runId); }
  }
});
