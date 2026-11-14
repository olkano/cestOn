import Database from 'better-sqlite3';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { migrate, currentSchemaVersion as schemaVersion } from './migrations.js';
import { assertTestRoot } from '../../../../packages/test-support/src/index.js';
import { canonicalPath, validateDataRoot, within } from '../../../../packages/contracts/src/paths.js';
import { canonicalJson, DomainError, type Receipt, type Scope } from '../../../../packages/contracts/src/commands.js';
import { redactText, sanitizeValue } from '../../../../packages/contracts/src/logging.js';
import { transition } from '../../../../packages/contracts/src/states.js';
import type { ProjectConfig } from '../../../../packages/contracts/src/config.js';

export type TaskRow = { id: string; project_id: string; title: string; goal: string; state: string; priority: number; scope_revision_id: string; revision: number; created_at: number; updated_at: number; next_action: string; summary_cursor: number; stop_target: string | null };
export type ScopeRow = { id: string; task_id: string; revision: number; allowed_operations_json: string; roots_json: string; resources_json: string; budgets_json: string; completion_boundary: string; authority_source: string; created_at: number; request_hash: string };
export type ProjectRow = { id: string; display_name: string; canonical_root: string; kind: 'git' | 'documents'; config_json: string; revision: number; archived_at: number | null };
export type CommandRow = { id: string; task_id: string | null; device_id: string; idempotency_key: string; payload_hash: string; type: string; payload_json: string; expected_revision: number | null; scope_revision_id: string | null; state: string; created_at: number; accepted_at: number | null; resolved_at: number | null; error_code: string | null; revision: number };
export type DecisionOption = { id: string; label: string; meaning: string };
export type DecisionRow = { id: string; task_id: string; revision: number; prompt: string; options_json: string; evidence_cursor: number; expires_at: number; state: string; chosen_option_id: string | null; command_id: string | null; scope_revision_id: string };
export type EventRow = { sequence: number; event_id: string; aggregate_id: string; aggregate_revision: number; type: string; sanitized_payload_json: string; created_at: number; provider_event_key: string | null };
export type TaskView = { id: string; projectId: string; project: string; title: string; goal: string; state: string; priority: number; dependencyIds: string[]; scopeRevisionId: string; revision: number; createdAt: string; updatedAt: string; nextAction: string; freshness: 'fresh' | 'stale' | 'unknown'; summaryCursor: number; scope: Scope; phases: Record<string, unknown>[]; decision: ReturnType<Store['decisionView']> | null; evidence: Record<string, unknown>[] };

