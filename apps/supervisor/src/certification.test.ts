import { it, expect } from 'vitest';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { createTestRoot, cleanupTestRoot } from '../../../packages/test-support/src/index.js';
import { parseConfig } from '../../../packages/contracts/src/config.js';
import { canonicalJson } from '../../../packages/contracts/src/commands.js';
import { atomicJson, fileHash } from '../../../packages/contracts/src/files.js';
import { certificationValid, installationSecrets, policyFingerprint, providerChecks } from '../../broker/src/certification.js';
import { selfUpdateCertified } from './certification.js';
import { policyHash } from './policy.js';
it('T32 signed self-update metadata expires and cannot survive forgery, missing native baseline evidence or changed toolchain bytes', () => {
  const t = createTestRoot();
  try {
    const executable = join(t.root, 'synthetic-executable'); writeFileSync(executable, 'Synthetic certificate metadata test, never executed'); writeFileSync(join(t.root, 'package-lock.json'), '{}');
    const config = parseConfig({ providers: ['codex', 'claude'].map(kind => ({ id: kind, kind, executable, version: 'synthetic', profile: 'constrained', billingMode: 'subscription', home: join(t.root, kind) })), executionHost: { codexExecutable: executable, toolchainRoot: t.root } });
    const key = installationSecrets(t.root).certification; mkdirSync(join(t.root, 'state/certifications'));
    const sign = (record: unknown) => createHmac('sha256', key).update(canonicalJson(record)).digest('hex');
    for (const profile of config.providers) { const record = { providerId: profile.id, profileHash: createHmac('sha256', key).update(canonicalJson(profile)).digest('hex'), version: profile.version, runtimeHash: createHmac('sha256', key).update(readFileSync(executable)).digest('hex'), policyHash: policyFingerprint(t.root, profile), policyVersion: 2, tests: [...providerChecks], verifiedAt: new Date().toISOString(), rootOnlyReads: true, automaticUpdates: false }; atomicJson(join(t.root, 'state/certifications', `${profile.id}.json`), { record, signature: sign(record) }); expect(certificationValid(t.root, profile)).toBe(true); }
    const record = { policyHash, executionHash: fileHash(executable), toolchainHash: fileHash(join(t.root, 'package-lock.json')), providerFingerprints: config.providers.map(p => policyFingerprint(t.root, p)), checks: ['isolated-source', 'read-denial', 'write-denial', 'network-denial', 'before-after', 'rollback', 'coordinator-reconnect'], verifiedAt: new Date().toISOString(), automaticUpdates: true as const };
    const target = join(t.root, 'state/certifications/self-update.json'); const save = (value = record) => { const signature = createHmac('sha256', key).update('self-update:').update(canonicalJson(value)).digest('hex'); atomicJson(target, { record: value, signature }); const status = { blocked: false, certificateSignature: signature }; atomicJson(join(t.root, 'state/certifications/self-update-state.json'), { record: status, signature: createHmac('sha256', key).update('self-update-state:').update(canonicalJson(status)).digest('hex') }); }; save(); expect(selfUpdateCertified(t.root, config)).toBe(true);
    const suspension = { blocked: true }; atomicJson(join(t.root, 'state/certifications/self-update-state.json'), { record: suspension, signature: createHmac('sha256', key).update('self-update-state:').update(canonicalJson(suspension)).digest('hex') }); expect(selfUpdateCertified(t.root, config)).toBe(false); save(); expect(selfUpdateCertified(t.root, config)).toBe(true);
    atomicJson(target, { record, signature: '00'.repeat(32) }); expect(selfUpdateCertified(t.root, config)).toBe(false);
    save({ ...record, verifiedAt: new Date(Date.now() - 31 * 86400000).toISOString() }); expect(selfUpdateCertified(t.root, config)).toBe(false); save();
    const baseline = readFileSync(join(t.root, 'state/certifications/claude.json')); atomicJson(join(t.root, 'state/certifications/claude.json'), {}); expect(selfUpdateCertified(t.root, config)).toBe(false); writeFileSync(join(t.root, 'state/certifications/claude.json'), baseline); expect(selfUpdateCertified(t.root, config)).toBe(true);
    writeFileSync(join(t.root, 'package-lock.json'), '{"changed":true}'); expect(selfUpdateCertified(t.root, config)).toBe(false);
  } finally { cleanupTestRoot(t.root, t.runId); }
});
