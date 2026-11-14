import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, createHmac, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseConfig } from '../../../packages/contracts/src/config.js';
import { canonicalJson, DomainError } from '../../../packages/contracts/src/commands.js';
import { atomicJson, fileHash } from '../../../packages/contracts/src/files.js';
import { validateDataRoot } from '../../../packages/contracts/src/paths.js';
import { createTestRoot, cleanupTestRoot, assertTestRoot } from '../../../packages/test-support/src/index.js';
import { installationSecrets, policyFingerprint, providerChecks, type Certification } from '../../broker/src/certification.js';
import { probeConfinement } from '../../broker/src/confinement.js';
import { childEnvironment } from '../../broker/src/policy/index.js';
import { runLiveCertification } from '../../../scripts/certify-provider.js';
import { dataAccess } from '../../server/src/security/access.js';
export async function certifyProvider(root: string, providerId: string, testMode = false) {
  if (process.env.CESTON_LIVE_TESTS !== '1') throw new DomainError('live_test_opt_in_required'); if (testMode) assertTestRoot(root); else { validateDataRoot(root); await dataAccess(root); }
  const config = parseConfig(JSON.parse(readFileSync(join(root, 'state/config.json'), 'utf8')), { testMode }); const profile = config.providers.find(provider => provider.id === providerId);
  if (!profile || !['codex', 'claude'].includes(profile.kind) || !profile.home || profile.profile !== 'constrained' || profile.billingMode === 'unknown' || profile.kind === 'codex' && profile.billingMode === 'metered' || profile.billingMode === 'metered' && !config.limits.spendUsd) throw new DomainError('explicit_certifiable_profile_required');
  const t = createTestRoot(); const runtime = fileHash(profile.executable); const policy = policyFingerprint(root, profile); const evidence = join(root, 'state/provider-evidence'); mkdirSync(evidence, { recursive: true }); let modelRequests = 0;
  try {
    const version = await promisify(execFile)(profile.executable, ['--version'], { env: childEnvironment(process.env), timeout: 5000, windowsHide: true, maxBuffer: 65536 }); if (!version.stdout.includes(profile.version)) throw new DomainError('provider_version_mismatch');
    const confinement = await probeConfinement(t.root, config); const project = join(t.root, 'project'); mkdirSync(project);
    const fixture = parseConfig({ ...config, projects: [{ id: randomUUID(), displayName: 'Synthetic provider certification', root: project, kind: 'documents', providerId: profile.id, operations: ['read', 'edit'] }], providers: [profile], limits: { ...config.limits, turns: 4, runMinutes: 5 }, executionHost: { ...config.executionHost, home: join(t.root, 'recipe-home') }, voice: { enabled: false }, push: { enabled: false }, updates: { requestedLocalApply: false } });
    const reports = await runLiveCertification(t.root, fixture, evidence); const report = reports[0]; modelRequests = Number(report?.requestsAccepted ?? 0);
    const checks = report?.checks as string[] | undefined; if (report?.result !== 'pass' || !checks || !['trusted-test', 'exact-resume', 'interruption', 'outside-read-denial', 'outside-write-denial', 'forbidden-tools'].every(check => checks.includes(check))) return { state: 'blocked', gate: 'native_runtime_evidence_incomplete', modelRequests, automaticUpdates: false };
    const current = parseConfig(JSON.parse(readFileSync(join(root, 'state/config.json'), 'utf8')), { testMode }).providers.find(provider => provider.id === providerId); if (canonicalJson(current) !== canonicalJson(profile) || fileHash(profile.executable) !== runtime || policyFingerprint(root, profile) !== policy) throw new DomainError('provider_changed_during_certification');
    const key = installationSecrets(root).certification; const record: Certification = { providerId, profileHash: createHmac('sha256', key).update(canonicalJson(profile)).digest('hex'), version: profile.version, runtimeHash: createHmac('sha256', key).update(readFileSync(profile.executable)).digest('hex'), policyHash: policy, policyVersion: 2, tests: [...providerChecks], verifiedAt: new Date().toISOString(), rootOnlyReads: true, automaticUpdates: false };
    atomicJson(join(root, 'state/certifications', `${providerId}.json`), { record, signature: createHmac('sha256', key).update(canonicalJson(record)).digest('hex') }); return { state: 'certified', providerId, evidenceHash: createHash('sha256').update(canonicalJson({ confinement, reports })).digest('hex'), modelRequests, sdkTurnBudget: 4, automaticUpdates: false };
  } catch (error) { const gate = error instanceof DomainError ? error.code : 'provider_certification_failed'; const record = { state: 'blocked', providerId, gate, modelRequests, automaticUpdates: false }; writeFileSync(join(evidence, `blocked-${Date.now()}-${randomUUID().slice(0, 8)}.json`), JSON.stringify(record), { flag: 'wx', mode: 0o600 }); return record; }
  finally { cleanupTestRoot(t.root, t.runId); }
}
