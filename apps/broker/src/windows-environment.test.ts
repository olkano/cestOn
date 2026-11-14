import { it, expect } from 'vitest';
import { join } from 'node:path';
import { windowsHelperEnvironment } from './windows-environment.js';
it('OS helpers search only built-in Windows PowerShell modules and retain no caller module path or credentials', () => {
  const environment = windowsHelperEnvironment({ SystemRoot: 'C:\\Windows', PATH: 'bin', PSModulePath: 'hostile-module-root', ANTHROPIC_API_KEY: 'private' });
  expect(environment.PSModulePath).toBe(join('C:\\Windows', 'System32/WindowsPowerShell/v1.0/Modules'));
  expect(environment.ANTHROPIC_API_KEY).toBeUndefined();
  expect(() => windowsHelperEnvironment({ PATH: 'bin' })).toThrow('windows_system_root_required');
});
