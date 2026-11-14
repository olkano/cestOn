import { mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { canonicalJson, DomainError } from '../../../packages/contracts/src/commands.js';
import { parseConfig } from '../../../packages/contracts/src/config.js';
import { atomicJson, copyPrimaryFile, fileHash } from '../../../packages/contracts/src/files.js';
import { createTestRoot, cleanupTestRoot, assertTestRoot } from '../../../packages/test-support/src/index.js';
import { certificationValid, installationSecrets, policyFingerprint, type Certification } from '../../broker/src/certification.js';
import { probeConfinement } from '../../broker/src/confinement.js';
import { readOwner } from '../../broker/src/registry.js';
import type { RunRef } from '../../../packages/adapters/src/types.js';
import { Store } from '../../server/src/db/store.js';
import { AuthService } from '../../server/src/auth/service.js';
import { CommandService } from '../../server/src/commands/service.js';
import { ImprovementService } from '../../server/src/updates/service.js';
import { dataAccess } from '../../server/src/security/access.js';
import { installation, initializeInstallation, localStatus } from './operations.js';
import { CandidateTools } from './candidate-tools.js';
import { publicSourceFiles, packageRelease } from './package.js';
import { verifyRelease } from './releases.js';
import { ProcessHost } from './host.js';
import { Supervisor } from './activation.js';
import { ImprovementEngine } from './improvement.js';
import { NativeUpdateWorker } from './update-worker.js';
import { policyHash } from './policy.js';
import { selfCertificationSchema } from './certification.js';

// This trusted owner operation has no fixture or arbitrary evidence-input mode.
// Its alternate validation host can activate only inside its newly owned temporary root.
export async function certifySelfUpdate(ownerRoot: string, providerId: string) {
  if (process.env.CESTON_LIVE_TESTS !== '1') throw new DomainError('live_test_opt_in_required');
  await dataAccess(ownerRoot); const owner = installation(ownerRoot); const profile = owner.config.providers.find(p => p.id === providerId);
  const profiles = owner.config.providers.filter(p => ['codex', 'claude'].includes(p.kind) && p.profile === 'constrained');
  if (!profile || !profiles.includes(profile) || !['codex', 'claude'].every(kind => profiles.some(p => p.kind === kind && certificationValid(ownerRoot, p))) || !profiles.every(p => certificationValid(ownerRoot, p))) throw new DomainError('both_native_provider_certifications_required');
  if (!owner.config.executionHost.toolchainRoot || !owner.config.executionHost.codexExecutable || profile.billingMode === 'unknown' || profile.billingMode === 'metered' && !owner.config.limits.spendUsd) throw new DomainError('explicit_certification_host_and_budget_required');
  const fingerprints = profiles.map(p => policyFingerprint(ownerRoot, p)).sort();
  const status = await localStatus(ownerRoot); if (!status.releaseId) throw new DomainError('verified_installation_required');
  const base = verifyRelease(join(ownerRoot, 'releases', status.releaseId)); const temp = createTestRoot(); const build = createTestRoot(); const workspace = createTestRoot();
  const deadline = Date.now() + 15 * 60000; const checks: string[] = []; let host: ProcessHost | undefined; let store: Store | undefined; let run: RunRef | undefined; let id = ''; let browser: import('@playwright/test').Browser | undefined;
  const key = installationSecrets(ownerRoot).certification; const evidenceDirectory = join(ownerRoot, 'state/self-update-evidence'); mkdirSync(evidenceDirectory, { recursive: true });
  const attempt = join(evidenceDirectory, `attempt-${Date.now()}-${randomUUID()}.json`); let outcome = 'incomplete';
  const setStatus = (record: { blocked: true } | { blocked: false; certificateSignature: string }) => atomicJson(join(ownerRoot, 'state/certifications/self-update-state.json'), { record, signature: createHmac('sha256', key).update('self-update-state:').update(canonicalJson(record)).digest('hex') });
  setStatus({ blocked: true }); atomicJson(join(evidenceDirectory, `${providerId}.json`), { state: 'in_progress', attempt });
  atomicJson(attempt, { providerId, stage: 'preflight', temporaryRoots: [temp.root, build.root, workspace.root], automaticPolicyChanged: false });
  let pendingProof: Record<string, unknown> | undefined; let certificate: ReturnType<typeof selfCertificationSchema.parse> | undefined;
  const signing = (value: unknown) => createHmac('sha256', key).update('self-update-evidence:').update(canonicalJson(value)).digest('hex');
  const checkTime = () => { if (Date.now() >= deadline) throw new DomainError('self_update_certification_budget_exhausted'); };
  try {
    const confinement = await probeConfinement(build.root, owner.config); checks.push('read-denial', 'write-denial', 'network-denial'); checkTime();
    const source = join(build.root, 'source'); mkdirSync(source); for (const path of publicSourceFiles(join(ownerRoot, 'releases', base.manifest.releaseId, 'source'))) { const target = join(source, path); mkdirSync(dirname(target), { recursive: true }); copyPrimaryFile(join(ownerRoot, 'releases', base.manifest.releaseId, 'source', path), target); }
    const filter = join(source, 'apps/web/src/work-filters.ts'); const original = readFileSync(filter, 'utf8'); const broken = original.replace("JSON.parse(localStorage.getItem(key(owner)) ?? 'null')", "JSON.parse('null')"); if (broken === original) throw new DomainError('certification_seed_not_supported');
    const { writeFileSync } = await import('node:fs'); writeFileSync(filter, broken); checks.push('isolated-source');
    const baselineTools = new CandidateTools(build.root, owner.config); const verified = await baselineTools.verify(source); checkTime();
    const baseline = packageRelease({ sourceRoot: source, runtimeRoot: owner.config.executionHost.toolchainRoot, output: join(build.root, 'baseline'), testEvidenceHashes: verified.hashes, npmCli: process.env.npm_execpath ?? '' });
    const listener = createServer(); await new Promise<void>(done => listener.listen(0, '127.0.0.1', done)); const address = listener.address(); if (!address || typeof address === 'string') throw new DomainError('certification_port_unavailable'); await new Promise<void>(done => listener.close(() => done()));
    mkdirSync(join(workspace.root, 'project')); const projectId = randomUUID(); const config = parseConfig({ ...owner.config, publicOrigin: undefined, listen: { port: address.port }, projects: [{ id: projectId, displayName: 'Synthetic native update acceptance', root: join(workspace.root, 'project'), kind: 'documents', providerId, operations: ['read'] }], providers: profiles, assistant: { providerId }, executionHost: { ...owner.config.executionHost, home: join(temp.root, 'staging/recipe-home') }, limits: { ...owner.config.limits, concurrency: 2, turns: 3, runMinutes: 5 }, updates: { requestedLocalApply: true }, voice: { enabled: false }, push: { enabled: false } });
    const initialized = await initializeInstallation(temp.root, baseline.root, config); id = initialized.installationId;
    // Rebind only verified baseline evidence to this disposable installation's secret.
    // Provider homes stay external and are never copied or removed.
    for (const p of profiles) { if (!certificationValid(ownerRoot, p)) throw new DomainError('provider_changed_during_certification'); const prior = JSON.parse(readFileSync(join(ownerRoot, 'state/certifications', `${p.id}.json`), 'utf8')) as { record: Certification }; const temporaryKey = installationSecrets(temp.root).certification; const record: Certification = { ...prior.record, profileHash: createHmac('sha256', temporaryKey).update(canonicalJson(p)).digest('hex'), runtimeHash: createHmac('sha256', temporaryKey).update(readFileSync(p.executable)).digest('hex'), policyHash: policyFingerprint(temp.root, p), automaticUpdates: false }; atomicJson(join(temp.root, 'state/certifications', `${p.id}.json`), { record, signature: createHmac('sha256', temporaryKey).update(canonicalJson(record)).digest('hex') }); }
    let brokerIdentity = ''; let reconnects = 0;
    class CertificationHost extends ProcessHost {
      override async validate(bundle: string) {
        assertTestRoot(this.root, temp.runId); const result = await super.validate(bundle); checkTime(); if (result.checks.some(c => c.result !== 'pass')) return result;
        const broker = await this.connectBroker(); const brokerOwner = await readOwner(temp.root, 'broker', id, installationSecrets(temp.root).broker); if (!brokerOwner || deadline - Date.now() < 60000) throw new DomainError('native_overlap_identity_or_budget_unavailable'); brokerIdentity = canonicalJson(brokerOwner);
        // Six coding turns plus this one-turn run stay below the eight-turn ceiling.
        const taskId = randomUUID(); const scopeRevisionId = randomUUID(); const managed = await broker.workspace(projectId, taskId, scopeRevisionId);
        run = (await broker.start({ commandId: randomUUID(), taskId, projectId, scopeRevisionId, providerId, root: managed.root, operations: ['read'], limits: { turns: 1, runMinutes: 1, ...(config.limits.spendUsd ? { spendUsd: config.limits.spendUsd / 4 } : {}) }, prompt: 'Synthetic coordinator replacement acceptance. Read only this empty synthetic workspace and produce a detailed plain-language explanation of why an empty workspace has no artifacts to verify. Do not write files or use external services.' })).ref;
        return { ...result, certifiedHost: confinement.result === 'pass' };
      }
      override async stopCoordinator() { checkTime(); if (run && reconnects === 0 && (await (await this.connectBroker()).reconcile(run.runId)).state !== 'running') throw new DomainError('native_overlap_not_observed'); await super.stopCoordinator(); }
      override async startCoordinator(release: string) { await super.startCoordinator(release); if (run) { const broker = await this.connectBroker(); const sessions = await broker.sessions(); if (canonicalJson(await readOwner(temp.root, 'broker', id, installationSecrets(temp.root).broker)) !== brokerIdentity || sessions.filter(s => s.runId === run!.runId && s.sessionId === run!.sessionId).length !== 1) throw new DomainError('native_reconnect_identity_changed'); reconnects++; } }
    }
    host = new CertificationHost(temp.root, id, config); const supervisor = new Supervisor(temp.root, installationSecrets(temp.root).supervisor, host); await host.startCoordinator(baseline.manifest.releaseId); await host.freeze(false);
    store = new Store(temp.root); const commands = new CommandService(store, config); const service = new ImprovementService(store, commands); const auth = new AuthService(store); const device = auth.redeem(auth.invite(), 'Synthetic native acceptance', 'loopback').device;
    commands.receive(device.id, randomUUID(), { type: 'assistant.improve', payload: { description: 'Remember the Work status filter after reload. Fix only that ordinary UI behavior.', acceptanceCriteria: ['Selecting Paused in the Work status filter remains selected after reloading the page.'], applyLocally: true } }); const update = service.list()[0]!;
    const playwright = createRequire(join(owner.config.executionHost.toolchainRoot, 'package.json'))('@playwright/test') as typeof import('@playwright/test'); browser = await playwright.chromium.launch(); const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`http://127.0.0.1:${address.port}/today`); await page.getByLabel('Pairing code').fill(auth.invite()); await page.getByLabel('Device name').fill('Synthetic native update phone'); await page.getByRole('button', { name: 'Connect device' }).click(); await page.getByRole('heading', { name: 'Today', exact: true }).waitFor(); await page.getByRole('link', { name: 'Assistant', exact: true }).click(); await page.getByLabel('Message to assistant', { exact: true }).fill('Synthetic native update unsent draft');
    const refresh = async () => { await page.reload(); await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller)); await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())?.update(); }); const refreshButton = page.getByRole('button', { name: 'Check and refresh app', exact: true }); await refreshButton.waitFor({ timeout: 15000 }); await Promise.all([page.waitForEvent('load'), refreshButton.click()]); };
    const native = new NativeUpdateWorker(temp.root, config, () => host!.connectBroker()); const boundedWorker = { async edit(...args: Parameters<typeof native.edit>) { checkTime(); const request = args[1]; const minutes = Math.floor((deadline - Date.now()) / 60000); if (minutes < 1) throw new DomainError('self_update_certification_budget_exhausted'); args[1] = { ...request, budgets: { ...request.budgets, runMinutes: Math.min(request.budgets.runMinutes, minutes), ...(request.budgets.spendUsd ? { spendUsd: request.budgets.spendUsd * .75 } : {}) } }; await native.edit(...args); checkTime(); } };
    const engine = new ImprovementEngine(service, supervisor, config, boundedWorker, new CandidateTools(temp.root, config)); await engine.tick(); checkTime(); const result = service.view(update.id);
    if (result.state !== 'applied' || !run || reconnects < 1 || (result.verification.before as { result?: string })?.result !== 'expected_failure' || (result.verification.after as { result?: string })?.result !== 'pass') throw new DomainError('native_self_update_acceptance_incomplete'); checks.push('before-after', 'coordinator-reconnect');
    await refresh(); await playwright.expect(page.getByLabel('Message to assistant', { exact: true })).toHaveValue('Synthetic native update unsent draft'); await page.getByRole('link', { name: 'Work', exact: true }).click(); await page.getByRole('combobox', { name: 'Status', exact: true }).selectOption('paused'); await page.reload(); await playwright.expect(page.getByRole('combobox', { name: 'Status', exact: true })).toHaveValue('paused');
    const acknowledgement = store.db.prepare("SELECT id,payload_hash FROM commands WHERE task_id=? AND type='assistant.improve'").all(update.taskId); const rollback = await supervisor.rollbackApplied(update.id, baseline.manifest.releaseId, randomUUID()); if (rollback.state !== 'rolled_back' || canonicalJson(acknowledgement) !== canonicalJson(store.db.prepare("SELECT id,payload_hash FROM commands WHERE task_id=? AND type='assistant.improve'").all(update.taskId)) || supervisor.pointer().current !== baseline.manifest.releaseId) throw new DomainError('native_rollback_acceptance_failed'); checks.push('rollback');
    await refresh(); await page.getByRole('link', { name: 'Assistant', exact: true }).click(); await playwright.expect(page.getByLabel('Message to assistant', { exact: true })).toHaveValue('Synthetic native update unsent draft');
    const workerVersion = await page.evaluate(async () => new Promise<string>((done, reject) => { const channel = new MessageChannel(); const timer = setTimeout(() => reject(new Error('worker_version_timeout')), 3000); channel.port1.onmessage = event => { clearTimeout(timer); done(String(event.data.version)); }; navigator.serviceWorker.controller!.postMessage({ type: 'version' }, [channel.port2]); })); if (workerVersion !== (JSON.parse(readFileSync(join(baseline.root, 'apps/web/dist/release.json'), 'utf8')) as { staticBundle: string }).staticBundle) throw new DomainError('prior_worker_not_restored');
    if (canonicalJson(profiles.map(p => policyFingerprint(ownerRoot, p)).sort()) !== canonicalJson(fingerprints) || !profiles.every(p => certificationValid(ownerRoot, p))) throw new DomainError('provider_changed_during_certification');
    const proof = { providerId, kind: profile.kind, policyHash, providerFingerprints: fingerprints, executionHash: fileHash(owner.config.executionHost.codexExecutable), toolchainHash: fileHash(join(owner.config.executionHost.toolchainRoot, 'package-lock.json')), checks, verifiedAt: new Date().toISOString(), modelTurnCeiling: 7, updateId: update.id, candidateHash: result.verification.manifestHash };
    pendingProof = proof; outcome = 'pass';
    const accepted = profiles.map(p => { try { const value = p.id === providerId ? { proof, signature: signing(proof) } : JSON.parse(readFileSync(join(evidenceDirectory, `${p.id}.json`), 'utf8')) as { proof: typeof proof; signature: string }; const expected = Buffer.from(signing(value.proof), 'hex'); const supplied = Buffer.from(value.signature, 'hex'); const age = Date.now() - Date.parse(value.proof.verifiedAt); return supplied.length === expected.length && timingSafeEqual(supplied, expected) && value.proof.providerId === p.id && value.proof.kind === p.kind && age >= 0 && age < 30 * 86400000 && value.proof.policyHash === policyHash && value.proof.executionHash === proof.executionHash && value.proof.toolchainHash === proof.toolchainHash && canonicalJson(value.proof.providerFingerprints) === canonicalJson(fingerprints) && checks.every(check => value.proof.checks.includes(check)) ? { kind: p.kind, verifiedAt: value.proof.verifiedAt } : null; } catch { return null; } });
    if (!(['codex', 'claude'] as const).every(kind => accepted.some(item => item?.kind === kind))) return { state: 'partial', providerId, gate: 'other_native_self_update_rehearsal_required', automaticUpdates: false };
    certificate = selfCertificationSchema.parse({ policyHash, executionHash: proof.executionHash, toolchainHash: proof.toolchainHash, providerFingerprints: fingerprints, checks, verifiedAt: new Date(Math.min(...accepted.filter(item => item !== null).map(item => Date.parse(item.verifiedAt)))).toISOString(), automaticUpdates: true });
    return { state: 'certified', providerId, automaticUpdates: true, policyEnabled: owner.config.updates.requestedLocalApply };
  } catch (error) { outcome = error instanceof DomainError ? error.code : 'native_acceptance_failed'; throw error; }
  finally {
    const finish = async () => {
    await browser?.close(); store?.close(); if (host) { const broker = await host.connectBroker(); if (run && !['succeeded', 'failed', 'interrupted'].includes((await broker.reconcile(run.runId)).state)) { if (!(await broker.interrupt(run.runId)).acknowledged) throw new DomainError('certification_cleanup_pending'); } await ProcessHost.prototype.stopCoordinator.call(host); await host.closeBroker(); }
    const directory = join(temp.root, 'supervisor/improvements'); const { existsSync, readdirSync } = await import('node:fs'); if (existsSync(directory)) for (const file of readdirSync(directory)) { const candidate = JSON.parse(readFileSync(join(directory, file), 'utf8')) as { root: string; runId: string }; cleanupTestRoot(dirname(candidate.root), candidate.runId); }
    cleanupTestRoot(temp.root, temp.runId); cleanupTestRoot(build.root, build.runId); cleanupTestRoot(workspace.root, workspace.runId);
    atomicJson(attempt, { providerId, outcome, checks, cleanup: true, fixtureTurns: 0, modelTurnCeiling: 7, automaticPolicyChanged: false });
    if (pendingProof) atomicJson(join(evidenceDirectory, `${providerId}.json`), { proof: pendingProof, signature: signing(pendingProof) });
    if (certificate) { const signature = createHmac('sha256', key).update('self-update:').update(canonicalJson(certificate)).digest('hex'); atomicJson(join(ownerRoot, 'state/certifications/self-update.json'), { record: certificate, signature }); setStatus({ blocked: false, certificateSignature: signature }); }
    };
    await finish().catch(error => { atomicJson(attempt, { providerId, outcome, checks, cleanup: false, temporaryRoots: [temp.root, build.root, workspace.root], certificateIssued: false }); throw error; });
  }
}
