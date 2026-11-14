import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import type { Store } from '../db/store.js';
import { canonicalJson, DomainError } from '../../../../packages/contracts/src/commands.js';

type SessionRow = { id: string; project_id: string; provider: string; provider_session_id: string; provider_home_id: string; ownership: string; observed_state: string; observed_at: number; task_id: string | null };
type Proof = { sessionId: string; providerSessionId: string; homeId: string; projectId: string; observedAt: number; expiresAt: number; nonce: string };
export class SessionOwnership {
  constructor(private store: Store, private key: string) {}
  private session(id: string) {
    const row = this.store.db.prepare('SELECT * FROM sessions WHERE id=?').get(id) as SessionRow | undefined;
    if (!row) throw new DomainError('session_not_found', 404); return row;
  }
  signStoppedOwner(sessionId: string) {
    // Live proofs must come from the authenticated broker's independent inactive-owner check.
    if (!this.store.testMode) throw new DomainError('broker_handoff_proof_required', 403);
    const source = this.session(sessionId);
    if (source.observed_state !== 'stopped') throw new DomainError('owner_unknown');
    const proof: Proof = { sessionId, providerSessionId: source.provider_session_id, homeId: source.provider_home_id, projectId: source.project_id, observedAt: source.observed_at, expiresAt: this.store.now() + 5000, nonce: randomUUID() };
    const data = Buffer.from(canonicalJson(proof)).toString('base64url');
    return `${data}.${createHmac('sha256', this.key).update(data).digest('hex')}`;
  }
  adopt(taskId: string, oldSessionId: string, newSessionId: string, signedProof: string) {
    return this.store.db.transaction(() => {
      const source = this.session(oldSessionId); const next = this.session(newSessionId); const task = this.store.taskRow(taskId);
      if (source.observed_state === 'running') throw new DomainError('owner_active');
      if (source.observed_state !== 'stopped' || this.store.now() - source.observed_at > 5000) throw new DomainError('owner_unknown');
      if (source.ownership !== 'observe_only' || next.ownership !== 'managed' || next.task_id !== taskId || source.project_id !== task.project_id || next.project_id !== task.project_id || oldSessionId === newSessionId) throw new DomainError('handoff_scope_denied', 403);
      const [data, signature] = signedProof.split('.');
      let proof: Proof;
      try {
        if (!data || !signature) throw new Error();
        const expected = createHmac('sha256', this.key).update(data).digest(); const supplied = Buffer.from(signature, 'hex');
        if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw new Error();
        proof = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as Proof;
        if (proof.sessionId !== oldSessionId || proof.providerSessionId !== source.provider_session_id || proof.homeId !== source.provider_home_id || proof.projectId !== task.project_id || proof.observedAt !== source.observed_at || proof.expiresAt <= this.store.now()) throw new Error();
      } catch { throw new DomainError('handoff_proof_required', 403); }
      this.store.db.prepare("UPDATE sessions SET ownership='handed_off',task_id=? WHERE id=?").run(taskId, oldSessionId);
      const result = { oldSessionId, newSessionId, taskId, scopeRevisionId: task.scope_revision_id };
      this.store.event(taskId, task.revision, 'session.handoff', { ...result, proofNonce: proof.nonce, strategy: 'new_managed_session' });
      return result;
    })();
  }
}
