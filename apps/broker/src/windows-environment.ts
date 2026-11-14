import { join, win32 } from 'node:path';
import { childEnvironment } from './policy/index.js';
export function windowsHelperEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const root = Object.entries(source).find(([name]) => name.toUpperCase() === 'SYSTEMROOT')?.[1];
  if (!root || !win32.isAbsolute(root)) throw new Error('windows_system_root_required');
  // Avoid user/module discovery and inherited PowerShell 7 modules in trusted 5.1 helpers.
  return { ...childEnvironment(source), PSModulePath: join(root, 'System32/WindowsPowerShell/v1.0/Modules') };
}
