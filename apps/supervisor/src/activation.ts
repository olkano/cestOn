import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { copyPrimaryFile, atomicJson } from '../../../packages/contracts/src/files.js';
import { canonicalJson, DomainError } from '../../../packages/contracts/src/commands.js';
import { verifyRelease } from './releases.js';
import { classifyChanges, policyHash } from './policy.js';
import { ActivationJournal } from './journal.js';
import { assertTestRoot } from '../../../packages/test-support/src/index.js';
export type Pointer = { current: string; previous: string | null; updateId: string | null; phase: 'stable' | 'checking' | 'recovery' };
export class InjectedSupervisorCrash extends Error {}
export type Validation = { checks: { name: 'verify' | 'security' | 'updates' | 'canary'; result: 'pass' | 'fail'; evidenceHash: string }[]; certifiedHost: boolean };
export interface SupervisorHost {
  validate(root: string): Promise<Validation>; freeze(frozen: boolean): Promise<void>; activeRuns(): Promise<number>; backup(): Promise<void>; capture(): Promise<string>;
  stopCoordinator(): Promise<void>; startCoordinator(releaseId: string): Promise<void>; healthy(releaseId: string): Promise<boolean>; preserved(checkpoint: string): Promise<boolean>; canary(releaseId: string): Promise<boolean>; observe(releaseId: string, milliseconds: number): Promise<boolean>;
}
type Attestation = { updateId: string; requestHash: string; candidateHash: string; baseReleaseId: string; candidateId: string; policyHash: string; evidenceHashes: string[]; createdAt: number; activationClass: string; explicitBrokerUpdate: boolean };
export class Supervisor {
  readonly journal: ActivationJournal; private busy = false;
  onProgress?: (id: string, phase: string) => void;
  constructor(readonly root: string, private key: string, private host: SupervisorHost, private options: { testMode?: boolean; crash?: (stage: string) => void } = {}) {
    if (options.testMode) assertTestRoot(root); if (options.crash && !options.testMode) throw new DomainError('test_crash_hook_denied'); mkdirSync(join(root, 'supervisor'), { recursive: true }); this.journal = new ActivationJournal(join(root, 'supervisor', 'activation.jsonl'), key);
  }
  private path(id: string) { if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}$/.test(id)) throw new DomainError('invalid_release', 400); return join(this.root, 'releases', id); }
  pointer(): Pointer { return JSON.parse(readFileSync(join(this.root, 'supervisor', 'active.json'), 'utf8')) as Pointer; }
  private setPointer(pointer: Pointer) { atomicJson(join(this.root, 'supervisor', 'active.json'), pointer); }
  private attestPath(updateId: string) { if (!/^[a-f0-9-]{36}$/.test(updateId)) throw new DomainError('invalid_update', 400); return join(this.root, 'supervisor', 'validation', `${updateId}.json`); }
  private sign(value: Attestation) { return createHmac('sha256', this.key).update('validation:').update(canonicalJson(value)).digest('hex'); }
  async initialize(bundle: string) {
    if (existsSync(join(this.root, 'supervisor', 'active.json'))) throw new DomainError('installation_already_initialized');
    const verified = verifyRelease(bundle); const target = this.path(verified.manifest.releaseId); this.copy(bundle, target, verified.hash); this.setPointer({ current: verified.manifest.releaseId, previous: null, updateId: null, phase: 'stable' });
  }
  private copy(source: string, target: string, hash: string) { if (existsSync(target)) { verifyRelease(target, hash); return; } const verified = verifyRelease(source, hash); mkdirSync(target, { recursive: true }); for (const file of [...verified.manifest.files, { path: 'release-manifest.json' }]) { const destination = join(target, file.path); mkdirSync(dirname(destination), { recursive: true }); copyPrimaryFile(join(source, file.path), destination); } verifyRelease(target, hash); }
  async stage(updateId: string, bundle: string, requestHash: string) {
    if (this.busy) throw new DomainError('update_busy'); this.busy = true;
    try {
      const candidate = verifyRelease(bundle); const pointer = this.pointer(); const base = verifyRelease(this.path(pointer.current));
      if (candidate.manifest.baseReleaseId !== pointer.current || candidate.manifest.requestId !== updateId || pointer.phase !== 'stable') throw new DomainError('stale_update_base');
      const changes = classifyChanges(base.manifest, candidate.manifest, this.path(pointer.current), bundle);
      const validation = await this.host.validate(bundle);
      if (!this.options.testMode && !validation.certifiedHost) throw new DomainError('constrained_validation_host_required', 422);
      if (['verify', 'security', 'updates', 'canary'].some(name => !validation.checks.some(check => check.name === name && check.result === 'pass')) || validation.checks.some(check => check.result !== 'pass' || !/^[a-f0-9]{64}$/.test(check.evidenceHash))) throw new DomainError('candidate_verification_failed');
      verifyRelease(bundle, candidate.hash);
      if (changes.protectedPaths.length) return { state: 'needs_authority', protectedPaths: changes.protectedPaths, changed: changes.changed };
      this.copy(bundle, this.path(candidate.manifest.releaseId), candidate.hash);
      const attestation: Attestation = { updateId, requestHash, candidateHash: candidate.hash, baseReleaseId: pointer.current, candidateId: candidate.manifest.releaseId, policyHash, evidenceHashes: validation.checks.map(check => check.evidenceHash), createdAt: Date.now(), activationClass: changes.activationClass, explicitBrokerUpdate: candidate.manifest.activationClass === 'broker' };
      atomicJson(this.attestPath(updateId), { attestation, signature: this.sign(attestation) }); return { state: 'staged', releaseId: attestation.candidateId, hash: attestation.candidateHash, changed: changes.changed };
    } finally { this.busy = false; }
  }
  private readAttestation(updateId: string, requestHash: string) {
    try { const { attestation, signature } = JSON.parse(readFileSync(this.attestPath(updateId), 'utf8')) as { attestation: Attestation; signature: string }; const actual = Buffer.from(signature, 'hex'); const expected = Buffer.from(this.sign(attestation), 'hex'); if (actual.length !== expected.length || !timingSafeEqual(actual, expected) || attestation.updateId !== updateId || attestation.requestHash !== requestHash || attestation.policyHash !== policyHash || Date.now() - attestation.createdAt > 3600000) throw new Error(); return attestation; } catch { throw new DomainError('trusted_validation_required', 403); }
  }
  async activate(updateId: string, requestHash: string) {
    if (this.busy) throw new DomainError('update_busy'); this.busy = true;
    try {
      const prior = this.pointer(); const previous = this.journal.forUpdate(updateId); if (previous.some(record => ['applied', 'rolled_back', 'recovery'].includes(record.phase))) { if (previous.at(-1)!.requestHash !== requestHash) throw new DomainError('idempotency_conflict'); return { state: previous.at(-1)!.phase, releaseId: prior.current }; }
      const authority = this.readAttestation(updateId, requestHash);
      if (prior.current !== authority.baseReleaseId || prior.phase !== 'stable') throw new DomainError('stale_update_base');
      const candidate = verifyRelease(this.path(authority.candidateId), authority.candidateHash);
      if (candidate.manifest.schemaWriteVersion !== verifyRelease(this.path(prior.current)).manifest.schemaWriteVersion) throw new DomainError('migration_compatibility_proof_required', 422);
      if ((authority.activationClass === 'broker' || authority.explicitBrokerUpdate) && await this.host.activeRuns() > 0) return { state: 'waiting_for_safe_point', releaseId: prior.current };
      await this.host.freeze(true); await this.host.backup(); let checkpoint = await this.host.capture();
      const record = (phase: string, error?: string) => { this.journal.append({ updateId, phase, current: prior.current, previous: prior.previous, candidate: authority.candidateId, candidateHash: authority.candidateHash, requestHash, checkpoint, occurredAt: Date.now(), ...(error ? { error } : {}) }); this.onProgress?.(updateId, phase); this.options.crash?.(phase); };
      record('preparing'); await this.host.stopCoordinator(); checkpoint = await this.host.capture(); record('before_switch');
      this.setPointer({ current: authority.candidateId, previous: prior.current, updateId, phase: 'checking' }); record('switched');
      try {
        await this.host.startCoordinator(authority.candidateId); record('checking');
        if (!await this.host.healthy(authority.candidateId) || !await this.host.preserved(checkpoint) || !await this.host.canary(authority.candidateId) || !await this.host.observe(authority.candidateId, 120000)) throw new DomainError('candidate_health_failed');
        record('verified'); this.setPointer({ current: authority.candidateId, previous: prior.current, updateId, phase: 'stable' }); record('applied'); await this.host.freeze(false); return { state: 'applied', releaseId: authority.candidateId };
      } catch (error) { if (error instanceof InjectedSupervisorCrash) throw error; record('rolling_back', error instanceof DomainError ? error.code : 'candidate_start_failed'); return this.rollback(prior, updateId, authority.candidateId, authority.candidateHash, requestHash, checkpoint); }
    } finally { this.busy = false; }
  }
  async rollbackApplied(updateId: string, target: string, requestHash: string) {
    if (this.busy) throw new DomainError('update_busy'); this.busy = true;
    try {
      const pointer = this.pointer(); const latest = this.journal.forUpdate(updateId).at(-1);
      if (latest?.phase === 'rolled_back' && latest.requestHash === requestHash) return { state: 'rolled_back', releaseId: pointer.current };
      if (pointer.phase !== 'stable' || pointer.updateId !== updateId || pointer.previous !== target || latest?.phase !== 'applied') throw new DomainError('stale_rollback_target');
      const current = verifyRelease(this.path(pointer.current)); const prior = verifyRelease(this.path(target));
      if (current.manifest.schemaWriteVersion !== prior.manifest.schemaWriteVersion) throw new DomainError('migration_compatibility_proof_required');
      if (classifyChanges(prior.manifest, current.manifest, this.path(target), this.path(pointer.current)).activationClass === 'broker' && await this.host.activeRuns() > 0) throw new DomainError('rollback_waiting_for_safe_point');
      await this.host.freeze(true); await this.host.backup(); await this.host.stopCoordinator(); const checkpoint = await this.host.capture();
      this.journal.append({ updateId, phase: 'rolling_back', current: target, previous: null, candidate: pointer.current, candidateHash: current.hash, requestHash, checkpoint, occurredAt: Date.now() });
      return this.rollback({ current: target, previous: null, updateId, phase: 'stable' }, updateId, pointer.current, current.hash, requestHash, checkpoint);
    } finally { this.busy = false; }
  }
  private async rollback(prior: Pointer, updateId: string, candidate: string, candidateHash: string, requestHash: string, checkpoint?: string) {
    try { await this.host.freeze(true); await this.host.stopCoordinator(); verifyRelease(this.path(prior.current)); this.setPointer({ ...prior, updateId, phase: 'checking' }); await this.host.startCoordinator(prior.current); if (!await this.host.healthy(prior.current) || checkpoint && !await this.host.preserved(checkpoint)) throw new DomainError('rollback_health_failed'); this.setPointer({ ...prior, updateId, phase: 'stable' }); this.journal.append({ updateId, phase: 'rolled_back', current: prior.current, previous: prior.previous, candidate, candidateHash, requestHash, occurredAt: Date.now() }); await this.host.freeze(false); return { state: 'rolled_back', releaseId: prior.current }; }
    catch { this.setPointer({ ...prior, updateId, phase: 'recovery' }); this.journal.append({ updateId, phase: 'recovery', current: prior.current, previous: prior.previous, candidate, candidateHash, requestHash, occurredAt: Date.now(), error: 'rollback_failed' }); return { state: 'recovery', releaseId: prior.current }; }
  }
  markRecovery() { const pointer = this.pointer(); this.setPointer({ ...pointer, phase: 'recovery' }); }
  async recover(retryFrozen = false) {
    const pointer = this.pointer(); const latest = this.journal.latest();
    if (!latest) {
      if (pointer.phase === 'recovery' && retryFrozen) { await this.host.freeze(true); const checkpoint = await this.host.capture(); try { verifyRelease(this.path(pointer.current)); await this.host.stopCoordinator(); await this.host.startCoordinator(pointer.current); if (!await this.host.healthy(pointer.current) || !await this.host.preserved(checkpoint) || !await this.host.canary(pointer.current)) throw new DomainError('recovery_health_failed'); this.setPointer({ ...pointer, phase: 'stable' }); await this.host.freeze(false); return { state: 'stable', releaseId: pointer.current }; } catch { return { state: 'recovery', releaseId: pointer.current }; } }
      return { state: pointer.phase, releaseId: pointer.current };
    }
    try { verifyRelease(this.path(pointer.current), pointer.current === latest.candidate ? latest.candidateHash : undefined); } catch { await this.host.freeze(true); return this.rollback({ current: latest.current, previous: latest.previous, updateId: latest.updateId, phase: 'stable' }, latest.updateId, latest.candidate, latest.candidateHash, latest.requestHash, latest.checkpoint); }
    if (latest.phase === 'applied' && pointer.current === latest.candidate && await this.host.healthy(pointer.current)) { await this.host.freeze(false); return { state: 'applied', releaseId: pointer.current }; }
    if (latest.phase === 'recovery' && retryFrozen) return this.rollback({ current: latest.current, previous: latest.previous, updateId: latest.updateId, phase: 'stable' }, latest.updateId, latest.candidate, latest.candidateHash, latest.requestHash, latest.checkpoint);
    if (['rolled_back', 'recovery'].includes(latest.phase)) return { state: latest.phase, releaseId: pointer.current };
    if (latest.phase === 'verified' && pointer.current === latest.candidate && await this.host.healthy(pointer.current)) { this.setPointer({ ...pointer, phase: 'stable' }); this.journal.append({ ...latest, phase: 'applied', occurredAt: Date.now() }); await this.host.freeze(false); return { state: 'applied', releaseId: pointer.current }; }
    return this.rollback({ current: latest.current, previous: latest.previous, updateId: latest.updateId, phase: 'stable' }, latest.updateId, latest.candidate, latest.candidateHash, latest.requestHash, latest.checkpoint);
  }
  newRequestId() { return randomUUID(); }
}
