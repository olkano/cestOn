import { it, expect } from 'vitest';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createTestRoot, cleanupTestRoot } from '../../packages/test-support/src/index.js';
import { inventory } from '../../apps/supervisor/src/releases.js';
import { atomicJson, fileHash } from '../../packages/contracts/src/files.js';
import { pruneReleases } from '../../apps/supervisor/src/release-retention.js';
it('T25 release cleanup preserves current, rollback, pending, unknown and credential-bearing directories', () => {
  const t = createTestRoot();
  try { for (let index = 0; index < 6; index++) { const root = join(t.root, 'releases', `release${index}`); mkdirSync(root, { recursive: true }); writeFileSync(join(root, 'package-lock.json'), '{}'); if (index === 1) writeFileSync(join(root, 'synthetic.key'), 'synthetic protected material'); atomicJson(join(root, 'release-manifest.json'), { releaseId: `release${index}`, sourceRevision: 'synthetic', sourceSnapshotHash: 'a'.repeat(64), createdAt: new Date(Date.now() - (6 - index) * 1000).toISOString(), requestId: randomUUID(), baseReleaseId: null, files: inventory(root), nodeMajor: 24, lockfileHash: fileHash(join(root, 'package-lock.json')), apiProtocol: 1, brokerProtocolRange: [1, 1], schemaReadRange: [3, 3], schemaWriteVersion: 3, migrationIds: [1, 2, 3], testEvidenceHashes: [], activationClass: 'manual' }); } mkdirSync(join(t.root, 'releases/unknown')); const pinned = ['release5', 'release4', 'release0']; expect(pruneReleases(t.root, 3, pinned).removed).toEqual(['release2']); expect(existsSync(join(t.root, 'releases/release2'))).toBe(true); const result = pruneReleases(t.root, 3, pinned, false); expect(result.removed).toEqual(['release2']); expect(result.blocked).toContain('release1'); expect(result.blocked).toContain('unknown'); for (const id of pinned) expect(existsSync(join(t.root, 'releases', id))).toBe(true); }
  finally { cleanupTestRoot(t.root, t.runId); }
});
