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
const stateSchema = z.discriminatedUnion('blocked', [z.strictObject({ blocked: z.literal(true) }), z.strictObject({ blocked: z.literal(false), certificateSignature: z.string().regex(/^[a-f0-9]{64}$/) })]);
export function selfUpdateCertified(root: string, config: Config) {
  try {
    const { record: input, signature } = JSON.parse(readFileSync(join(root, 'state/certifications/self-update.json'), 'utf8')) as { record: unknown; signature: string }; const record = selfCertificationSchema.parse(input);
    const key = installationSecrets(root).certification; const expected = createHmac('sha256', key).update('self-update:').update(canonicalJson(record)).digest(); const actual = Buffer.from(signature, 'hex');
    const state = JSON.parse(readFileSync(join(root, 'state/certifications/self-update-state.json'), 'utf8')) as { record: unknown; signature: string }; const status = stateSchema.parse(state.record); const stateHash = createHmac('sha256', key).update('self-update-state:').update(canonicalJson(status)).digest(); const supplied = Buffer.from(state.signature, 'hex');
    if (supplied.length !== stateHash.length || !timingSafeEqual(supplied, stateHash) || status.blocked || status.certificateSignature !== signature) return false;
    const profiles = config.providers.filter(p => ['codex', 'claude'].includes(p.kind) && p.profile === 'constrained');
    return actual.length === expected.length && timingSafeEqual(actual, expected) && record.policyHash === policyHash && Date.now() - Date.parse(record.verifiedAt) >= 0 && Date.now() - Date.parse(record.verifiedAt) < 30 * 86400000 && ['codex', 'claude'].every(kind => profiles.some(profile => profile.kind === kind && certificationValid(root, profile))) && profiles.map(profile => policyFingerprint(root, profile)).sort().join(',') === [...record.providerFingerprints].sort().join(',') && Boolean(config.executionHost.codexExecutable && config.executionHost.toolchainRoot) && record.executionHash === fileHash(config.executionHost.codexExecutable!) && record.toolchainHash === fileHash(join(config.executionHost.toolchainRoot!, 'package-lock.json')) && ['isolated-source', 'read-denial', 'write-denial', 'network-denial', 'before-after', 'rollback', 'coordinator-reconnect'].every(check => record.checks.includes(check));
  } catch { return false; }
}
