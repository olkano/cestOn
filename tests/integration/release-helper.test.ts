import { it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { inventory, verifyRelease } from '../../apps/supervisor/src/releases.js';
import { atomicJson, fileHash } from '../../packages/contracts/src/files.js';
import { createTestRoot, cleanupTestRoot } from '../../packages/test-support/src/index.js';
it('T32 the exact packaged compiler helper is permitted while an unrelated PowerShell executable remains denied', () => {
  const t = createTestRoot();
  try {
    mkdirSync(join(t.root, 'scripts')); writeFileSync(join(t.root, 'scripts/windows-compile.ps1'), 'Synthetic inventory, never executed'); writeFileSync(join(t.root, 'package-lock.json'), '{}');
    const manifest = () => atomicJson(join(t.root, 'release-manifest.json'), { releaseId: 'synthetic', sourceRevision: 'fixture', sourceSnapshotHash: 'a'.repeat(64), createdAt: new Date().toISOString(), requestId: randomUUID(), baseReleaseId: null, files: inventory(t.root), nodeMajor: 24, lockfileHash: fileHash(join(t.root, 'package-lock.json')), apiProtocol: 1, brokerProtocolRange: [1, 1], schemaReadRange: [3, 3], schemaWriteVersion: 3, migrationIds: [1, 2, 3], testEvidenceHashes: [], activationClass: 'manual' });
    manifest(); expect(verifyRelease(t.root).manifest.releaseId).toBe('synthetic');
    writeFileSync(join(t.root, 'scripts/arbitrary.ps1'), 'Synthetic forbidden executable'); manifest(); expect(() => verifyRelease(t.root)).toThrow('release_executable_denied');
  } finally { cleanupTestRoot(t.root, t.runId); }
});
