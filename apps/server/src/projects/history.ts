import { createHash } from 'node:crypto';
import { lstat, open, opendir, realpath, readdir } from 'node:fs/promises';
import Database from 'better-sqlite3';
import { basename, isAbsolute, join, normalize, relative } from 'node:path';
import type { Config } from '../../../../packages/contracts/src/config.js';
import { DomainError } from '../../../../packages/contracts/src/commands.js';
import { redactText } from '../../../../packages/contracts/src/logging.js';
import { within } from '../../../../packages/contracts/src/paths.js';

type Provider = 'Codex' | 'Claude';
type Json = Record<string, unknown>;
type Source = { provider: Provider; home: string; root: string; replyEnabled: boolean };
export type Conversation = {
  id: string; folderId: string; folder: string; provider: Provider | 'Managed' | 'Fixture'; title: string;
  activityAt: string; approximate: boolean; managed?: boolean; canReply?: boolean;
};
type Entry = Conversation & Source & { file: string; nativeId: string; cwd: string };
export type HistoryTarget = Pick<Entry, 'provider' | 'home' | 'nativeId' | 'cwd'>;
type Coverage = { provider: Provider; status: 'ready' | 'unavailable' | 'partial'; inspected: number; skipped: number };
const budget = 4000;
const chunkSize = 65536;
const digest = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 32);
function folderId(path: string) {
  const hash = digest('folder:' + path);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20)}`;
}
export function conversationFolderId(path: string) { return folderId(process.platform === 'win32' ? path.toLowerCase() : path); }
const object = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
const label = (value: unknown) => typeof value === 'string' ? redactText(value).trim().slice(0, 160) : '';

function records(buffer: Buffer): Json[] {
  return buffer.toString('utf8').split('\n').flatMap(line => {
    try { return [object(JSON.parse(line))]; } catch { return []; }
  });
}
async function codexNames(home: string) {
  const names = new Map<string, { title: string; updatedAt: number }>();
  const file = join(home, 'session_index.jsonl');
  try {
    const stat = await checkPath(home, file);
    const handle = await open(file, 'r');
    try {
      const start = Math.max(0, stat.size - 4 * 1024 * 1024);
      const buffer = Buffer.alloc(stat.size - start);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
      const valid = records(buffer.subarray(0, bytesRead)).slice(start ? 1 : 0);
      for (const row of valid) {
        if (typeof row.id !== 'string' || row.id.length > 200) continue;
        const title = label(row.thread_name);
        const updatedAt = Date.parse(String(row.updated_at)) || 0;
        if (title && updatedAt >= (names.get(row.id)?.updatedAt ?? -Infinity)) names.set(row.id, { title, updatedAt });
      }
    } finally { await handle.close(); }
  } catch { /* Provider snapshots may be missing or rotating. The transcript can still be read. */ }
  return names;
}
async function codexStateNames(home: string) {
  const names = new Map<string, string>();
  try {
    const files = (await readdir(home)).filter(name => /^state_\d+\.sqlite$/.test(name))
      .sort((a,b) => Number(b.match(/\d+/)![0]) - Number(a.match(/\d+/)![0]));
    if (!files[0]) return names;
    const file = join(home,files[0]);
    await checkPath(home,file);
    const db = new Database(file,{readonly:true,fileMustExist:true,timeout:100});
    try {
      const columns = new Set(db.prepare("PRAGMA table_info('threads')").all().map(row => (row as {name:string}).name));
      if (!columns.has('id')) return names;
      const available = ['name','title','preview'].filter(name => columns.has(name));
      if (!available.length) return names;
      const order = columns.has('updated_at') ? 'ORDER BY updated_at DESC' : '';
      const rows = db.prepare(`SELECT id,${available.join(',')} FROM threads ${order} LIMIT 4000`).all() as Json[];
      for (const row of rows) {
        const title = available.map(name => label(row[name])).find(Boolean);
        if (title && typeof row.id === 'string') names.set(row.id,title);
      }
    } finally { db.close(); }
  } catch { /* An unavailable provider index does not prevent transcript discovery. */ }
  return names;
}
function textContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.map(object).filter(p => ['text', 'input_text', 'output_text'].includes(String(p.type))).map(p => typeof p.text === 'string' ? p.text : '').filter(Boolean).join('\n');
}
function replyText(record: Json, provider: Provider) {
  const payload = object(provider === 'Codex' ? record.payload : record.message);
  const role = provider === 'Codex' ? payload.role : record.type;
  if (role !== 'assistant' && role !== 'user') return [];
  if (provider === 'Codex' && (record.type !== 'response_item' || payload.type !== 'message')) return [];
  const text = redactText(textContent(payload.content)).trim().slice(0, 12000);
  return text ? [{ role, text }] : [];
}

async function checkPath(root: string, file: string) {
  const [base, actual, info] = await Promise.all([realpath(root), realpath(file), lstat(file)]);
  const sub = relative(base, actual);
  if (!info.isFile() || info.isSymbolicLink() || !sub || sub.startsWith('..') || isAbsolute(sub)) throw new Error('outside_history');
  return info;
}

async function* candidates(root: string, depth = 0, folder = root): AsyncGenerator<string> {
  const directory = await opendir(folder);
  for await (const entry of directory) {
    const path = join(folder, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isFile() && entry.name.endsWith('.jsonl')) yield path;
    else if (entry.isDirectory() && depth < 8 && !['subagents', 'node_modules', '.git', 'archives'].includes(entry.name)) yield* candidates(root, depth + 1, path);
  }
}

async function metadata(source: Source, file: string): Promise<Entry | null> {
  const stat = await checkPath(source.root, file);
  const handle = await open(file, 'r');
  try {
    const head = Buffer.alloc(chunkSize);
    const first = await handle.read(head, 0, head.length, 0);
    const initial = records(head.subarray(0, first.bytesRead));
    const tailStart = Math.max(0, stat.size - chunkSize);
    const tail = Buffer.alloc(chunkSize);
    const end = tailStart ? await handle.read(tail, 0, tail.length, tailStart) : first;
    const recent = tailStart ? records(tail.subarray(0, end.bytesRead)) : initial;
    const meta = source.provider === 'Codex'
      ? object(initial.find(r => r.type === 'session_meta')?.payload)
      : initial.find(r => typeof r.sessionId === 'string' && typeof r.cwd === 'string' && !r.isSidechain);
    if (!meta || meta.isSidechain || ['sdk-cli', 'sdk-ts', 'sdk-py', 'daemon', 'daemon-worker'].includes(String(meta.entrypoint))) return null;
    const nativeId = source.provider === 'Codex' ? meta.id : meta.sessionId;
    if (typeof nativeId !== 'string' || nativeId.length > 200 || typeof meta.cwd !== 'string' || !isAbsolute(meta.cwd) || meta.cwd.length > 1024) return null;
    const cwd = normalize(meta.cwd);
    const identity = process.platform === 'win32' ? cwd.toLowerCase() : cwd;
    const dates = recent.filter(r => replyText(r, source.provider).length).map(r => Date.parse(String(r.timestamp))).filter(Number.isFinite);
    const activity = dates.length ? Math.max(...dates) : stat.mtimeMs;
    const titled = [...initial, ...recent].reverse().filter(row => row.sessionId === undefined || row.sessionId === nativeId);
    const title = label(titled.find(row => row.type === 'custom-title' && label(row.customTitle))?.customTitle)
      || label(titled.find(row => row.type === 'ai-title' && label(row.aiTitle))?.aiTitle) || label(meta.title)
      || label(titled.find(row => row.type === 'summary' && label(row.summary))?.summary)
      || label(initial.flatMap(row => replyText(row, source.provider)).find(message => message.role === 'user' && !/^<(?:environment_context|user_instructions|local-command|command-name)|^# AGENTS\.md/i.test(message.text))?.text.replace(/\s+/g, ' '))
      || source.provider + ' conversation';
    return { provider: source.provider, home: source.home, root: source.root, replyEnabled: source.replyEnabled,
      id: digest(source.provider + ':' + nativeId), folderId: folderId(identity), folder: label(basename(cwd)) || 'Unnamed folder',
      nativeId, cwd, title, activityAt: new Date(activity).toISOString(), approximate: !dates.length, file };
  } finally { await handle.close(); }
}

const providerId = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
function dto({ id, folderId, folder, provider, title, activityAt, approximate, replyEnabled, nativeId }: Entry): Conversation {
  return { id, folderId, folder, provider, title, activityAt, approximate, ...(replyEnabled && providerId.test(nativeId) ? {canReply:true} : {}) };
}

export class LocalHistory {
  private entries = new Map<string, Entry>();
  private coverage: Coverage[] = [];
  private capturedAt = 0;
  private scan: Promise<void> | undefined;
  private sources: Source[];
  constructor(config: Config['history'], testRoot?: string) {
    this.sources = [
      ...(config.codexHome ? [{ provider: 'Codex' as const, home: config.codexHome, root: join(config.codexHome, 'sessions'), replyEnabled: Boolean(config.codexExecutable) }] : []),
      ...(config.claudeHome ? [{ provider: 'Claude' as const, home: config.claudeHome, root: join(config.claudeHome, 'projects'), replyEnabled: Boolean(config.claudeExecutable) }] : []),
    ];
    if (this.sources.some(source => !isAbsolute(source.home) || (testRoot && (!within(testRoot, source.home) || !within(testRoot, source.root))))) {
      throw new DomainError('history_root_denied', 403);
    }
  }

  async list(search: string, folderId: string | undefined, offset: number, managed: Conversation[] = []) {
    if (Date.now() - this.capturedAt > 30000) {
      this.scan ??= this.refresh().finally(() => { this.scan = undefined; });
      await this.scan;
    }
    const rows = [...Array.from(this.entries.values(), dto), ...managed].sort((a, b) => b.activityAt.localeCompare(a.activityAt) || a.id.localeCompare(b.id));
    const needle = search.toLowerCase();
    const matching = rows.filter(row => [row.folder, row.title, row.provider].some(value => value.toLowerCase().includes(needle)));
    const folders = new Map<string, { id: string; name: string; activityAt: string; count: number }>();
    for (const row of matching) {
      const prior = folders.get(row.folderId);
      if (prior) prior.count++;
      else folders.set(row.folderId, { id: row.folderId, name: row.folder, activityAt: row.activityAt, count: 1 });
    }
    const selected = folderId ? matching.filter(row => row.folderId === folderId) : matching;
    return { folders: [...folders.values()], conversations: selected.slice(offset, offset + 30),
      nextOffset: offset + 30 < selected.length ? offset + 30 : null,
      coverage: this.coverage, capturedAt: new Date(this.capturedAt).toISOString() };
  }

  async read(id: string, before?: number) {
    const entry = this.entries.get(id);
    if (!entry) throw new DomainError('conversation_not_available', 404);
    try {
      const stat = await checkPath(entry.root, entry.file);
      // A path can be replaced while the app is running. Recheck its provider identity.
      const current = await metadata(entry, entry.file);
      if (current?.id !== entry.id || current.folderId !== entry.folderId) throw new Error('different_conversation');
      const handle = await open(entry.file, 'r');
      try {
        const end = Math.min(stat.size, before ?? stat.size);
        const start = Math.max(0, end - 2 * chunkSize);
        const buffer = Buffer.alloc(end - start);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
        const head = start ? buffer.indexOf(10) : -1;
        const skip = start && head >= 0 && head + 1 < bytesRead ? head + 1 : 0;
        const messages = records(buffer.subarray(skip, bytesRead)).flatMap(row => replyText(row, entry.provider));
        return { messages, older: start ? start + skip : null };
      } finally { await handle.close(); }
    } catch { throw new DomainError('conversation_not_available', 404); }
  }

  async target(id: string): Promise<HistoryTarget> {
    await this.list('', undefined, 0);
    const saved = this.entries.get(id);
    if (!saved) throw new DomainError('conversation_not_available', 404);
    try {
      const entry = await metadata(saved, saved.file);
      if (!entry || entry.id !== id || entry.folderId !== saved.folderId || !providerId.test(entry.nativeId)) throw new Error('different_conversation');
      const { provider, home, nativeId, cwd } = entry;
      return { provider, home, nativeId, cwd };
    } catch { throw new DomainError('conversation_not_available', 404); }
  }

  private async refresh() {
    const entries = new Map<string, Entry>();
    const coverage: Coverage[] = [];
    for (const source of this.sources) {
      const state: Coverage = { provider: source.provider, status: 'ready', inspected: 0, skipped: 0 };
      coverage.push(state);
      const names = source.provider === 'Codex' ? await codexNames(source.home) : undefined;
      const stateNames = source.provider === 'Codex' ? await codexStateNames(source.home) : undefined;
      try {
        for await (const file of candidates(source.root)) {
          if (state.inspected >= budget) { state.status = 'partial'; break; }
          state.inspected++;
          try {
            const entry = await metadata(source, file);
            if (!entry) { state.skipped++; continue; }
            entry.title = names?.get(entry.nativeId)?.title ?? stateNames?.get(entry.nativeId) ?? entry.title;
            const previous = entries.get(entry.id);
            if (!previous || previous.activityAt < entry.activityAt) entries.set(entry.id, entry);
          } catch { state.skipped++; state.status = 'partial'; }
        }
      } catch { state.status = state.inspected ? 'partial' : 'unavailable'; }
    }
    this.entries = entries;
    this.coverage = coverage;
    this.capturedAt = Date.now();
  }
}
