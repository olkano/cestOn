import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { canonicalJson } from '../../../packages/contracts/src/commands.js';
import type { ProviderConfig } from '../../../packages/contracts/src/config.js';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { release } from 'node:os';

export function installationSecrets(root: string) {
  const path = join(root, 'state', 'ipc-secrets.json'); mkdirSync(join(root, 'state'), { recursive: true });
  if (!existsSync(path)) writeFileSync(path, JSON.stringify({ broker: randomBytes(32).toString('hex'), supervisor: randomBytes(32).toString('hex'), certification: randomBytes(32).toString('hex'), session: randomBytes(32).toString('hex') }), { mode: 0o600, flag: 'wx' });
  return JSON.parse(readFileSync(path, 'utf8')) as { broker: string; supervisor: string; certification: string; session: string };
}
export type Certification = { providerId: string; profileHash: string; version: string; runtimeHash: string; policyHash: string; policyVersion: 2; tests: string[]; verifiedAt: string; rootOnlyReads: boolean; automaticUpdates: boolean };
export const providerChecks = ['start-resume-interrupt', 'forbidden-tools', 'outside-read-denial', 'outside-write-denial', 'trusted-test', 'execution-host-denial'] as const;
export function policyFingerprint(root: string, provider: ProviderConfig) {
  const key = installationSecrets(root).certification; const hash = createHmac('sha256', key).update('execution-policy-v2');
  hash.update(process.version).update(process.platform).update(process.arch).update(release());
  for (const relative of ['./runtime.js', './update-worker.js', './update-grants.js', './confinement.js', './windows-environment.js', '../../supervisor/src/self-update-certification.js', './workspaces.js', './recipes.js', './policy/index.js', '../../../packages/contracts/src/paths.js', '../../../packages/adapters/src/codex/permissions.js', '../../../packages/adapters/src/codex/index.js', '../../../packages/adapters/src/claude/index.js']) {
    const compiled = fileURLToPath(new URL(relative, import.meta.url)); const file = existsSync(compiled) ? compiled : compiled.replace(/\.js$/, '.ts'); hash.update(relative).update(readFileSync(file));
  }
  if (provider.kind === 'claude') { const require = createRequire(import.meta.url); hash.update(readFileSync(require.resolve('@anthropic-ai/claude-agent-sdk'))); }
  if (process.platform === 'win32') for (const name of ['windows-access.ps1', 'windows-compile.ps1', 'windows-mutex.ps1', 'windows-pipe-host.ps1', 'os-protect.ps1']) hash.update(name).update(readFileSync(resolve('scripts', name)));
  if (provider.home) for (const name of ['config.toml', 'settings.json', 'settings.local.json', '.claude.json']) { const path = join(provider.home, name); hash.update(name).update(existsSync(path) ? readFileSync(path) : 'absent'); }
  return hash.digest('hex');
}
export function certificationValid(root: string, provider: ProviderConfig) {
  const path = join(root, 'state', 'certifications', `${provider.id}.json`);
  if (!/^[a-zA-Z0-9_.-]+$/.test(provider.id) || !existsSync(path)) return false;
  try {
    const { record, signature } = JSON.parse(readFileSync(path, 'utf8')) as { record: Certification; signature: string };
    const key = installationSecrets(root).certification;
    const hash = createHmac('sha256', key).update(canonicalJson(record)).digest();
    const supplied = Buffer.from(signature, 'hex');
    const age = Date.now() - Date.parse(record.verifiedAt);
    return Number.isFinite(age) && age >= 0 && age < 30 * 86400000 && supplied.length === hash.length && timingSafeEqual(supplied, hash) && record.providerId === provider.id && record.version === provider.version && record.profileHash === createHmac('sha256', key).update(canonicalJson(provider)).digest('hex') && record.policyVersion === 2 && record.rootOnlyReads === true && record.policyHash === policyFingerprint(root, provider) && providerChecks.every(check => record.tests.includes(check)) && record.runtimeHash === createHmac('sha256', key).update(readFileSync(provider.executable)).digest('hex');
  } catch { return false; }
}
