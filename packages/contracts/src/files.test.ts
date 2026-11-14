import { it, expect } from 'vitest';
import { writeFileSync, readFileSync, linkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { copyPrimaryFile } from './files.js';
import { createTestRoot, cleanupTestRoot } from '../../test-support/src/index.js';
it('immutable copies exclude Windows alternate streams and refuse linked source bytes', () => {
  const t = createTestRoot();
  try { const source = join(t.root, 'source.txt'); const target = join(t.root, 'target.txt'); writeFileSync(source, 'primary bytes'); if (process.platform === 'win32') writeFileSync(`${source}:synthetic`, 'unmanifested bytes'); copyPrimaryFile(source, target); expect(readFileSync(target, 'utf8')).toBe('primary bytes'); if (process.platform === 'win32') expect(existsSync(`${target}:synthetic`)).toBe(false); linkSync(source, join(t.root, 'linked.txt')); expect(() => copyPrimaryFile(source, join(t.root, 'denied.txt'))).toThrow('copy_path_denied'); }
  finally { cleanupTestRoot(t.root, t.runId); }
});
