import { createHash } from 'node:crypto';
import { DomainError } from '../../../../packages/contracts/src/commands.js';
import { redactText } from '../../../../packages/contracts/src/logging.js';
import { memoryNote, type MemoryEntry, type MemoryWrite } from '../../../../packages/contracts/src/memory.js';
import type { Store } from './store.js';

type Row = {
  id: string;
  revision: number;
  note_json: string;
  recorded_at: number;
  updated_at: number;
  source: MemoryEntry['source'];
  source_task_id: string | null;
};

export class ProjectMemory {
  constructor(private store: Store) {}

  list(search = '', projectId?: string, offset = 0, focus: 'all' | 'attention' = 'all') {
    this.assertAvailable();
    const soon = new Date(this.store.now() + 86400000).toISOString();
    const now = new Date(this.store.now()).toISOString();
    const attentionOnly = focus === 'attention';
    const limit = 30;
    const rows = this.store.db.prepare(`
      SELECT id, revision, note_json, recorded_at, updated_at, source, source_task_id FROM memory_notes AS n
      WHERE note_json IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM projects AS p WHERE p.archived_at IS NOT NULL
        AND p.id IN (n.project_id, n.related_project_id)
      )
      AND NOT EXISTS (
        SELECT 1 FROM memory_exclusions AS e WHERE e.project_id IN (n.project_id, n.related_project_id)
      )
      AND (? IS NULL OR project_id = ? OR related_project_id = ?)
      AND instr(lower(json_extract(note_json, '$.text')), lower(?)) > 0
      AND (NOT ? OR json_extract(note_json, '$.importance')='high'
        OR julianday(json_extract(note_json, '$.dueAt')) <= julianday(?)
        OR julianday(json_extract(note_json, '$.reviewAt')) <= julianday(?))
      ORDER BY CASE WHEN ? THEN COALESCE(julianday(json_extract(note_json,'$.dueAt')), 9999999) END, updated_at DESC, id LIMIT ? OFFSET ?
    `).all(projectId ?? null, projectId ?? null, projectId ?? null, search, Number(attentionOnly), soon, now, Number(attentionOnly), limit + 1, offset) as Row[];
    return { entries: rows.slice(0, limit).map(row => this.view(row)), nextOffset: rows.length > limit ? offset + limit : null };
  }

  save(input: MemoryWrite) {
    const { id, revision, ...raw } = input;
    const note = memoryNote.parse({ ...raw, text: redactText(raw.text) });
    const json = JSON.stringify(note);
    const hash = createHash('sha256').update(json).digest('hex');
    return this.store.db.transaction(() => {
      this.assertAvailable();
      if (note.relatedProjectId && (!note.projectId || note.relatedProjectId === note.projectId)) {
        throw new DomainError('choose_two_distinct_projects', 400);
      }
      for (const projectId of [note.projectId, note.relatedProjectId]) {
        if (projectId) {
          this.requireProject(projectId);
          if (this.excluded(projectId)) throw new DomainError('project_memory_excluded', 409);
        }
      }
      const prior = this.store.db.prepare('SELECT * FROM memory_notes WHERE id = ?').get(id) as (Row & { request_hash: string; note_json: string | null }) | undefined;
      if (prior?.note_json === null) throw new DomainError('memory_forgotten', 410);
      if (prior?.revision === revision + 1 && prior.request_hash === hash) return this.view(prior);
      if ((prior?.revision ?? 0) !== revision) throw new DomainError('memory_changed', 409);
      const now = this.store.now();
      if (prior) {
        this.store.db.prepare('INSERT INTO memory_revisions VALUES(?,?,?)').run(id, prior.revision, prior.note_json);
        this.store.db.prepare('DELETE FROM memory_revisions WHERE note_id=? AND revision<=?').run(id, revision - 10);
      }
      this.store.db.prepare(`
        INSERT INTO memory_notes (id,revision,note_json,project_id,related_project_id,source,recorded_at,updated_at,request_hash)
        VALUES(?,?,?,?,?,'you',?,?,?)
        ON CONFLICT(id) DO UPDATE SET revision=excluded.revision, note_json=excluded.note_json,
        project_id=excluded.project_id, related_project_id=excluded.related_project_id,
        source=excluded.source, updated_at=excluded.updated_at, request_hash=excluded.request_hash
      `).run(id, revision + 1, json, note.projectId, note.relatedProjectId, now, now, hash);
      this.store.event(id, revision + 1, 'memory.changed', {});
      return this.view({ id, revision: revision + 1, note_json: json, recorded_at: prior?.recorded_at ?? now, updated_at: now, source: 'you', source_task_id: prior?.source_task_id ?? null });
    }).immediate();
  }

  forget(id: string, revision: number) {
    return this.store.db.transaction(() => {
      this.assertAvailable();
      const prior = this.store.db.prepare('SELECT revision, note_json IS NULL AS forgotten FROM memory_notes WHERE id=?').get(id) as { revision: number; forgotten: number } | undefined;
      if (!prior) throw new DomainError('memory_not_found', 404);
      if (prior.forgotten && prior.revision === revision + 1) return;
      if (prior.forgotten || prior.revision !== revision) throw new DomainError('memory_changed', 409);
      this.store.db.prepare('DELETE FROM memory_revisions WHERE note_id=?').run(id);
      this.store.db.prepare('UPDATE memory_notes SET note_json=NULL, project_id=NULL, related_project_id=NULL, request_hash=NULL, source_task_id=NULL, revision=revision+1, updated_at=? WHERE id=?').run(this.store.now(), id);
      this.store.event(id, revision + 1, 'memory.changed', {});
    }).immediate();
  }

