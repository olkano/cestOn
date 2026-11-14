import { readFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { DomainError } from '../../../packages/contracts/src/commands.js';
import { copyPrimaryFile, atomicJson, fileHash } from '../../../packages/contracts/src/files.js';
import { createTestRoot, assertTestRoot } from '../../../packages/test-support/src/index.js';
import { publicSourceFiles, sourceSnapshot } from './package.js';
import { verifyRelease } from './releases.js';
import { classifyChanges } from './policy.js';
import { Supervisor } from './activation.js';
import { ImprovementService } from '../../server/src/updates/service.js';
import type { Config } from '../../../packages/contracts/src/config.js';
import type { ReleaseManifest } from '../../../packages/contracts/src/release.js';
import { setTimeout as delay } from 'node:timers/promises';
export type ImprovementRequest = ReturnType<ImprovementService['request']>;
export interface ImprovementWorker { edit(root: string, request: ImprovementRequest, stage: 'regression' | 'implementation', regression: string): Promise<void>; }
export interface ImprovementTools {
  regression(root: string, path: string): Promise<{ exitCode: number; failure: 'assertion' | 'infrastructure' | null; hash: string }>;
  verify(root: string): Promise<{ hashes: string[] }>;
  bundle(root: string, updateId: string, base: string, evidence: string[]): Promise<{ root: string; manifest: ReleaseManifest; hash: string }>;
}
type Candidate = { root: string; runId: string; baseHash: string; regression: string; regressionHash?: string; bundle?: string };
export class ImprovementEngine {
  private busy = false;
  async idle() { while (this.busy) await delay(100); }
  running() { return this.busy; }
  constructor(private service: ImprovementService, private supervisor: Supervisor, private config: Config, private worker: ImprovementWorker, private tools: ImprovementTools) { supervisor.onProgress = (id, phase) => { const row = this.service.row(id); if (phase === 'checking' && row.state === 'activating') this.service.transition(id, 'checking'); if (phase === 'rolling_back' && ['activating', 'checking'].includes(row.state)) this.service.transition(id, 'rolling_back'); }; }
  async tick() {
    if (this.busy) return; const ids = this.service.store.db.prepare("SELECT id FROM updates WHERE state IN ('requested','reproducing','implementing','verifying','staged','waiting_for_safe_point','activating','checking','rolling_back') ORDER BY created_at,id").all() as { id: string }[]; const next = ids.map(row => this.service.view(row.id)).find(update => update.state !== 'staged' || update.applyLocally && this.config.updates.requestedLocalApply); if (!next || this.service.store.installation().dispatch_paused && next.state === 'requested') return;
    this.busy = true;
    try { await this.run(next.id); }
    finally { this.busy = false; }
  }
  private metadata(id: string) { return join(this.supervisor.root, 'supervisor', 'improvements', `${id}.json`); }
  private candidate(id: string): Candidate { const value = JSON.parse(readFileSync(this.metadata(id), 'utf8')) as Candidate; assertTestRoot(dirname(value.root), value.runId); if (join(dirname(value.root), 'source') !== value.root) throw new DomainError('candidate_path_denied'); return value; }
  private prepare(id: string) {
    const row = this.service.row(id); const pointer = this.supervisor.pointer(); if (row.base_release !== pointer.current || pointer.phase !== 'stable') throw new DomainError('stale_update_base');
    const base = verifyRelease(join(this.supervisor.root, 'releases', pointer.current)); const source = join(this.supervisor.root, 'releases', pointer.current, 'source'); if (sourceSnapshot(source) !== base.manifest.sourceSnapshotHash) throw new DomainError('base_source_integrity_failed');
    const t = createTestRoot(); const root = join(t.root, 'source'); mkdirSync(root); for (const file of publicSourceFiles(source)) { const destination = join(root, file); mkdirSync(dirname(destination), { recursive: true }); copyPrimaryFile(join(source, file), destination); }
    const candidate: Candidate = { root, runId: t.runId, baseHash: base.hash, regression: `tests/e2e/update-${id}.spec.ts` }; atomicJson(this.metadata(id), candidate); return candidate;
  }
  private changed(candidate: Candidate, base: ReleaseManifest) {
    const files = publicSourceFiles(candidate.root).map(path => ({ path: `source/${path}`, size: statSync(join(candidate.root, path)).size, sha256: fileHash(join(candidate.root, path)) }));
    const manifest = { ...base, files: [...base.files.filter(file => !file.path.startsWith('source/')), ...files] }; return classifyChanges(base, manifest, join(this.supervisor.root, 'releases', base.releaseId), dirname(candidate.root));
  }
  async run(id: string) {
    const service = this.service; let row = service.row(id); const request = service.request(id);
    try {
      const rollback = (JSON.parse(row.verification_json) as { rollbackRequest?: { target: string; requestHash: string } }).rollbackRequest;
      if (row.state === 'rolling_back' && rollback) { const result = await this.supervisor.rollbackApplied(id, rollback.target, rollback.requestHash); service.transition(id, result.state === 'rolled_back' ? 'rolled_back' : 'failed', { activeRelease: result.releaseId }, result.state === 'rolled_back' ? null : 'frozen_recovery_required'); return; }
      if (['activating', 'checking', 'rolling_back'].includes(row.state)) { const recovered = this.supervisor.journal.forUpdate(id).length ? await this.supervisor.recover() : await this.supervisor.activate(id, request.requestHash); if (recovered.state === 'applied' && this.supervisor.pointer().updateId === id && row.state !== 'rolling_back') service.transition(id, 'applied', { activeRelease: recovered.releaseId }); else { if (service.row(id).state !== 'rolling_back') service.transition(id, 'rolling_back'); service.transition(id, recovered.state === 'rolled_back' ? 'rolled_back' : 'failed', {}, recovered.state === 'recovery' ? 'frozen_recovery_required' : 'activation_reconciliation_required'); } return; }
      if (['reproducing', 'implementing', 'verifying'].includes(row.state)) throw new DomainError('interrupted_improvement_requires_reconciliation');
      if (row.state === 'requested') {
        if (row.base_release === 'development') throw new DomainError('verified_installation_required');
        const candidate = this.prepare(id); const base = verifyRelease(join(this.supervisor.root, 'releases', row.base_release), candidate.baseHash);
        service.transition(id, 'reproducing', { baseSourceHash: base.manifest.sourceSnapshotHash, regression: candidate.regression });
        await this.worker.edit(candidate.root, request, 'regression', candidate.regression);
        const first = this.changed(candidate, base.manifest); if (first.changed.length !== 1 || first.changed[0] !== candidate.regression || !existsSync(join(candidate.root, candidate.regression))) throw new DomainError('regression_scope_denied');
        candidate.regressionHash = fileHash(join(candidate.root, candidate.regression)); atomicJson(this.metadata(id), candidate);
        const before = await this.tools.regression(candidate.root, candidate.regression); if (before.exitCode === 0 || before.failure !== 'assertion') throw new DomainError(before.exitCode === 0 ? 'regression_not_reproduced' : 'regression_infrastructure_failed');
        service.transition(id, 'implementing', { before: { result: 'expected_failure', evidenceHash: before.hash }, regressionHash: candidate.regressionHash });
        await this.worker.edit(candidate.root, request, 'implementation', candidate.regression);
        if (fileHash(join(candidate.root, candidate.regression)) !== candidate.regressionHash) throw new DomainError('regression_changed_by_worker');
        const changes = this.changed(candidate, base.manifest); if (changes.protectedPaths.length) { service.transition(id, 'needs_authority', { protectedPaths: changes.protectedPaths, changed: changes.changed }, 'protected_change'); return; }
        service.transition(id, 'verifying', { changed: changes.changed }); const after = await this.tools.regression(candidate.root, candidate.regression); if (after.exitCode !== 0 || after.failure) throw new DomainError('regression_still_fails'); const verified = await this.tools.verify(candidate.root);
        const bundle = await this.tools.bundle(candidate.root, id, row.base_release, [before.hash, after.hash, ...verified.hashes]); candidate.bundle = bundle.root; atomicJson(this.metadata(id), candidate);
        service.store.db.prepare('UPDATE updates SET candidate_release=?,artifact_hash=? WHERE id=?').run(bundle.manifest.releaseId, bundle.hash, id);
        const staged = await this.supervisor.stage(id, bundle.root, request.requestHash); if (staged.state === 'needs_authority') { service.transition(id, 'needs_authority', staged, 'protected_change'); return; }
        service.transition(id, 'staged', { after: { result: 'pass', evidenceHash: after.hash }, manifestHash: bundle.hash, checks: verified.hashes }); row = service.row(id);
      }
      if (['staged', 'waiting_for_safe_point'].includes(row.state)) {
        if (!request.applyLocally || !this.config.updates.requestedLocalApply) return;
        const candidate = this.candidate(id); if (!candidate.bundle) throw new DomainError('candidate_missing'); verifyRelease(candidate.bundle, row.artifact_hash!);
        service.transition(id, 'activating'); const active = await this.supervisor.activate(id, request.requestHash);
        if (active.state === 'waiting_for_safe_point') { service.transition(id, 'waiting_for_safe_point', { activeRelease: active.releaseId }); return; }
        if (active.state === 'applied') { if (service.row(id).state === 'activating') service.transition(id, 'checking'); service.transition(id, 'applied', { activeRelease: active.releaseId, rollbackAvailable: true }); } else { if (service.row(id).state !== 'rolling_back') service.transition(id, 'rolling_back'); service.transition(id, active.state === 'rolled_back' ? 'rolled_back' : 'failed', {}, active.state === 'recovery' ? 'frozen_recovery_required' : null); }
      }
    } catch (error) { const state = service.row(id).state; if (!['applied', 'rolled_back', 'failed', 'needs_authority'].includes(state)) service.transition(id, 'failed', {}, error instanceof DomainError ? error.code : 'candidate_operation_failed'); }
  }
}
export function improvementHash(value: string) { return createHash('sha256').update(value).digest('hex'); }
