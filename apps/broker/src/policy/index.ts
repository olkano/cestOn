import { resolve, relative } from 'node:path';
import { existsSync, readdirSync, lstatSync } from 'node:fs';
import { canonicalPath, within, safePath } from '../../../../packages/contracts/src/paths.js';
import type { ProjectConfig } from '../../../../packages/contracts/src/config.js';

export type Permission = { allowed: boolean; reason: string };
export function childEnvironment(source: NodeJS.ProcessEnv, credentialNames: string[] = []): NodeJS.ProcessEnv {
  const normalize = (name: string) => process.platform === 'win32' ? name.toUpperCase() : name;
  const allow = new Set(['PATH', 'Path', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'LANG', 'TERM', ...credentialNames].map(normalize)); const result: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(source)) { const key = normalize(name); if (!allow.has(key) || value === undefined) continue; if (result[key] !== undefined && result[key] !== value) throw new Error('conflicting_child_environment'); result[key] = value; }
  return result;
}
export class ToolPolicy {
  readonly root: string;
  constructor(root: string, private operations: string[], readonly recipes: ProjectConfig['recipes'], private protectedPaths: string[] = []) { this.root = canonicalPath(root); }
  check(tool: string, input: Record<string, unknown>): Permission {
    const denied = (reason: string) => ({ allowed: false, reason });
    if (!['Read', 'Write', 'Edit', 'Glob', 'Grep', 'ceston.recipe'].includes(tool)) return denied('Unsupported tool. Use registered operations.');
    if (tool === 'ceston.recipe') {
      const recipe = this.recipes.find(r => r.id === input.recipeId);
      return recipe && Object.keys(input).length === 1 && this.operations.includes(recipe.operation) ? { allowed: true, reason: 'Registered recipe' } : denied('Recipe is outside task scope');
    }
    const write = tool === 'Write' || tool === 'Edit';
    if (!this.operations.includes(write ? 'edit' : 'read')) return denied('Operation is outside task scope');
    const path = input.file_path ?? input.path ?? this.root;
    if (typeof path !== 'string') return denied('A scoped path is required');
    try {
      const target = safePath(this.root, relative(this.root, resolve(this.root, path)));
      if (!within(this.root, target)) return denied('Path is outside task scope');
      const pieces = relative(this.root, target).split(/[\\/]/);
      if (pieces.some(p => p === '.git' || /^\.env(?:\.(?!example$).*)?$|^(?:auth|credentials)\.json$|^id_(?:rsa|ed25519)$|\.(?:pem|key)$/i.test(p))) return denied('Protected data path');
      if (write && (pieces.includes('node_modules') || this.protectedPaths.some(p => target === canonicalPath(resolve(this.root, p)) || within(resolve(this.root, p), target)))) return denied('Protected update surface');
      if (tool === 'Glob' || tool === 'Grep') {
        const pattern = input.pattern;
        if (typeof pattern !== 'string' || pattern.length > 2000 || (tool === 'Glob' && (pattern.includes('..') || /^[\\/]|^[a-z]:/i.test(pattern)))) return denied('Unsafe search pattern');
        const pending = [target]; let visited = 0;
        while (pending.length) {
          const directory = pending.pop()!;
          if (!existsSync(directory)) continue;
          const stat = lstatSync(directory);
          if (stat.isSymbolicLink()) return denied('Search crosses a path link');
          if (!stat.isDirectory()) continue;
          for (const child of readdirSync(directory, { withFileTypes: true })) {
            if (++visited > 10000) return denied('Search exceeds bounded inspection');
            if (child.isSymbolicLink()) return denied('Search crosses a path link');
            if (child.isDirectory()) pending.push(resolve(directory, child.name));
          }
        }
      }
      return { allowed: true, reason: 'Registered workspace and operation' };
    } catch { return denied('Path could not be verified'); }
  }
}
