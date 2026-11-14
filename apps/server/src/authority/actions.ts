import { randomUUID } from 'node:crypto';
import type { Store } from '../db/store.js';
import type { CommandService } from '../commands/service.js';
import { DomainError } from '../../../../packages/contracts/src/commands.js';

export interface ActionAdapter {
  read(target: unknown): Promise<unknown>;
  write(target: unknown, proposed: unknown, actionId: string): Promise<void>;
  reconcile(target: unknown, actionId: string): Promise<'applied' | 'not_executed' | 'uncertain'>;
}
type Approval = { id: string; task_id: string; revision: number; target_json: string; current_hash: string; proposed_hash: string; effects_json: string; verification_json: string; expires_at: number; approved_command_id: string | null; state: string; scope_revision_id: string };
export class ActionService {
  private busy = false;
  constructor(private store: Store, commands: CommandService, private adapters: Map<string, ActionAdapter>) {
    commands.hooks.set('action.approve', (command, id, task) => {
      if (command.type !== 'action.approve' || !task) throw new DomainError('invalid_action');
      const approval = this.approval(command.payload.approvalId);
      if (approval.task_id !== task.id || approval.revision !== command.payload.revision || approval.proposed_hash !== command.payload.proposedHash || approval.scope_revision_id !== task.scope_revision_id || approval.expires_at <= this.store.now() || approval.state !== 'open') throw new DomainError('stale_action');
      if (!this.store.getTask(task.id).scope.operations.includes('external.write')) throw new DomainError('scope_denied', 403);
      this.store.db.prepare("UPDATE action_approvals SET state='approved',approved_command_id=? WHERE id=?").run(id, approval.id);
      this.store.event(task.id, task.revision, 'action.changed', { approvalId: approval.id, state: 'approved' });
      return { dispatch: true };
    });
  }
  private approval(id: string) { const row = this.store.db.prepare('SELECT * FROM action_approvals WHERE id=?').get(id) as Approval | undefined; if (!row) throw new DomainError('approval_not_found', 404); return row; }
  async prepare(taskId: string, adapterId: string, target: unknown, proposed: unknown, effects: string[]) {
    const adapter = this.adapters.get(adapterId); if (!adapter) throw new DomainError('action_adapter_unavailable', 422);
    const task = this.store.getTask(taskId);
    if (!task.scope.operations.includes('external.write')) throw new DomainError('scope_denied', 403);
    if (Buffer.byteLength(JSON.stringify({ target, proposed, effects })) > 32768) throw new DomainError('action_too_large', 413);
    const current = await adapter.read(target); const id = randomUUID(); const proposedHash = this.store.payloadHash(proposed);
    this.store.db.transaction(() => {
      const latest = this.store.taskRow(taskId); if (latest.revision !== task.revision || latest.scope_revision_id !== task.scopeRevisionId) throw new DomainError('stale_revision');
      this.store.db.prepare("INSERT INTO action_approvals(id,task_id,revision,target_json,current_hash,proposed_hash,effects_json,verification_json,expires_at,state,scope_revision_id) VALUES(?,?,1,?,?,?,?,?,?,'open',?)").run(id, taskId, JSON.stringify({ adapterId, target }), this.store.payloadHash(current), proposedHash, JSON.stringify(effects), JSON.stringify({ current, proposed, procedure: 'Read the exact target after the write and compare its canonical hash.' }), this.store.now() + 600000, task.scopeRevisionId);
      this.store.db.prepare('UPDATE tasks SET revision=revision+1 WHERE id=?').run(taskId);
      this.store.event(taskId, task.revision + 1, 'action.changed', { approvalId: id, state: 'open' });
    })();
    return { id, revision: 1, taskId, target, current, proposed, proposedHash, effects, expiresAt: new Date(this.store.now() + 600000).toISOString() };
  }
  view(id: string) { const a = this.approval(id); const verification = JSON.parse(a.verification_json) as { current: unknown; proposed: unknown }; return { id: a.id, taskId: a.task_id, revision: a.revision, target: (JSON.parse(a.target_json) as { target: unknown }).target, proposedHash: a.proposed_hash, current: verification.current, proposed: verification.proposed, effects: JSON.parse(a.effects_json) as string[], expiresAt: new Date(a.expires_at).toISOString(), state: a.state }; }
  async tick() {
    if (this.busy) return; this.busy = true;
    try {
      const rows = this.store.db.prepare("SELECT a.* FROM action_approvals a JOIN outbox o ON o.command_id=a.approved_command_id WHERE a.state IN ('approved','executing','uncertain') ORDER BY a.expires_at LIMIT 100").all() as Approval[];
      for (const approval of rows) {
        const prepared = JSON.parse(approval.target_json) as { adapterId: string; target: unknown }; const verification = JSON.parse(approval.verification_json) as { proposed: unknown };
        const adapter = this.adapters.get(prepared.adapterId); if (!adapter) { this.fail(approval, 'action_adapter_unavailable'); continue; }
        if (approval.scope_revision_id !== this.store.taskRow(approval.task_id).scope_revision_id) { this.fail(approval, 'stale_scope'); continue; }
        if (approval.state !== 'approved') {
          const state = await adapter.reconcile(prepared.target, approval.id);
          if (state === 'applied' && this.store.payloadHash(await adapter.read(prepared.target)) === approval.proposed_hash) this.complete(approval);
          else if (state === 'not_executed') this.fail(approval, 'action_not_executed');
          continue;
        }
        if (approval.expires_at <= this.store.now()) { this.fail(approval, 'action_expired'); continue; }
        if (this.store.payloadHash(await adapter.read(prepared.target)) !== approval.current_hash) { this.fail(approval, 'action_drift'); continue; }
        this.store.db.transaction(() => { this.store.db.prepare("UPDATE action_approvals SET state='executing' WHERE id=?").run(approval.id); this.store.db.prepare("UPDATE commands SET state='running',accepted_at=? WHERE id=?").run(this.store.now(), approval.approved_command_id); })();
        try {
          await adapter.write(prepared.target, verification.proposed, approval.id);
          if (this.store.payloadHash(await adapter.read(prepared.target)) !== approval.proposed_hash) throw new Error('readback');
          this.complete(approval);
        } catch { this.store.db.transaction(() => { this.store.db.prepare("UPDATE action_approvals SET state='uncertain' WHERE id=?").run(approval.id); this.store.db.prepare("UPDATE commands SET state='reconciling',error_code='readback_required' WHERE id=?").run(approval.approved_command_id); })(); }
      }
    } finally { this.busy = false; }
  }
  private complete(a: Approval) { this.store.db.transaction(() => { this.store.db.prepare("UPDATE action_approvals SET state='verified' WHERE id=?").run(a.id); this.store.db.prepare("UPDATE commands SET state='succeeded',resolved_at=?,error_code=NULL WHERE id=?").run(this.store.now(), a.approved_command_id); this.store.db.prepare('DELETE FROM outbox WHERE command_id=?').run(a.approved_command_id); this.store.event(a.task_id, this.store.taskRow(a.task_id).revision, 'action.changed', { approvalId: a.id, state: 'verified' }); })(); }
  private fail(a: Approval, code: string) { this.store.db.transaction(() => { this.store.db.prepare("UPDATE action_approvals SET state='failed' WHERE id=?").run(a.id); this.store.db.prepare("UPDATE commands SET state='failed',resolved_at=?,error_code=? WHERE id=?").run(this.store.now(), code, a.approved_command_id); this.store.db.prepare('DELETE FROM outbox WHERE command_id=?').run(a.approved_command_id); this.store.event(a.task_id, this.store.taskRow(a.task_id).revision, 'action.changed', { approvalId: a.id, state: 'failed', code }); })(); }
}
export class FixtureActionAdapter implements ActionAdapter {
  writes = 0; loseAcknowledgement = false; private receipts = new Set<string>();
  constructor(public current: unknown) {}
  async read() { return this.current; }
  async write(target: unknown, proposed: unknown, actionId: string) { void target; if (this.receipts.has(actionId)) return; this.current = proposed; this.writes++; this.receipts.add(actionId); if (this.loseAcknowledgement) throw new Error('synthetic lost acknowledgement'); }
  async reconcile(target: unknown, actionId: string): Promise<'applied' | 'not_executed'> { void target; return this.receipts.has(actionId) ? 'applied' : 'not_executed'; }
}
