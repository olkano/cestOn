import { it, expect } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { archiveRelease, verifyArchive } from '../../scripts/zip.js';
import { inventory } from '../../apps/supervisor/src/releases.js';
import { atomicJson, fileHash } from '../../packages/contracts/src/files.js';
import { createTestRoot, cleanupTestRoot } from '../../packages/test-support/src/index.js';
it('T36 a portable ZIP reads back every manifest byte and refuses corrupted compressed content', async () => {
  const t = createTestRoot();
  try { const bundle = join(t.root, 'bundle'); mkdirSync(bundle); writeFileSync(join(bundle, 'package-lock.json'), '{}'); writeFileSync(join(bundle, 'artifact.txt'), 'Synthetic archive content'.repeat(100)); atomicJson(join(bundle, 'release-manifest.json'), { releaseId: 'synthetic', sourceRevision: 'fixture', sourceSnapshotHash: 'a'.repeat(64), createdAt: new Date().toISOString(), requestId: randomUUID(), baseReleaseId: null, files: inventory(bundle), nodeMajor: 24, lockfileHash: fileHash(join(bundle, 'package-lock.json')), apiProtocol: 1, brokerProtocolRange: [1, 1], schemaReadRange: [3, 3], schemaWriteVersion: 3, migrationIds: [1, 2, 3], testEvidenceHashes: [], activationClass: 'manual' }); const archive = join(t.root, 'bundle.zip'); await archiveRelease(bundle, archive); expect((await verifyArchive(bundle, archive)).files).toBe(3); const bytes = readFileSync(archive); bytes[50] = bytes[50]! ^ 1; writeFileSync(archive, bytes); await expect(verifyArchive(bundle, archive)).rejects.toThrow();
  } finally { cleanupTestRoot(t.root, t.runId); }
});
