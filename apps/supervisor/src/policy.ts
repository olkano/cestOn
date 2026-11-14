import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { ReleaseManifest } from '../../../packages/contracts/src/release.js';
import { canonicalJson } from '../../../packages/contracts/src/commands.js';
export const updatePolicy = { version: 1, protectedPrefixes: ['apps/supervisor/', 'apps/broker/', 'packages/adapters/', 'apps/server/src/auth/', 'apps/server/src/authority/', 'apps/server/src/commands/', 'apps/server/src/db/', 'apps/server/src/http/', 'apps/server/src/updates/', 'apps/server/src/scheduler/', 'apps/server/src/verification/', 'apps/server/src/security/', 'packages/contracts/', 'scripts/'], protectedFiles: ['AGENTS.md', 'package.json', 'package-lock.json', '.npmrc', 'apps/server/src/create-app.ts', 'apps/server/src/main.ts', 'apps/server/src/runtime.ts', 'vitest.config.ts', 'playwright.config.ts', 'eslint.config.js', 'tsconfig.json', 'tsconfig.build.json'] };
export const policyHash = createHash('sha256').update(canonicalJson(updatePolicy)).digest('hex');
export function classifyChanges(base: ReleaseManifest, candidate: ReleaseManifest, baseRoot: string, candidateRoot: string) {
  const before = new Map(base.files.filter(f => f.path.startsWith('source/')).map(file => [file.path.slice(7), file.sha256]));
  const after = new Map(candidate.files.filter(f => f.path.startsWith('source/')).map(file => [file.path.slice(7), file.sha256]));
  const changed = [...new Set([...before.keys(), ...after.keys()])].filter(path => before.get(path) !== after.get(path));
  const protectedPaths = changed.filter(path => updatePolicy.protectedFiles.includes(path) || updatePolicy.protectedPrefixes.some(prefix => path.startsWith(prefix)) || (path.startsWith('tests/security/') || path.startsWith('tests/updates/')) && before.has(path) || /(^|\/)package\.json$|(^|\/)(?:[^/]*config\.[cm]?[jt]s|\.env.*)$/.test(path));
  protectedPaths.push(...changed.filter(path => before.has(path) && (path.startsWith('tests/') || /\.(?:test|spec)\.[jt]sx?$/.test(path))));
  for (const file of ['package.json', ...changed.filter(path => path.endsWith('/package.json'))]) {
    const old = join(baseRoot, 'source', file); const next = join(candidateRoot, 'source', file);
    if (!existsSync(old) || !existsSync(next) || readFileSync(old, 'utf8') !== readFileSync(next, 'utf8')) protectedPaths.push(file);
  }
  const runtimePaths = new Set([...base.files, ...candidate.files].map(file => file.path));
  const runtimeChanges = [...runtimePaths].filter(path => !path.startsWith('source/') && !path.startsWith('apps/web/dist/') && base.files.find(old => old.path === path)?.sha256 !== candidate.files.find(file => file.path === path)?.sha256).map(path => ({ path }));
  const dependencyChanged = runtimeChanges.some(file => file.path.startsWith('node_modules/') || file.path === 'package-lock.json');
  if (dependencyChanged) protectedPaths.push('runtime dependencies');
  if (runtimeChanges.some(file => file.path.startsWith('dist/apps/supervisor/') || file.path.startsWith('dist/apps/broker/') || file.path.startsWith('scripts/'))) protectedPaths.push('privileged runtime');
  if (runtimeChanges.some(file => file.path.startsWith('dist/') && !file.path.endsWith('.map') && updatePolicy.protectedPrefixes.some(prefix => file.path.startsWith(`dist/${prefix}`)))) protectedPaths.push('protected compiled runtime');
  return { activationClass: protectedPaths.length ? 'protected' as const : changed.some(path => path.startsWith('apps/broker/')) ? 'broker' as const : 'coordinator' as const, changed, protectedPaths: [...new Set(protectedPaths)] };
}
