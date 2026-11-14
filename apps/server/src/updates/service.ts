import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { Store } from '../db/store.js';
import type { CommandService } from '../commands/service.js';
import { commandSchema, DomainError } from '../../../../packages/contracts/src/commands.js';
import { updateTransition, type UpdateState, type ImprovementView } from '../../../../packages/contracts/src/updates.js';
import { redactText, sanitizeValue } from '../../../../packages/contracts/src/logging.js';
import { limitsSchema, type ProviderConfig } from '../../../../packages/contracts/src/config.js';
type Row = { id: string; task_id: string; state: UpdateState; base_release: string; candidate_release: string | null; request_hash: string; artifact_hash: string | null; verification_json: string; last_error: string | null; revision: number; updated_at: number };
export class ImprovementService {
  constructor(readonly store: Store, commands?: CommandService) {
    commands?.hooks.set('update.rollback', (command, commandId) => {
      if (command.type !== 'update.rollback') throw new DomainError('invalid_command');
      const row = this.row(command.payload.updateId); const installation = store.installation();
      if (installation.revision !== command.expectedRevision || row.state !== 'applied' || row.base_release !== command.payload.targetRelease || installation.active_release !== row.candidate_release) throw new DomainError('stale_rollback_target');
      const receipt = store.db.prepare('SELECT payload_hash FROM commands WHERE id=?').get(commandId) as { payload_hash: string };
      this.transition(row.id, 'rolling_back', { rollbackRequest: { commandId, requestHash: receipt.payload_hash, target: command.payload.targetRelease } });
      return { taskId: row.task_id, dispatch: false };
    });
    commands?.hooks.set('assistant.improve', (command, commandId) => {
      if (command.type !== 'assistant.improve') throw new DomainError('invalid_command');
      const installation = store.installation(); const taskId = randomUUID(); const scopeId = randomUUID(); const updateId = randomUUID(); const now = store.now(); const description = redactText(command.payload.description); const row = store.db.prepare('SELECT device_id,payload_hash FROM commands WHERE id=?').get(commandId) as { device_id: string; payload_hash: string };
      const project = { id: installation.id, displayName: 'cestOn', root: join(store.dataRoot, 'staging/improvement-source'), kind: 'documents', allowedChildRoots: [], operations: ['read', 'edit', 'test', 'build'], recipes: [] };
      store.db.prepare('INSERT OR IGNORE INTO projects(id,display_name,canonical_root,kind,config_json) VALUES(?,?,?,?,?)').run(project.id, project.displayName, project.root, project.kind, JSON.stringify(project));
      store.db.prepare("INSERT INTO tasks(id,project_id,title,goal,state,scope_revision_id,created_at,updated_at,next_action) VALUES(?,?,?,?,'blocked',?,?,?,?)").run(taskId, project.id, description.slice(0, 120), description, scopeId, now, now, 'Improvement requested. Waiting for the owner supervisor and a certified coding profile.');
      store.db.prepare('INSERT INTO scope_revisions(id,task_id,revision,allowed_operations_json,roots_json,resources_json,budgets_json,completion_boundary,authority_source,created_at,request_hash) VALUES(?,?,1,?,?,?,?,?,?,?,?)').run(scopeId, taskId, JSON.stringify(project.operations), '[]', JSON.stringify(['ceston:update']), JSON.stringify(commands.config.limits), 'user_review', `device:${row.device_id}:improvement:${commandId}`, now, row.payload_hash);
      const provider = commands.config.providers.find(profile => profile.id === commands.config.assistant.providerId) ?? null; store.db.prepare('INSERT INTO scope_profiles VALUES(?,?,?,?)').run(scopeId, JSON.stringify(project), JSON.stringify(provider), store.payloadHash({ project, provider }));
      store.db.prepare("INSERT INTO updates(id,task_id,state,base_release,request_hash,scope_revision_id,created_at,updated_at) VALUES(?,?,'requested',?,?,?,?,?)").run(updateId, taskId, installation.active_release ?? 'development', row.payload_hash, scopeId, now, now);
      store.event(taskId, 1, 'update.changed', { updateId, state: 'requested', applyLocally: command.payload.applyLocally, acceptanceCriteria: command.payload.acceptanceCriteria.map(redactText), scope: 'Isolated cestOn source only. No publication, Git push, new services or protected policy changes.' });
      return { taskId, dispatch: false };
    });
  }
  row(id: string) { const row = this.store.db.prepare('SELECT * FROM updates WHERE id=?').get(id) as Row | undefined; if (!row) throw new DomainError('update_not_found', 404); return row; }
  request(id: string) { const row = this.row(id); const task = this.store.taskRow(row.task_id); const command = this.store.db.prepare("SELECT id,device_id,payload_json,payload_hash FROM commands WHERE task_id=? AND type='assistant.improve'").get(row.task_id) as { id: string; device_id: string; payload_json: string; payload_hash: string }; const parsed = commandSchema.parse(JSON.parse(command.payload_json)); if (parsed.type !== 'assistant.improve' || command.payload_hash !== row.request_hash || this.store.payloadHash(parsed) !== row.request_hash) throw new DomainError('improvement_authority_invalid'); const binding = this.store.db.prepare('SELECT provider_json FROM scope_profiles WHERE scope_revision_id=?').get(task.scope_revision_id) as { provider_json: string } | undefined; return { ...parsed.payload, taskId: row.task_id, commandId: command.id, deviceId: command.device_id, requestHash: row.request_hash, budgets: limitsSchema.parse(JSON.parse(this.store.scope(task.scope_revision_id).budgets_json)), provider: binding ? JSON.parse(binding.provider_json) as ProviderConfig | null : null }; }
  view(id: string): ImprovementView { const row = this.row(id); const request = this.request(id); return { id, taskId: row.task_id, state: row.state, description: redactText(request.description), acceptanceCriteria: request.acceptanceCriteria.map(redactText), applyLocally: request.applyLocally, baseRelease: row.base_release, candidateRelease: row.candidate_release, errorCode: row.last_error, revision: row.revision, verification: sanitizeValue(JSON.parse(row.verification_json)) as Record<string, unknown>, updatedAt: new Date(row.updated_at).toISOString() }; }
  list() { return (this.store.db.prepare('SELECT id FROM updates ORDER BY updated_at DESC,id LIMIT 50').all() as { id: string }[]).map(row => this.view(row.id)); }
  transition(id: string, state: UpdateState, details: Record<string, unknown> = {}, error: string | null = null) {
    this.store.db.transaction(() => { const row = this.row(id); updateTransition(row.state, state); const verification = { ...JSON.parse(row.verification_json) as Record<string, unknown>, ...details }; this.store.db.prepare('UPDATE updates SET state=?,verification_json=?,last_error=?,updated_at=?,revision=revision+1 WHERE id=?').run(state, JSON.stringify(verification), error, this.store.now(), id); const taskState = state === 'applied' ? 'completed' : ['failed', 'rolled_back', 'needs_authority', 'clarifying'].includes(state) ? 'blocked' : 'running'; this.store.db.prepare('UPDATE tasks SET state=?,next_action=?,updated_at=?,revision=revision+1 WHERE id=?').run(taskState, error ? `Improvement stopped: ${error.replaceAll('_', ' ')}.` : state === 'applied' ? 'Applied locally and verified. Source publication is separate.' : `Improvement ${state.replaceAll('_', ' ')}.`, this.store.now(), row.task_id); this.store.event(row.task_id, this.store.taskRow(row.task_id).revision, 'update.changed', { updateId: id, state, ...details, errorCode: error }); })();
  }
}