  learnAcceptedTask(taskId: string) {
    const task = this.store.taskRow(taskId);
    if (task.state !== 'completed' || this.excluded(task.project_id)) return;
    const note = memoryNote.parse({
      text: 'Accepted verified work: ' + redactText(task.title),
      projectId: task.project_id, relatedProjectId: null, importance: null, dueAt: null, reviewAt: null,
    });
    const now = this.store.now();
    // A forgotten task note keeps this ID reserved. No reconstruction from the source is needed.
    const result = this.store.db.prepare(`
      INSERT OR IGNORE INTO memory_notes(id, revision, note_json, project_id, source, recorded_at, updated_at, source_task_id)
      VALUES(?,1,?,?,'observation',?,?,?)
    `).run(task.id, JSON.stringify(note), task.project_id, now, now, task.id);
    if (result.changes) this.store.event(task.id, 1, 'memory.changed', {});
  }

  excluded(projectId: string) {
    return Boolean(this.store.db.prepare('SELECT 1 FROM memory_exclusions WHERE project_id=?').get(projectId));
  }

  setExcluded(projectId: string, excluded: boolean) {
    this.requireProject(projectId);
    this.store.db.transaction(() => {
      this.assertAvailable();
      if (excluded) this.store.db.prepare('INSERT OR IGNORE INTO memory_exclusions VALUES(?)').run(projectId);
      else this.store.db.prepare('DELETE FROM memory_exclusions WHERE project_id=?').run(projectId);
      this.store.event(projectId, 1, 'memory.changed', {});
    }).immediate();
  }

  folders() {
    return this.store.db.prepare(`
      SELECT id, display_name AS displayName FROM projects WHERE archived_at IS NULL AND id<>?
      UNION ALL SELECT id, display_name FROM memory_folders
      WHERE id NOT IN (SELECT discovered_id FROM memory_folder_aliases)
      ORDER BY displayName COLLATE NOCASE, id LIMIT 8000
    `).all(this.store.installation().id) as { id: string; displayName: string }[];
  }

  rememberFolders(folders: { id: string; name: string }[]) {
    const add = this.store.db.prepare('INSERT OR IGNORE INTO memory_folders VALUES(?,?)');
    this.store.db.transaction(() => {
      this.assertAvailable();
      for (const folder of folders) add.run(folder.id, folder.name);
    }).immediate();
  }

  confirmFolderMove(from: string, to: string) {
    return this.store.db.transaction(() => {
      this.assertAvailable();
      const get = this.store.db.prepare('SELECT display_name AS name FROM memory_folders WHERE id=? AND id NOT IN (SELECT discovered_id FROM memory_folder_aliases)');
      const old = get.get(from);
      const replacement = get.get(to) as { name: string } | undefined;
      const known = this.store.db.prepare('SELECT folder_id FROM memory_folder_aliases WHERE discovered_id=?').get(to) as { folder_id: string } | undefined;
      if (known?.folder_id === from) return;
      if (!old || !replacement || from === to) throw new DomainError('choose_two_discovered_folders', 400);
      if (this.excluded(to) || this.store.db.prepare('SELECT 1 FROM memory_notes WHERE project_id=? OR related_project_id=?').get(to, to)) {
        throw new DomainError('replacement_folder_already_has_notes', 409);
      }
      this.store.db.prepare('UPDATE memory_folders SET display_name=? WHERE id=?').run(replacement.name, from);
      this.store.db.prepare('UPDATE memory_folder_aliases SET folder_id=? WHERE folder_id=?').run(from, to);
      this.store.db.prepare('INSERT INTO memory_folder_aliases VALUES(?,?)').run(to, from);
      this.store.event(from, 1, 'memory.changed', {});
    }).immediate();
  }

  private requireProject(id: string) {
    if (!this.store.db.prepare('SELECT 1 FROM memory_folders WHERE id=? AND id NOT IN (SELECT discovered_id FROM memory_folder_aliases)').get(id)) this.store.project(id);
  }

  private view(row: Row): MemoryEntry {
    const note = memoryNote.parse(JSON.parse(row.note_json));
    const now = this.store.now();
    const due = note.dueAt ? Date.parse(note.dueAt) - now : null;
    return {
      ...note, id: row.id, revision: row.revision, source: row.source, sourceTaskId: row.source_task_id,
      recordedAt: new Date(row.recorded_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      needsReview: Boolean(note.reviewAt && Date.parse(note.reviewAt) <= now),
      urgency: due === null ? null : due < 0 ? 'overdue' : due <= 86400000 ? 'soon' : 'later',
    };
  }

  private assertAvailable() {
    const recovery = this.store.db.prepare("SELECT state_json FROM service_checkpoints WHERE name='recovery'").get() as { state_json: string } | undefined;
    if (recovery && (JSON.parse(recovery.state_json) as { reconciliationRequired?: boolean }).reconciliationRequired !== false) {
      throw new DomainError('restored_memory_needs_reconciliation', 503);
    }
  }
}
