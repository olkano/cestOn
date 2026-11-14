import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { canonicalJson } from '../../../packages/contracts/src/commands.js';
import type { Config } from '../../../packages/contracts/src/config.js';
import { certificationValid, installationSecrets, policyFingerprint } from '../../broker/src/certification.js';
import { fileHash } from '../../../packages/contracts/src/files.js';
import { policyHash } from './policy.js';
export const selfCertificationSchema = z.strictObject({ policyHash: z.string(), executionHash: z.string(), toolchainHash: z.string(), providerFingerprints: z.array(z.string()).min(2), checks: z.array(z.string()), verifiedAt: z.iso.datetime(), automaticUpdates: z.literal(true) });
export function selfUpdateCertified(root: string, config: Config) {
  try {
    const { record: input, signature } = JSON.parse(readFileSync(join(root, 'state/certifications/self-update.json'), 'utf8')) as { record: unknown; signature: string }; const record = selfCertificationSchema.parse(input);
    const key = installationSecrets(root).certification; const expected = createHmac('sha256', key).update('self-update:').update(canonicalJson(record)).digest(); const actual = Buffer.from(signature, 'hex');
    const profiles = config.providers.filter(p => ['codex', 'claude'].includes(p.kind) && p.profile === 'constrained');
    return actual.length === expected.length && timingSafeEqual(actual, expected) && record.policyHash === policyHash && Date.now() - Date.parse(record.verifiedAt) >= 0 && Date.now() - Date.parse(record.verifiedAt) < 30 * 86400000 && ['codex', 'claude'].every(kind => profiles.some(profile => profile.kind === kind && certificationValid(root, profile))) && profiles.map(profile => policyFingerprint(root, profile)).sort().join(',') === [...record.providerFingerprints].sort().join(',') && Boolean(config.executionHost.codexExecutable && config.executionHost.toolchainRoot) && record.executionHash === fileHash(config.executionHost.codexExecutable!) && record.toolchainHash === fileHash(join(config.executionHost.toolchainRoot!, 'package-lock.json')) && ['isolated-source', 'read-denial', 'write-denial', 'network-denial', 'before-after', 'rollback', 'coordinator-reconnect'].every(check => record.checks.includes(check));
  } catch { return false; }
}
