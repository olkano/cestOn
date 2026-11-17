import { createHash } from 'node:crypto';
import { lstat, open, opendir, realpath } from 'node:fs/promises';
import { basename, isAbsolute, join, normalize, relative } from 'node:path';
import type { Config } from '../../../../packages/contracts/src/config.js';
import { DomainError } from '../../../../packages/contracts/src/commands.js';
import { redactText } from '../../../../packages/contracts/src/logging.js';
import { within } from '../../../../packages/contracts/src/paths.js';

type Provider = 'Codex' | 'Claude';
type Json = Record<string, unknown>;
type Source = { provider: Provider; root: string };
type Conversation = {
  id: string; folderId: string; folder: string; provider: Provider; title: string;
  activityAt: string; approximate: boolean;
};
type Entry = Conversation & { root: string; file: string; nativeId: string };
type Coverage = { provider: Provider; status: 'ready' | 'unavailable' | 'partial'; inspected: number; skipped: number };
const budget = 4000;
const chunkSize = 65536;
const digest = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 32);
function folderId(path: string) {
  const hash = digest('folder:' + path);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20)}`;
}
const object = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
const label = (value: unknown) => typeof value === 'string' ? redactText(value).trim().slice(0, 160) : '';

function records(buffer: Buffer): Json[] {
  return buffer.toString('utf8').split('\n').flatMap(line => {
    try { return [object(JSON.parse(line))]; } catch { return []; }
  });
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
    const titleRecord = [...recent].reverse().find(r => r.type === 'custom-title' || r.type === 'summary');
    const title = label(titleRecord?.customTitle ?? titleRecord?.summary ?? meta.title) || source.provider + ' conversation';
    return { id: digest(source.provider + ':' + nativeId), folderId: folderId(identity), folder: label(basename(cwd)) || 'Unnamed folder',
      nativeId, provider: source.provider, title, activityAt: new Date(activity).toISOString(), approximate: !dates.length, root: source.root, file };
  } finally { await handle.close(); }
}

function dto({ id, folderId, folder, provider, title, activityAt, approximate }: Entry): Conversation {
  return { id, folderId, folder, provider, title, activityAt, approximate };
}

export class LocalHistory {
  private entries = new Map<string, Entry>();
  private coverage: Coverage[] = [];
  private capturedAt = 0;
  private scan: Promise<void> | undefined;
  private sources: Source[];
  constructor(config: Config['history'], testRoot?: string) {
    this.sources = [
      ...(config.codexHome ? [{ provider: 'Codex' as const, root: join(config.codexHome, 'sessions') }] : []),
      ...(config.claudeHome ? [{ provider: 'Claude' as const, root: join(config.claudeHome, 'projects') }] : []),
    ];
    if (this.sources.some(source => !isAbsolute(source.root) || (testRoot && !within(testRoot, source.root)))) {
      throw new DomainError('history_root_denied', 403);
    }
  }

  async list(search: string, folderId: string | undefined, offset: number) {
    if (Date.now() - this.capturedAt > 30000) {
      this.scan ??= this.refresh().finally(() => { this.scan = undefined; });
      await this.scan;
    }
    const rows = [...this.entries.values()].sort((a, b) => b.activityAt.localeCompare(a.activityAt) || a.id.localeCompare(b.id));
    const needle = search.toLowerCase();
    const matching = rows.filter(row => [row.folder, row.title, row.provider].some(value => value.toLowerCase().includes(needle)));
    const folders = new Map<string, { id: string; name: string; activityAt: string; count: number }>();
    for (const row of matching) {
      const prior = folders.get(row.folderId);
      if (prior) prior.count++;
      else folders.set(row.folderId, { id: row.folderId, name: row.folder, activityAt: row.activityAt, count: 1 });
    }
    const selected = folderId ? matching.filter(row => row.folderId === folderId) : matching;
    return { folders: [...folders.values()], conversations: selected.slice(offset, offset + 30).map(dto),
      nextOffset: offset + 30 < selected.length ? offset + 30 : null,
      coverage: this.coverage, capturedAt: new Date(this.capturedAt).toISOString() };
  }

  async read(id: string, before?: number) {
    const entry = this.entries.get(id);
    if (!entry) throw new DomainError('conversation_not_available', 404);
    try {
      const stat = await checkPath(entry.root, entry.file);
      // A path can be replaced while the app is running. Recheck its provider identity.
      const current = await metadata({ provider: entry.provider, root: entry.root }, entry.file);
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

  private async refresh() {
    const entries = new Map<string, Entry>();
    const coverage: Coverage[] = [];
    for (const source of this.sources) {
      const state: Coverage = { provider: source.provider, status: 'ready', inspected: 0, skipped: 0 };
      coverage.push(state);
      try {
        for await (const file of candidates(source.root)) {
          if (state.inspected >= budget) { state.status = 'partial'; break; }
          state.inspected++;
          try {
            const entry = await metadata(source, file);
            if (!entry) { state.skipped++; continue; }
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
