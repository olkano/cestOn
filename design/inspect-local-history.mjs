// Explicit, read-only research probe. Never invoked by tests, builds or the app.
// Run: node --import tsx design/inspect-local-history.mjs --inspect-local-history
import { existsSync, readdirSync, openSync, readSync, closeSync, statSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import { listSessions } from '@anthropic-ai/claude-agent-sdk';
import { renderSnapshot } from './render-daily-work.mjs';
import { SessionDiscovery } from '../packages/adapters/src/discovery.ts';

if (!process.argv.includes('--inspect-local-history')) throw new Error('Explicit --inspect-local-history required. Reads local provider history metadata; writes private evidence only.');
const root = resolve(import.meta.dirname, '..');
const output = join(root, 'artifacts', `daily-work-${Date.now()}`);
mkdirSync(output, { recursive: true });
const codexHome = process.env.CODEX_HOME || join(homedir(), '.codex');
const claudeHome = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
const coverage = { codexFiles: 0, codexMetadata: 0, codexUnreadable: 0, claudeListed: 0, claudeWithoutFolder: 0, claudeArchived: 0, truncated: false, errors: [], comparison: {} };
function readChunk(file, tail = false) {
  const fd = openSync(file, 'r');
  try { const size = statSync(file).size; const start = tail ? Math.max(0, size - 65536) : 0; const b = Buffer.alloc(65536); const n = readSync(fd, b, 0, b.length, start); const lines = b.subarray(0, n).toString('utf8').split('\n'); if (start) lines.shift(); return lines.flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }); }
  finally { closeSync(fd); }
}
function filesIn(dir, depth = 0, found = []) {
  if (!existsSync(dir) || depth > 8 || lstatSync(dir).isSymbolicLink()) return found;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (found.length >= 4000) { coverage.truncated = true; break; }
    if (entry.isSymbolicLink()) continue;
    const file = join(dir, entry.name);
    if (entry.isDirectory()) filesIn(file, depth + 1, found);
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) found.push(file);
  }
  return found;
}
const key = p => resolve(p).toLowerCase();
const rows = new Map();
try {
  for (const file of filesIn(join(codexHome, 'sessions'))) {
    coverage.codexFiles++;
    try {
      const meta = readChunk(file).find(r => r.type === 'session_meta')?.payload;
      if (!meta?.id || typeof meta.cwd !== 'string') { coverage.codexUnreadable++; continue; }
      coverage.codexMetadata++;
      const dates = readChunk(file, true).map(r => Date.parse(r.timestamp)).filter(Number.isFinite);
      const last = dates.length ? Math.max(...dates) : statSync(file).mtimeMs;
      rows.set(`Codex:${meta.id}`, { provider: 'Codex', nativeId: meta.id, path: meta.cwd, last, timeSource: dates.length ? 'Last recorded event' : 'History file modified (approximate)', origin: ['cli', 'vscode'].includes(meta.source) ? 'interactive' : 'unknown', source: meta.source || 'unknown' });
    } catch { coverage.codexUnreadable++; }
  }
} catch { coverage.errors.push('Codex history directory could not be fully read.'); }
try {
  for (let offset = 0; offset < 4000; offset += 200) {
    const page = await listSessions({ limit: 200, offset, includeProgrammatic: false });
    coverage.claudeListed += page.length;
    for (const s of page) {
      if (s.archived) { coverage.claudeArchived++; continue; }
      if (!s.cwd) { coverage.claudeWithoutFolder++; continue; }
      rows.set(`Claude:${s.sessionId}`, { provider: 'Claude', nativeId: s.sessionId, path: s.cwd, last: s.lastModified, timeSource: 'Provider last modified (approximate activity)', origin: 'interactive', source: 'Claude session listing' });
    }
    if (page.length < 200) break;
    if (offset === 3800) coverage.truncated = true;
  }
} catch { coverage.errors.push('Claude session listing failed.'); }
// Compare discovered directories with the existing app reader, without registering any project.
const discoveredRoots = [...new Map([...rows.values()].map(s => [key(s.path), { id: key(s.path), root: s.path }])).values()];
for (const [provider, home] of [['Codex', join(codexHome, 'sessions')], ['Claude', join(claudeHome, 'projects')]]) {
  const reader = new SessionDiscovery(provider.toLowerCase(), home, discoveredRoots);
  const found = new Set(); let cursor; let pages = 0;
  try {
    do { const page = reader.scan(cursor); page.sessions.forEach(s => found.add(s.providerSessionId)); cursor = page.cursor; pages++; } while (cursor && pages < 200);
    const selected = [...rows.values()].filter(s => s.provider === provider);
    coverage.comparison[provider] = { returnedByExistingReader: found.size, selected: selected.length, matched: selected.filter(s => found.has(s.nativeId)).length, complete: !cursor };
  } catch { coverage.errors.push(`${provider} existing-reader comparison failed.`); }
  finally { reader.close(); }
}
const projects = new Map();
for (const s of rows.values()) {
  const id = key(s.path);
  if (!projects.has(id)) {
    let gitRoot = null; let p = resolve(s.path);
    const present = existsSync(p);
    if (present) for (let n = 0; n < 20; n++) { if (existsSync(join(p, '.git'))) { gitRoot = p; break; } const parent = dirname(p); if (parent === p) break; p = parent; }
    projects.set(id, { id: `p${projects.size}`, name: basename(s.path) || s.path, path: s.path, kind: gitRoot ? (key(gitRoot) === id ? 'Git repository' : 'Folder inside a Git repository') : present ? 'Folder without a Git marker in its parents' : 'Folder currently unavailable', exists: present, gitRoot, sessions: [] });
  }
  const project = projects.get(id);
  project.sessions.push({ id: `s${project.sessions.length}`, provider: s.provider, last: s.last, timeSource: s.timeSource, origin: s.origin, title: `${s.provider} conversation`, titleSource: 'Neutral label; conversation titles and messages were not copied' });
}
const ordered = [...projects.values()].map(p => ({ ...p, sessions: p.sessions.sort((a,b) => b.last - a.last), last: Math.max(...p.sessions.map(s => s.last)) })).sort((a,b) => b.last - a.last);
const data = { private: true, capturedAt: new Date().toISOString(), coverage, projects: ordered };
writeFileSync(join(output, 'discovery.json'), JSON.stringify(data, null, 2));
renderSnapshot(data, output);
console.log(JSON.stringify({ output, coverage, projects: ordered.length, sessions: [...rows.values()].length, examples: ordered.slice(0, 8).map(p => ({ name: p.name, providers: [...new Set(p.sessions.map(s => s.provider))], sessions: p.sessions.length, exists: p.exists })), documentFolders: ordered.filter(p => /^g:/i.test(p.path)).map(p => ({ name: p.name, sessions: p.sessions.length, exists: p.exists })) }, null, 2));
