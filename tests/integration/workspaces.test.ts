import { it, expect } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WorkspaceManager } from '../../apps/broker/src/workspaces.js';
import { createTestRoot, cleanupTestRoot } from '../../packages/test-support/src/index.js';
import { projectSchema } from '../../packages/contracts/src/config.js';
it('T07 isolated document snapshots never write an unmanaged original and refuse links and forged ownership', () => {
  const t = createTestRoot();
  try {
    const original = join(t.root, 'original'); mkdirSync(original); writeFileSync(join(original, 'report.txt'), 'original'); writeFileSync(join(original, '.env'), 'SYNTHETIC_SECRET=excluded');
    const project = projectSchema.parse({ id: randomUUID(), displayName: 'Synthetic', kind: 'documents', root: original }); const taskId = randomUUID(); const scopeRevisionId = randomUUID();
    const manager = new WorkspaceManager(t.root, 'synthetic signing key'); const snapshot = manager.prepare(project, taskId, scopeRevisionId); expect(snapshot.root).not.toBe(original); expect(manager.validate(project, taskId, scopeRevisionId, snapshot.root)).toBe(true);
    writeFileSync(join(snapshot.root, 'report.txt'), 'candidate'); expect(readFileSync(join(original, 'report.txt'), 'utf8')).toBe('original'); expect(manager.prepare(project, taskId, scopeRevisionId).root).toBe(snapshot.root);
    expect(() => manager.validate(project, taskId, randomUUID(), snapshot.root)).toThrow('workspace_ownership_denied'); expect(() => readFileSync(join(snapshot.root, '.env'))).toThrow();
    symlinkSync(original, join(original, 'junction'), process.platform === 'win32' ? 'junction' : 'dir'); expect(() => manager.prepare(project, randomUUID(), randomUUID())).toThrow('workspace_link_denied');
  } finally { cleanupTestRoot(t.root, t.runId); }
});
