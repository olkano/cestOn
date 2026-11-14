import { it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestRoot, assertTestRoot, cleanupTestRoot } from './index.js';
import { validateDataRoot, safePath } from '../../contracts/src/paths.js';

it('T02 refuses unmarked roots and preserves a changed marker', () => {
  const plain = mkdtempSync(join(tmpdir(), 'ceston-unmarked-'));
  const test = createTestRoot();
  try {
    expect(() => assertTestRoot(plain)).toThrow();
    expect(() => validateDataRoot(process.cwd(), [process.cwd()])).toThrow();
    expect(() => cleanupTestRoot(plain, test.runId)).toThrow();
    writeFileSync(join(test.root, '.ceston-test.json'), JSON.stringify({ runId: 'wrong', installationId: test.installationId }));
    expect(() => cleanupTestRoot(test.root, test.runId)).toThrow();
  } finally { rmSync(plain, { recursive: true }); rmSync(test.root, { recursive: true }); }
});

it('T07 resolves junctions and rejects path escape', () => {
  const t = createTestRoot(); const other = createTestRoot();
  try {
    mkdirSync(join(t.root, 'child'));
    symlinkSync(other.root, join(t.root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => safePath(t.root, '../outside')).toThrow();
    expect(() => safePath(t.root, 'escape')).toThrow();
    expect(safePath(t.root, 'child')).toContain('child');
  } finally { cleanupTestRoot(t.root, t.runId); cleanupTestRoot(other.root, other.runId); }
});
it('T02 newly created roots use the canonical temp parent when its configured name is an alias', () => {
  const outer = createTestRoot(); const actual = join(outer.root, 'temporary'); const alias = join(outer.root, 'temporary-alias'); mkdirSync(actual); symlinkSync(actual, alias, process.platform === 'win32' ? 'junction' : 'dir'); const previous = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR }; let nested: ReturnType<typeof createTestRoot> | undefined;
  try { process.env.TEMP = alias; process.env.TMP = alias; process.env.TMPDIR = alias; nested = createTestRoot(); expect(nested.root).toBe(realpathSync.native(nested.root)); expect(assertTestRoot(nested.root).runId).toBe(nested.runId); }
  finally { if (nested) cleanupTestRoot(realpathSync.native(nested.root), nested.runId); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } cleanupTestRoot(outer.root, outer.runId); }
});
