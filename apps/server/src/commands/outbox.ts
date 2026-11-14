import type { Store, CommandRow } from '../db/store.js';
import { transition } from '../../../../packages/contracts/src/states.js';

export type BrokerReceipt = { status: 'accepted'; sequence: number; result: Record<string, unknown> } | { status: 'absent' | 'uncertain' };
export interface DispatchBroker {
  accept(commandId: string, payload: unknown): Promise<BrokerReceipt>;
  lookup(commandId: string): Promise<BrokerReceipt>;
}
export class OutboxDispatcher {
  private busy = false;
  constructor(private store: Store, private broker: DispatchBroker, private crash?: (point: string) => void) {}
  private state(command: CommandRow, to: string) {
    transition('command', command.state, to);
    this.store.db.prepare('UPDATE commands SET state=?,revision=revision+1 WHERE id=?').run(to, command.id);
    this.store.event(command.task_id ?? this.store.installation().id, command.revision + 1, 'command.changed', { commandId: command.id, state: to });
    command.state = to; command.revision++;
  }
  async dispatchOne(): Promise<boolean> {
    if (this.busy) return false; this.busy = true;
    try {
      const candidates = this.store.db.prepare('SELECT c.* FROM outbox o JOIN commands c ON c.id=o.command_id WHERE o.next_attempt_at<=? ORDER BY c.created_at,c.id LIMIT 100').all(this.store.now()) as CommandRow[];
      const command = candidates.find(candidate => {
        if (candidate.type === 'task.pause' || candidate.type === 'task.cancel') return true;
        if (this.store.installation().dispatch_paused) return false;
        return !candidate.task_id || ['queued', 'running'].includes(this.store.taskRow(candidate.task_id).state);
      });
      if (!command) return false;
      const stop = command.type === 'task.pause' || command.type === 'task.cancel';
      if (!stop && this.store.installation().dispatch_paused) return false;
      if (command.task_id && !stop && ['paused', 'pausing', 'cancelled', 'completed', 'waiting_input'].includes(this.store.taskRow(command.task_id).state)) return false;
      let receipt: BrokerReceipt;
      if (command.state === 'dispatching' || command.state === 'reconciling') {
        try { receipt = await this.broker.lookup(command.id); } catch { receipt = { status: 'uncertain' }; }
        if (receipt.status === 'absent') {
          // Only an authenticated broker's durable journal can prove absence.
          this.store.db.prepare("UPDATE commands SET state='queued',revision=revision+1 WHERE id=?").run(command.id);
          this.store.db.prepare('UPDATE outbox SET claimed_at=NULL WHERE command_id=?').run(command.id);
          return true;
        }
      } else {
        this.store.db.transaction(() => {
          this.state(command, 'dispatching');
          this.store.db.prepare('UPDATE outbox SET claimed_at=?,attempts=attempts+1 WHERE command_id=?').run(this.store.now(), command.id);
        })();
        this.crash?.('before_dispatch');
        try { receipt = await this.broker.accept(command.id, JSON.parse(command.payload_json)); }
        catch { receipt = { status: 'uncertain' }; }
        this.crash?.('after_broker_accept');
      }
      if (receipt.status !== 'accepted') {
        if (command.state !== 'reconciling') this.store.db.transaction(() => this.state(command, 'reconciling'))();
        this.store.db.prepare('UPDATE outbox SET next_attempt_at=? WHERE command_id=?').run(this.store.now() + 1000, command.id);
        return true;
      }
      this.store.db.transaction(() => {
        this.state(command, 'accepted');
        this.store.db.prepare('UPDATE commands SET accepted_at=? WHERE id=?').run(this.store.now(), command.id);
        this.store.db.prepare('DELETE FROM outbox WHERE command_id=?').run(command.id);
      })();
      return true;
    } finally { this.busy = false; }
  }
}
