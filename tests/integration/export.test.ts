import { it, expect } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTestRoot, cleanupTestRoot } from '../../packages/test-support/src/index.js';
import { publicSourceFiles } from '../../apps/supervisor/src/package.js';
import { sensitiveContent } from '../../apps/supervisor/src/export.js';
import { copyPrimaryFile } from '../../packages/contracts/src/files.js';
it('T36 the public allowlist excludes private roots and flags credentials or personal home paths', () => {
  const t = createTestRoot();
  try { for (const path of ['apps/web', 'zz_Specifications/reference-private', 'zz_Specifications/evidence-private', 'state', 'node_modules/hostile']) mkdirSync(join(t.root, path), { recursive: true }); for (const path of ['apps/web/main.ts', 'zz_Specifications/reference-private/history.md', 'zz_Specifications/evidence-private/report.md', 'state/credentials.json', '.env', 'node_modules/hostile/main.js']) writeFileSync(join(t.root, path), 'synthetic'); expect(publicSourceFiles(t.root)).toEqual(['apps/web/main.ts']); const target = join(t.root, 'copied.ts'); copyPrimaryFile(join(t.root, 'apps/web/main.ts'), target); expect(readFileSync(target, 'utf8')).toBe('synthetic'); expect(sensitiveContent('ghp_' + 'x'.repeat(36))).toEqual(['credential_pattern']); expect(sensitiveContent(['C:', 'Users', 'private-owner', 'work'].join('\\'))).toEqual(['personal_home_path']); expect(sensitiveContent('https://example.invalid/config')).toEqual([]); }
  finally { cleanupTestRoot(t.root, t.runId); }
});
