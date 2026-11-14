import { execFileSync } from 'node:child_process';
import { readdirSync, mkdirSync, readFileSync, existsSync, lstatSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { copyPrimaryFile, fileHash, atomicJson } from '../../../packages/contracts/src/files.js';
import { canonicalPath, within, safePath } from '../../../packages/contracts/src/paths.js';
import { DomainError } from '../../../packages/contracts/src/commands.js';
import type { ReleaseManifest } from '../../../packages/contracts/src/release.js';
import { inventory, verifyRelease } from './releases.js';
const directories = new Set(['apps', 'packages', 'scripts', 'tests', 'assets', 'docs', 'design', 'zz_Specifications', 'zz_Tickets', '.github']);
const rootFiles = new Set(['README.md', 'AGENTS.md', 'LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md', 'package.json', 'package-lock.json', '.npmrc', '.node-version', '.gitignore', 'tsconfig.json', 'tsconfig.build.json', 'vitest.config.ts', 'playwright.config.ts', 'eslint.config.mjs']);
const excluded = new Set(['node_modules', '.git', 'dist', 'reference-private', 'evidence-private', 'test-results', 'coverage', '.ceston']);
export function publicSourceFiles(root: string) {
  const files: string[] = [];
  function walk(directory: string, prefix: string) { for (const entry of readdirSync(directory, { withFileTypes: true })) { if (excluded.has(entry.name) || /^\.env(?:\.|$)/.test(entry.name) || /\.(sqlite|log|key|pem)$/.test(entry.name)) continue; const path = prefix ? `${prefix}/${entry.name}` : entry.name; if (!prefix && !(entry.isDirectory() ? directories.has(entry.name) : rootFiles.has(entry.name))) continue; if (entry.isSymbolicLink()) throw new DomainError('source_link_denied', 403); if (entry.isDirectory()) walk(join(directory, entry.name), path); else if (entry.isFile()) files.push(path); } }
  walk(root, ''); return files.sort();
}
export function sourceSnapshot(root: string, files = publicSourceFiles(root)) { const hash = createHash('sha256'); for (const file of files) hash.update(file).update(readFileSync(safePath(root, file))); return hash.digest('hex'); }
export function packageRelease(options: { sourceRoot: string; runtimeRoot: string; output: string; requestId?: string; baseReleaseId?: string; testEvidenceHashes: string[]; npmCli: string; includeDependencies?: boolean }) {
  const source = canonicalPath(options.sourceRoot); const runtime = canonicalPath(options.runtimeRoot); const output = resolve(options.output); if (existsSync(output) || within(output, source) || within(output, runtime)) throw new DomainError('package_target_denied', 403);
  const sourceFiles = publicSourceFiles(source); const sourceHash = sourceSnapshot(source, sourceFiles); const requestId = options.requestId ?? randomUUID(); mkdirSync(output, { recursive: true });
  const copy = (file: string, target: string) => { mkdirSync(dirname(target), { recursive: true }); copyPrimaryFile(file, target); };
  for (const file of sourceFiles) copy(safePath(source, file), safePath(output, `source/${file}`));
  for (const file of ['package.json', 'package-lock.json', '.npmrc', '.node-version']) if (existsSync(join(source, file))) copy(join(source, file), join(output, file));
  const copyTree = (from: string, to: string) => { for (const entry of readdirSync(from, { withFileTypes: true })) { if (entry.name === '.bin') continue; const file = join(from, entry.name); if (entry.isSymbolicLink() || lstatSync(file).isSymbolicLink()) { if (canonicalPath(file).startsWith(canonicalPath(join(runtime, 'apps'))) || canonicalPath(file).startsWith(canonicalPath(join(runtime, 'packages')))) continue; throw new DomainError('runtime_link_denied', 403); } if (entry.isDirectory()) copyTree(file, join(to, entry.name)); else if (entry.isFile()) copy(file, join(to, entry.name)); } };
  copyTree(join(source, 'dist'), join(output, 'dist')); copyTree(join(source, 'apps/web/dist'), join(output, 'apps/web/dist'));
  for (const group of ['apps', 'packages']) for (const entry of readdirSync(join(source, group), { withFileTypes: true }).filter(e => e.isDirectory())) { const file = join(source, group, entry.name, 'package.json'); if (existsSync(file)) copy(file, join(output, group, entry.name, 'package.json')); }
  for (const name of ['windows-pipe-host.ps1', 'windows-mutex.ps1', 'os-protect.ps1', 'windows-access.ps1', 'windows-startup.ps1', 'pdf-extract.mjs', 'check-runtime.mjs']) { const file = join(source, 'scripts', name); if (existsSync(file)) copy(file, join(output, 'scripts', name)); }
  if (options.includeDependencies !== false) {
    if (fileHash(join(runtime, 'package-lock.json')) !== fileHash(join(source, 'package-lock.json'))) throw new DomainError('runtime_lock_mismatch');
    const lock = JSON.parse(readFileSync(join(runtime, 'package-lock.json'), 'utf8')) as { lockfileVersion: number; packages: Record<string, { dev?: boolean; link?: boolean; optional?: boolean; version?: string }> };
    if (lock.lockfileVersion !== 3) throw new DomainError('unsupported_lockfile');
    for (const [path, metadata] of Object.entries(lock.packages)) {
      if (!path.startsWith('node_modules/') || metadata.dev || metadata.link) continue;
      const module = safePath(runtime, path); if (!existsSync(module)) { if (metadata.optional) continue; throw new DomainError('runtime_dependency_missing'); }
      const pkg = JSON.parse(readFileSync(join(module, 'package.json'), 'utf8')) as { version: string }; if (pkg.version !== metadata.version) throw new DomainError('runtime_dependency_version_mismatch');
      copyTree(module, join(output, path));
    }
  }
  const notices = [];
  const moduleRoot = join(output, 'node_modules'); if (existsSync(moduleRoot)) for (const file of inventory(moduleRoot)) if (file.path.endsWith('package.json')) { try { const pkg = JSON.parse(readFileSync(join(moduleRoot, file.path), 'utf8')) as { name?: string; version?: string; license?: string }; if (pkg.name && pkg.version) notices.push({ name: pkg.name, version: pkg.version, license: pkg.license ?? 'Review required', path: `node_modules/${file.path}` }); } catch { /* Non-package JSON is not a licensing claim. */ } }
  atomicJson(join(output, 'dependency-notices.json'), { packages: notices, note: 'Dependency sources and their distributed license files remain in node_modules. Application license is not inferred from dependencies.' });
  let revision = `snapshot:${sourceHash}`; try { revision = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 5000, windowsHide: true }).trim(); } catch { /* Content-addressed provenance remains explicit without Git. */ }
  const manifest: ReleaseManifest = { releaseId: `local-${sourceHash.slice(0, 12)}-${requestId.slice(0, 8)}`, sourceRevision: revision, sourceSnapshotHash: sourceHash, createdAt: new Date().toISOString(), requestId, baseReleaseId: options.baseReleaseId ?? null, files: inventory(output), nodeMajor: 24, lockfileHash: fileHash(join(output, 'package-lock.json')), apiProtocol: 1, brokerProtocolRange: [1, 1], schemaReadRange: [3, 3], schemaWriteVersion: 3, migrationIds: [1, 2, 3], testEvidenceHashes: options.testEvidenceHashes, activationClass: 'manual' };
  if (sourceSnapshot(source, sourceFiles) !== sourceHash) throw new DomainError('source_changed_during_package');
  writeFileSync(join(output, 'release-manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 }); return { ...verifyRelease(output), root: output };
}
