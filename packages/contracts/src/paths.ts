import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export function canonicalPath(input: string): string {
  if (!isAbsolute(input)) throw new Error('An absolute root is required');
  let path = resolve(input); const suffix: string[] = [];
  while (!existsSync(path)) {
    try { if (lstatSync(path).isSymbolicLink()) throw new Error('Dangling path link is unsafe'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const parent = resolve(path, '..'); if (parent === path) throw new Error('Root not found'); suffix.unshift(path.slice(parent.length + (parent.endsWith(sep) ? 0 : 1))); path = parent;
  }
  const real = resolve(realpathSync.native(path), ...suffix);
  return process.platform === 'win32' ? real.toLowerCase() : real;
}
export function within(root: string, target: string): boolean {
  const r = relative(canonicalPath(root), canonicalPath(target));
  return r === '' || (!r.startsWith(`..${sep}`) && r !== '..' && !isAbsolute(r));
}
export function safePath(root: string, path: string): string {
  if (isAbsolute(path) || path.includes('\0')) throw new Error('Relative path required');
  if (path.includes(':') || path.split(/[\\/]/).some(part => (part !== '.' && part !== '..' && /[. ]$/.test(part)) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error('Unsafe portable path');
  const target = resolve(root, path);
  if (!within(root, target)) throw new Error('Path escapes registered root');
  return target;
}
export function validateDataRoot(root: string, projectRoots: string[] = []): string {
  const canonical = canonicalPath(root);
  if (canonical.split(/[\\/]/).some(p => /^(onedrive(?: .*)?|dropbox|google drive|icloud(?:drive)?)$/i.test(p))) throw new Error('Cloud synchronized data roots are unsupported');
  if (projectRoots.some(p => within(p, canonical) || within(canonical, p))) throw new Error('Data and project roots must not overlap');
  let parent = canonical;
  while (true) {
    if (existsSync(resolve(parent, '.git'))) throw new Error('Data root must be outside a source checkout');
    const next = resolve(parent, '..'); if (next === parent) break; parent = next;
  }
  if (existsSync(canonical) && !lstatSync(canonical).isDirectory()) throw new Error('Data root is not a directory');
  return canonical;
}
