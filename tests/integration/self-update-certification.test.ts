import { it, expect } from 'vitest';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { certifySelfUpdate } from '../../apps/supervisor/src/self-update-certification.js';
import { Store } from '../../apps/server/src/db/store.js';
import { dataAccess } from '../../apps/server/src/security/access.js';
import { atomicJson } from '../../packages/contracts/src/files.js';
import { createTestRoot, cleanupTestRoot } from '../../packages/test-support/src/index.js';
it('T31 native update certification cannot start without opt-in and both real baseline certificates', async () => {
  const before = process.env.CESTON_LIVE_TESTS; const t = createTestRoot();
  try {
    delete process.env.CESTON_LIVE_TESTS;
    await expect(certifySelfUpdate(join(t.root, 'absent'), 'fixture')).rejects.toThrow('live_test_opt_in_required');
    await dataAccess(t.root, true); const store = new Store(t.root); store.close(); atomicJson(join(t.root, 'state/config.json'), {});
    process.env.CESTON_LIVE_TESTS = '1'; await expect(certifySelfUpdate(t.root, 'fixture')).rejects.toThrow('both_native_provider_certifications_required');
    expect(existsSync(join(t.root, 'state/certifications/self-update.json'))).toBe(false);
    expect(existsSync(join(t.root, 'state/self-update-evidence'))).toBe(false);
  } finally { if (before === undefined) delete process.env.CESTON_LIVE_TESTS; else process.env.CESTON_LIVE_TESTS = before; cleanupTestRoot(t.root, t.runId); }
});
