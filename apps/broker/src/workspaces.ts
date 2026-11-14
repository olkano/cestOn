import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync, lstatSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { canonicalPath, safePath, within } from '../../../packages/contracts/src/paths.js';
import { canonicalJson, DomainError } from '../../../packages/contracts/src/commands.js';
import type { ProjectConfig } from '../../../packages/contracts/src/config.js';
import { childEnvironment } from './policy/index.js';
import { atomicJson } from '../../../packages/contracts/src/files.js';
type Ownership = { projectId: string; taskId: string; scopeRevisionId: string; originRoot: string; root: string; sourceHash: string; state: 'preparing' | 'ready' };
const ignored = (name: string) => ['.git', '.codex', '.claude', '.ceston', '.npmrc', '.netrc', '.pypirc', '.ssh', '.aws', '.kube', 'reference-private', 'node_modules', 'dist', 'coverage', 'test-results'].includes(name) || /^\.env(?:\.(?!example$).*)?$|^(?:auth|credentials)\.json$|^id_(?:rsa|ed25519)$|\.(?:pem|key|sqlite|log)$/i.test(name);
export class WorkspaceManager {
  private base: string;
  constructor(root: string, private key: string) { this.base = join(canonicalPath(root), 'staging', 'workspaces'); mkdirSync(this.base, { recursive: true }); if (!within(root, this.base)) throw new DomainError('workspace_root_denied', 403); }
  private paths(taskId: string) { if (!/^[a-f0-9-]{36}$/.test(taskId)) throw new DomainError('invalid_task', 400); return { root: join(this.base, taskId, 'files'), marker: join(this.base, `${taskId}.json`) }; }
  private sign(value: Ownership) { return createHmac('sha256', this.key).update('workspace:').update(canonicalJson(value)).digest('hex'); }
  private write(marker: string, value: Ownership) { atomicJson(marker, { value, signature: this.sign(value) }); }
  validate(project: ProjectConfig, taskId: string, scopeRevisionId: string, root: string) {
    const paths = this.paths(taskId); let value: Ownership; let signature: string;
    try { ({ value, signature } = JSON.parse(readFileSync(paths.marker, 'utf8')) as { value: Ownership; signature: string }); const actual = Buffer.from(signature, 'hex'); const expected = Buffer.from(this.sign(value), 'hex'); if (actual.length !== expected.length || !timingSafeEqual(actual, expected) || value.state !== 'ready' || value.taskId !== taskId || value.projectId !== project.id || value.scopeRevisionId !== scopeRevisionId || value.originRoot !== canonicalPath(project.root) || value.root !== canonicalPath(root) || value.root !== canonicalPath(paths.root) || !within(this.base, value.root) || lstatSync(join(this.base, taskId)).isSymbolicLink() || lstatSync(paths.root).isSymbolicLink()) throw new Error(); }
    catch { throw new DomainError('workspace_ownership_denied', 403); } return true;
  }
  private files(project: ProjectConfig) {
    let files: string[] = [];
    if (project.kind === 'git') {
      const env = { ...childEnvironment(process.env), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_OPTIONAL_LOCKS: '0' };
      try { files = execFileSync('git', ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=', '-C', project.root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8', env, timeout: 5000, maxBuffer: 8 * 1048576, windowsHide: true }).split('\0').filter(Boolean); } catch { throw new DomainError('workspace_git_snapshot_failed', 422); }
    } else {
      const scan = (dir: string, depth: number) => { if (depth > 32) throw new DomainError('workspace_depth_limit', 413); for (const entry of readdirSync(dir, { withFileTypes: true })) { if (ignored(entry.name)) continue; const path = join(dir, entry.name); if (entry.isSymbolicLink()) throw new DomainError('workspace_link_denied', 403); if (entry.isDirectory()) scan(path, depth + 1); else if (entry.isFile()) { files.push(relative(project.root, path)); if (files.length > 10000) throw new DomainError('workspace_file_limit', 413); } } }; scan(project.root, 0);
    }
    files = [...new Set(files)].filter(path => !path.split(/[\\/]/).some(ignored)).sort(); if (files.length > 10000) throw new DomainError('workspace_file_limit', 413);
    for (const file of files) { const pieces = file.split(/[\\/]/); for (let i = 1; i <= pieces.length; i++) if (lstatSync(join(project.root, ...pieces.slice(0, i))).isSymbolicLink()) throw new DomainError('workspace_link_denied', 403); safePath(project.root, file); }
    return files;
  }
  prepare(project: ProjectConfig, taskId: string, scopeRevisionId: string) {
    const paths = this.paths(taskId);
    if (existsSync(paths.marker)) { this.validate(project, taskId, scopeRevisionId, paths.root); const saved = (JSON.parse(readFileSync(paths.marker, 'utf8')) as { value: Ownership }).value; return saved; }
    if (existsSync(join(this.base, taskId))) throw new DomainError('workspace_unowned_directory', 403);
    const files = this.files(project); mkdirSync(paths.root, { recursive: true }); let total = 0;
    const ownership: Ownership = { projectId: project.id, taskId, scopeRevisionId, originRoot: canonicalPath(project.root), root: canonicalPath(paths.root), sourceHash: '', state: 'preparing' }; this.write(paths.marker, ownership);
    const hash = createHash('sha256'); const hashes = new Map<string, string>();
    for (const file of files) {
      const source = safePath(project.root, file); const stat = statSync(source); if (!stat.isFile() || (total += stat.size) > 250 * 1048576) throw new DomainError('workspace_size_limit', 413);
      const bytes = readFileSync(source); const digest = createHash('sha256').update(bytes).digest('hex'); hashes.set(file, digest); hash.update(file).update(digest);
      const target = safePath(paths.root, file); mkdirSync(join(target, '..'), { recursive: true }); writeFileSync(target, bytes, { flag: 'wx', mode: stat.mode & 0o777 });
    }
    if (canonicalJson(this.files(project)) !== canonicalJson(files)) throw new DomainError('source_changed_during_snapshot');
    for (const [file, hash] of hashes) if (createHash('sha256').update(readFileSync(safePath(project.root, file))).digest('hex') !== hash) throw new DomainError('source_changed_during_snapshot');
    ownership.sourceHash = hash.digest('hex'); ownership.state = 'ready'; this.write(paths.marker, ownership); return ownership;
  }
}