export class Store {
  readonly db: Database.Database;
  readonly now: () => number;
  readonly testMode: boolean;
  readonly dataRoot: string;
  constructor(root: string, options: { testMode?: boolean; now?: () => number } = {}) {
    this.now = options.now ?? Date.now; this.testMode = options.testMode === true;
    if (this.testMode) assertTestRoot(root); else validateDataRoot(root);
    this.dataRoot = canonicalPath(root);
    mkdirSync(join(root, 'state'), { recursive: true });
    this.db = new Database(join(root, 'state', 'ceston.sqlite'));
    this.db.pragma('journal_mode = WAL'); this.db.pragma('foreign_keys = ON'); this.db.pragma('busy_timeout = 5000');
    try {
      this.db.transaction(() => {
        migrate(this.db, this.now());
        if (!this.db.prepare('SELECT id FROM installations').get()) this.db.prepare('INSERT INTO installations(id,schema_version,created_at) VALUES(?,?,?)').run(randomUUID(), schemaVersion, this.now());
        if (this.installation().schema_version !== schemaVersion) throw new DomainError('schema_incompatible');
      })();
    } catch (error) { this.db.close(); throw error; }
  }
  close() { if (this.db.open) this.db.close(); }
  installation() { return this.db.prepare('SELECT * FROM installations').get() as { id: string; schema_version: number; active_release: string | null; dispatch_paused: number; revision: number }; }
  registerProject(config: ProjectConfig) {
    const root = canonicalPath(config.root);
    if (this.testMode ? !within(this.dataRoot, root) : within(this.dataRoot, root) || within(root, this.dataRoot)) throw new DomainError('project_root_denied', 403);
    const existing = this.db.prepare('SELECT id FROM projects WHERE canonical_root=?').get(root) as { id: string } | undefined;
    if (existing && existing.id !== config.id) throw new DomainError('duplicate_project_root');
    this.db.prepare('INSERT INTO projects(id,display_name,canonical_root,kind,config_json) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,config_json=excluded.config_json,revision=projects.revision+1').run(config.id, config.displayName, root, config.kind, canonicalJson(config));
  }
  project(id: string): ProjectRow {
    const row = this.db.prepare('SELECT * FROM projects WHERE id=? AND archived_at IS NULL').get(id) as ProjectRow | undefined;
    if (!row) throw new DomainError('project_not_found', 404); return row;
  }
  taskRow(id: string): TaskRow {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id=?').get(id) as TaskRow | undefined;
    if (!row) throw new DomainError('task_not_found', 404); return row;
  }
  scope(id: string): ScopeRow {
    const row = this.db.prepare('SELECT * FROM scope_revisions WHERE id=?').get(id) as ScopeRow | undefined;
    if (!row) throw new DomainError('scope_not_found', 404); return row;
  }
  command(id: string): Receipt {
    const row = this.db.prepare('SELECT * FROM commands WHERE id=?').get(id) as CommandRow | undefined;
    if (!row) throw new DomainError('command_not_found', 404);
    return { id: row.id, taskId: row.task_id, state: row.state, errorCode: row.error_code };
  }
  event(id: string, revision: number, type: string, payload: Record<string, unknown>, providerKey: string | null = null) {
    const json = canonicalJson(sanitizeValue(payload));
    if (Buffer.byteLength(json) > 128 * 1024) throw new DomainError('event_too_large', 413);
    const result = this.db.prepare('INSERT OR IGNORE INTO events(event_id,aggregate_id,aggregate_revision,type,sanitized_payload_json,created_at,provider_event_key) VALUES(?,?,?,?,?,?,?)').run(randomUUID(), id, revision, type, json, this.now(), providerKey);
    if (!result.changes) return this.latestCursor();
    const cursor = Number(result.lastInsertRowid);
    this.db.prepare('UPDATE tasks SET summary_cursor=? WHERE id=?').run(cursor, id);
    return cursor;
  }
  latestCursor() { return (this.db.prepare('SELECT COALESCE(MAX(sequence),0) AS n FROM events').get() as { n: number }).n; }
  events(after: number, aggregateId?: string, limit = 100) {
    const count = Math.max(1, Math.min(100, limit));
    return (aggregateId ? this.db.prepare('SELECT * FROM events WHERE sequence>? AND aggregate_id=? ORDER BY sequence LIMIT ?').all(after, aggregateId, count) : this.db.prepare('SELECT * FROM events WHERE sequence>? ORDER BY sequence LIMIT ?').all(after, count)) as EventRow[];
  }
  listTasks(filters: { state?: string; project?: string; search?: string; after?: number; attention?: boolean } = {}): TaskView[] {
    const clauses = ['1=1']; const params: (string | number)[] = [];
    if (filters.state) { clauses.push('state=?'); params.push(filters.state); }
    if (filters.project) { clauses.push('project_id=?'); params.push(filters.project); }
    if (filters.search) { clauses.push('(title LIKE ? OR goal LIKE ?)'); params.push(`%${filters.search.slice(0, 160)}%`, `%${filters.search.slice(0, 160)}%`); }
    if (filters.attention) clauses.push("state IN ('waiting_input','blocked','review_ready','pausing')");
    const rows = this.db.prepare(`SELECT id FROM tasks WHERE ${clauses.join(' AND ')} ORDER BY priority DESC,created_at,id LIMIT 100 OFFSET ?`).all(...params, Math.max(0, filters.after ?? 0)) as { id: string }[];
    return rows.map(row => this.getTask(row.id));
  }
  decisionView(row: DecisionRow) { return { id: row.id, taskId: row.task_id, revision: row.revision, prompt: row.prompt, options: JSON.parse(row.options_json) as DecisionOption[], expiresAt: new Date(row.expires_at).toISOString(), state: row.state === 'open' && row.expires_at <= this.now() ? 'expired' : row.state, chosenOptionId: row.chosen_option_id }; }
  getTask(id: string): TaskView {
    const row = this.taskRow(id); const scope = this.scope(row.scope_revision_id);
    const decision = this.db.prepare("SELECT * FROM decisions WHERE task_id=? AND state='open' ORDER BY revision DESC LIMIT 1").get(id) as DecisionRow | undefined;
    const phases = this.db.prepare('SELECT id,ordinal,goal,state,attempt_count,max_attempts,revision FROM phases WHERE task_id=? ORDER BY ordinal').all(id) as Record<string, unknown>[];
    const evidence = this.db.prepare('SELECT id,kind,content_hash,source,observed_at FROM evidence WHERE task_id=? ORDER BY observed_at DESC LIMIT 100').all(id) as Record<string, unknown>[];
    const dependencyIds = (this.db.prepare('SELECT depends_on_id FROM task_dependencies WHERE task_id=?').all(id) as { depends_on_id: string }[]).map(d => d.depends_on_id);
    return { id, projectId: row.project_id, project: this.project(row.project_id).display_name, title: row.title, goal: row.goal, state: row.state, priority: row.priority, dependencyIds, scopeRevisionId: row.scope_revision_id, revision: row.revision, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(), nextAction: row.next_action, freshness: this.now() - row.updated_at > 45000 ? 'stale' : 'fresh', summaryCursor: row.summary_cursor, scope: { operations: JSON.parse(scope.allowed_operations_json) as Scope['operations'], budgets: JSON.parse(scope.budgets_json) as Scope['budgets'], completionBoundary: scope.completion_boundary as Scope['completionBoundary'] }, phases, decision: decision ? this.decisionView(decision) : null, evidence };
  }
  snapshot(after = 0, expectedCursor?: number) {
    return this.db.transaction(() => {
      if (expectedCursor !== undefined && this.latestCursor() !== expectedCursor) throw new DomainError('snapshot_changed');
      const totalTasks = (this.db.prepare('SELECT COUNT(*) AS n FROM tasks').get() as { n: number }).n;
      return {
      cursor: this.latestCursor(), installation: { ...this.installation(), active_release: this.installation().active_release ?? 'development' },
      projects: this.db.prepare('SELECT id,display_name AS displayName,kind,revision FROM projects WHERE archived_at IS NULL LIMIT 100').all() as { id: string; displayName: string; kind: string; revision: number }[],
      tasks: this.listTasks({ after }), totalTasks, nextCursor: after + 100 < totalTasks ? after + 100 : null, capturedAt: new Date(this.now()).toISOString(),
    }; })();
  }
  changeTask(id: string, to: string, nextAction: string) {
    const row = this.taskRow(id); transition('task', row.state, to);
    this.db.prepare('UPDATE tasks SET state=?,next_action=?,revision=revision+1,updated_at=? WHERE id=?').run(to, nextAction, this.now(), id);
    const cursor = this.event(id, row.revision + 1, 'task.changed', { state: to, nextAction });
    this.db.prepare('UPDATE tasks SET summary_cursor=? WHERE id=?').run(cursor, id);
  }
  createDecision(taskId: string, prompt: string, options: DecisionOption[], expiresAt: number) {
    return this.db.transaction(() => {
      const task = this.taskRow(taskId);
      if (!options.length || options.length > 8 || new Set(options.map(o => o.id)).size !== options.length || options.some(o => !o.id || !o.label || !o.meaning || o.label.length > 160 || o.meaning.length > 2000) || prompt.length > 32768 || expiresAt <= this.now()) throw new DomainError('invalid_decision', 400);
      this.db.prepare("UPDATE decisions SET state='superseded' WHERE task_id=? AND state='open'").run(taskId);
      const revision = (this.db.prepare('SELECT COALESCE(MAX(revision),0)+1 AS n FROM decisions WHERE task_id=?').get(taskId) as { n: number }).n;
      const id = randomUUID();
      this.db.prepare('INSERT INTO decisions(id,task_id,revision,prompt,options_json,evidence_cursor,expires_at,state,scope_revision_id) VALUES(?,?,?,?,?,?,?,\'open\',?)').run(id, taskId, revision, redactText(prompt), canonicalJson(options), this.latestCursor(), expiresAt, task.scope_revision_id);
      if (task.state !== 'waiting_input') this.changeTask(taskId, 'waiting_input', 'Choose an option to continue.');
      else this.db.prepare('UPDATE tasks SET revision=revision+1,updated_at=? WHERE id=?').run(this.now(), taskId);
      this.event(taskId, this.taskRow(taskId).revision, 'decision.changed', { decisionId: id, revision, state: 'open' });
      return this.db.prepare('SELECT * FROM decisions WHERE id=?').get(id) as DecisionRow;
    })();
  }
  setDependencies(taskId: string, dependencies: string[]) {
    this.db.transaction(() => {
      this.taskRow(taskId);
      for (const id of dependencies) { this.taskRow(id); if (id === taskId) throw new DomainError('dependency_cycle'); }
      this.db.prepare('DELETE FROM task_dependencies WHERE task_id=?').run(taskId);
      for (const id of new Set(dependencies)) this.db.prepare('INSERT INTO task_dependencies VALUES(?,?)').run(taskId, id);
      const cycle = this.db.prepare('WITH RECURSIVE deps(id) AS (SELECT depends_on_id FROM task_dependencies WHERE task_id=? UNION SELECT d.depends_on_id FROM task_dependencies d JOIN deps ON d.task_id=deps.id) SELECT 1 FROM deps WHERE id=? LIMIT 1').get(taskId, taskId);
      if (cycle) throw new DomainError('dependency_cycle');
    })();
  }
  acquireLease(resource: string, taskId: string, runId: string, owner: string) {
    const key = canonicalPath(resource);
    const held = this.db.prepare("SELECT * FROM leases WHERE state='held'").all() as { resource_key: string; broker_owner_nonce: string; run_id: string }[];
    for (const row of held) {
      if (within(row.resource_key, key) || within(key, row.resource_key)) {
        if (row.resource_key === key && row.broker_owner_nonce === owner && row.run_id === runId) return;
        throw new DomainError('resource_busy');
      }
    }
    this.db.prepare('INSERT INTO leases VALUES(?,?,?,?,?,?,?)').run(key, taskId, runId, owner, this.now(), this.now(), 'held');
  }
  releaseLease(resource: string, owner: string, terminalProven: boolean) {
    if (!terminalProven) throw new DomainError('reconciliation_required');
    const result = this.db.prepare('DELETE FROM leases WHERE resource_key=? AND broker_owner_nonce=?').run(canonicalPath(resource), owner);
    if (!result.changes) throw new DomainError('lease_owner_mismatch');
  }
  prune() {
    const cutoff = this.now() - 180 * 86400000;
    return this.db.transaction(() => {
      const candidates = this.db.prepare("SELECT id,device_id,idempotency_key FROM commands WHERE resolved_at<? AND state IN ('succeeded','rejected','failed','cancelled') AND id NOT IN (SELECT command_id FROM outbox) AND task_id IS NULL").all(cutoff) as { id: string; device_id: string; idempotency_key: string }[];
      for (const row of candidates) {
        this.db.prepare('INSERT OR IGNORE INTO command_tombstones VALUES(?,?,?)').run(row.device_id, row.idempotency_key, this.now() + 180 * 86400000);
        this.db.prepare('DELETE FROM commands WHERE id=?').run(row.id);
      }
      this.db.prepare('DELETE FROM command_tombstones WHERE expires_at<?').run(this.now());
      return { commands: candidates.length };
    })();
  }
  async backupSnapshot(name: string) {
    if (!/^[a-zA-Z0-9_.-]+\.sqlite$/.test(name) || name.startsWith('.')) throw new DomainError('invalid_backup_name', 400);
    const directory = join(this.dataRoot, 'backups'); mkdirSync(directory, { recursive: true });
    const path = join(directory, name);
    if (!within(this.dataRoot, directory) || existsSync(path)) throw new DomainError('backup_target_denied', 403);
    await this.db.backup(path);
    const copy = new Database(path, { readonly: true });
    try {
      if (copy.pragma('integrity_check', { simple: true }) !== 'ok') throw new DomainError('backup_integrity_failed');
      const cursor = (copy.prepare('SELECT COALESCE(MAX(sequence),0) AS n FROM events').get() as { n: number }).n;
      return { path, cursor, schemaVersion, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') };
    } finally { copy.close(); }
  }
  payloadHash(value: unknown) { return createHash('sha256').update(canonicalJson(value)).digest('hex'); }
}
