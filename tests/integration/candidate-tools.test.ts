import { it, expect } from 'vitest';
import { mkdirSync, copyFileSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { CandidateTools } from '../../apps/supervisor/src/candidate-tools.js';
import { publicSourceFiles } from '../../apps/supervisor/src/package.js';
import { parseConfig } from '../../packages/contracts/src/config.js';
import { createTestRoot, cleanupTestRoot } from '../../packages/test-support/src/index.js';
it('T31 a candidate runner proves an actual browser assertion fails before and passes after a source fix', async () => {
  const t = createTestRoot(); const candidate = createTestRoot(); const source = join(candidate.root, 'source'); mkdirSync(source);
  try { for (const file of publicSourceFiles(process.cwd())) { const path = join(source, file); mkdirSync(dirname(path), { recursive: true }); copyFileSync(file, path); }
    const regression = 'tests/e2e/update-candidate-tools.spec.ts'; writeFileSync(join(source, regression), "import {test,expect} from '@playwright/test'; test('isolated candidate regression',async({page})=>{await page.goto('/today');await expect(page.getByRole('heading',{name:'Pair your fixture device',exact:true})).toBeVisible({timeout:500});});"); const tools = new CandidateTools(t.root, parseConfig({ executionHost: { toolchainRoot: process.cwd() } }), true); const before = await tools.regression(source, regression); expect(before.exitCode).not.toBe(0); expect(before.failure).toBe('assertion'); const main = join(source, 'apps/web/src/main.tsx'); writeFileSync(main, readFileSync(main, 'utf8').replace('<h1>Connect this device</h1>', '<h1>Pair your fixture device</h1>')); const after = await tools.regression(source, regression); expect(after.exitCode).toBe(0); expect(after.failure).toBeNull(); expect(before.hash).not.toBe(after.hash); expect(readFileSync('apps/web/src/main.tsx', 'utf8')).toContain('<h1>Connect this device</h1>');
  } finally { cleanupTestRoot(candidate.root, candidate.runId); cleanupTestRoot(t.root, t.runId); }
}, 90000);
