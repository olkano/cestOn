import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { canonicalJson } from '../../../packages/contracts/src/commands.js';
import type { ProviderConfig } from '../../../packages/contracts/src/config.js';

export function installationSecrets(root: string) {
  const path = join(root, 'state', 'ipc-secrets.json'); mkdirSync(join(root, 'state'), { recursive: true });
  if (!existsSync(path)) writeFileSync(path, JSON.stringify({ broker: randomBytes(32).toString('hex'), supervisor: randomBytes(32).toString('hex'), certification: randomBytes(32).toString('hex'), session: randomBytes(32).toString('hex') }), { mode: 0o600, flag: 'wx' });
  return JSON.parse(readFileSync(path, 'utf8')) as { broker: string; supervisor: string; certification: string; session: string };
}
export type Certification = { providerId: string; profileHash: string; version: string; runtimeHash: string; policyVersion: 1; tests: string[]; verifiedAt: string; rootOnlyReads: boolean; automaticUpdates: boolean };
export function certificationValid(root: string, provider: ProviderConfig) {
  const path = join(root, 'state', 'certifications', `${provider.id}.json`);
  if (!/^[a-zA-Z0-9_.-]+$/.test(provider.id) || !existsSync(path)) return false;
  try {
    const { record, signature } = JSON.parse(readFileSync(path, 'utf8')) as { record: Certification; signature: string };
    const key = installationSecrets(root).certification;
    const hash = createHmac('sha256', key).update(canonicalJson(record)).digest();
    const supplied = Buffer.from(signature, 'hex');
    return supplied.length === hash.length && timingSafeEqual(supplied, hash) && record.version === provider.version && record.profileHash === createHmac('sha256', key).update(canonicalJson(provider)).digest('hex') && record.policyVersion === 1 && record.tests.includes('start-resume-interrupt') && record.tests.includes('forbidden-tools') && record.runtimeHash === createHmac('sha256', key).update(readFileSync(provider.executable)).digest('hex');
  } catch { return false; }
}
