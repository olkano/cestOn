import { it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { certificationValid, policyFingerprint, installationSecrets, providerChecks, type Certification } from './certification.js';
import { canonicalJson } from '../../../packages/contracts/src/commands.js';
import { providerSchema } from '../../../packages/contracts/src/config.js';
import { createTestRoot, cleanupTestRoot } from '../../../packages/test-support/src/index.js';
it('runtime certificates bind native bytes, installed policy code and managed-home settings', () => {
  const t = createTestRoot();
  try { const home = join(t.root, 'home'); mkdirSync(home); const executable = join(t.root, 'synthetic-runtime'); writeFileSync(executable, 'synthetic executable bytes'); const provider = providerSchema.parse({ id: 'synthetic', kind: 'codex', executable, version: '0.160.0', home, profile: 'constrained' }); const key = installationSecrets(t.root).certification;
    const record: Certification = { providerId: provider.id, profileHash: createHmac('sha256', key).update(canonicalJson(provider)).digest('hex'), version: provider.version, runtimeHash: createHmac('sha256', key).update('synthetic executable bytes').digest('hex'), policyHash: policyFingerprint(t.root, provider), policyVersion: 2, tests: [...providerChecks], verifiedAt: new Date().toISOString(), rootOnlyReads: true, automaticUpdates: false };
    mkdirSync(join(t.root, 'state/certifications')); writeFileSync(join(t.root, 'state/certifications/synthetic.json'), JSON.stringify({ record, signature: createHmac('sha256', key).update(canonicalJson(record)).digest('hex') })); expect(certificationValid(t.root, provider)).toBe(true);
    const now = Date.now; Date.now = () => now() + 31 * 86400000; try { expect(certificationValid(t.root, provider)).toBe(false); } finally { Date.now = now; }
    writeFileSync(join(home, 'config.toml'), 'changed = true'); expect(certificationValid(t.root, provider)).toBe(false);
  } finally { cleanupTestRoot(t.root, t.runId); }
});
