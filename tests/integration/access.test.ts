import { it, expect } from 'vitest';
import { dataAccess } from '../../apps/server/src/security/access.js';
import { createTestRoot, cleanupTestRoot } from '../../packages/test-support/src/index.js';
it('T27 data root protection reads back owner-only access under the current OS identity', async () => { const t = createTestRoot(); try { expect(await dataAccess(t.root, true)).toEqual({ ownerOnly: true }); expect(await dataAccess(t.root)).toEqual({ ownerOnly: true }); } finally { cleanupTestRoot(t.root, t.runId); } });
