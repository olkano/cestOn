import { opendirSync, existsSync, lstatSync, openSync, readSync, closeSync, type Dir } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { canonicalPath, within } from '../../contracts/src/paths.js';
import { redactText } from '../../contracts/src/logging.js';
import { CapabilityError } from './types.js';

type Session = { id: string; provider: string; providerSessionId: string; homeId: string; projectId: string; title: string; ownership: 'observe_only'; state: 'unknown'; observedAt: string };
type Scan = { pending: { path: string; depth: number }[]; current: { path: string; depth: number; handle: Dir } | null; createdAt: number };
export class SessionDiscovery {
  private scans = new Map<string, Scan>(); private files = new Map<string, { path: string; session: Session }>();
  private home: string; private homeId: string;
  constructor(private provider: string, home: string, private projects: { id: string; root: string }[]) { this.home = canonicalPath(home); this.homeId = createHash('sha256').update(this.home).digest('hex'); }
  scan(cursor?: string): { sessions: Session[]; cursor?: string; inspected: number } {
    for (const [id, scan] of this.scans) if (Date.now() - scan.createdAt > 60000) { scan.current?.handle.closeSync(); this.scans.delete(id); }
    const id = cursor ?? randomUUID();
    const state = cursor ? this.scans.get(cursor) : { pending: [{ path: this.home, depth: 0 }], current: null, createdAt: Date.now() };
    if (!state) throw new CapabilityError('discovery_cursor_expired');
    this.scans.set(id, state); let inspected = 0; const sessions: Session[] = [];
    while (inspected < 500 && (state.current || state.pending.length)) {
      if (!state.current) {
        const next = state.pending.shift()!;
        if (next.depth > 8 || !existsSync(next.path) || lstatSync(next.path).isSymbolicLink() || !within(this.home, next.path)) continue;
        state.current = { ...next, handle: opendirSync(next.path) };
      }
      const entry = state.current.handle.readSync();
      if (!entry) { state.current.handle.closeSync(); state.current = null; continue; }
      inspected++;
      if (entry.isSymbolicLink()) continue;
      const path = join(state.current.path, entry.name);
      if (entry.isDirectory()) {
        if (state.pending.length >= 1000) throw new CapabilityError('discovery_directory_budget');
        if (!['node_modules', '.git'].includes(entry.name)) state.pending.push({ path, depth: state.current.depth + 1 });
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        const session = this.metadata(path); if (session) sessions.push(session);
      }
    }
    if (!state.current && !state.pending.length) { this.scans.delete(id); return { sessions, inspected }; }
    return { sessions, cursor: id, inspected };
  }
  private metadata(path: string): Session | null {
    try {
      const fd = openSync(path, 'r'); const buffer = Buffer.alloc(65536); let size: number;
      try { size = readSync(fd, buffer, 0, buffer.length, 0); } finally { closeSync(fd); }
      for (const line of buffer.subarray(0, size).toString('utf8').split('\n')) {
        if (!line.trim()) continue;
        let record: Record<string, unknown>; try { record = JSON.parse(line) as typeof record; } catch { continue; }
        const data = record.type === 'session_meta' && record.payload && typeof record.payload === 'object' ? record.payload as Record<string, unknown> : record;
        const sessionId = data.sessionId ?? (record.type === 'session_meta' ? data.id : undefined);
        if (typeof sessionId !== 'string' || sessionId.length > 200 || typeof data.cwd !== 'string') continue;
        const project = this.projects.find(p => canonicalPath(p.root) === canonicalPath(String(data.cwd)));
        if (!project) continue;
        const old = [...this.files.values()].find(f => f.path === path);
        const session: Session = { id: old?.session.id ?? randomUUID(), provider: this.provider, providerSessionId: sessionId, homeId: this.homeId, projectId: project.id, title: typeof data.title === 'string' ? redactText(data.title).slice(0, 160) : `${this.provider} session`, ownership: 'observe_only', state: 'unknown', observedAt: new Date().toISOString() };
        this.files.set(session.id, { path, session }); return session;
      }
    } catch { /* Malformed, unreadable or changing metadata never proves completion. */ }
    return null;
  }
  history(id: string, after = 0) {
    const reference = this.files.get(id);
    if (!reference || !within(this.home, reference.path) || !Number.isSafeInteger(after) || after < 0) throw new CapabilityError('unknown_or_invalid_history');
    const fd = openSync(reference.path, 'r'); const buffer = Buffer.alloc(32768); let size: number;
    try { size = readSync(fd, buffer, 0, buffer.length, after); } finally { closeSync(fd); }
    return { text: redactText(buffer.subarray(0, size).toString('utf8')), ...(size === buffer.length ? { cursor: after + size } : {}) };
  }
  close() { for (const scan of this.scans.values()) scan.current?.handle.closeSync(); this.scans.clear(); }
}
