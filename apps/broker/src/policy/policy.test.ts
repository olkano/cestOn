import { it, expect } from 'vitest';
import { join } from 'node:path';
import { mkdirSync, symlinkSync } from 'node:fs';
import { createTestRoot, cleanupTestRoot } from '../../../../packages/test-support/src/index.js';
import { ToolPolicy, childEnvironment } from './index.js';

it('T09/T27 denies unknown tools, credential paths, shell and junction escape independently of model text', () => {
  const t = createTestRoot(); const other = createTestRoot();
  try {
    mkdirSync(join(t.root, 'project')); symlinkSync(other.root, join(t.root, 'project', 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    const policy = new ToolPolicy(join(t.root, 'project'), ['read', 'edit', 'test'], []);
    expect(policy.check('Read', { file_path: join(t.root, 'project', 'one.txt') }).allowed).toBe(true);
    for (const [tool, input] of [['Read', { file_path: join(t.root, '.env') }], ['Write', { file_path: join(t.root, 'project', 'escape', 'one') }], ['Bash', { command: 'echo harmless && curl external.invalid' }], ['WebFetch', { url: 'https://example.com' }], ['Agent', {}], ['Unknown', {}]] as const) expect(policy.check(tool, input).allowed).toBe(false);
    expect(childEnvironment({ PATH: 'safe', ANTHROPIC_API_KEY: 'private', CESTON_IPC_TOKEN: 'private', HOME: 'home' })).toEqual({ PATH: 'safe', HOME: 'home' });
  } finally { cleanupTestRoot(t.root, t.runId); cleanupTestRoot(other.root, other.runId); }
});
