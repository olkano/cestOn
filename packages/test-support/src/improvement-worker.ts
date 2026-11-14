import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { assertTestRoot } from './index.js';
import type { ImprovementWorker, ImprovementRequest } from '../../../apps/supervisor/src/improvement.js';
import { DomainError } from '../../contracts/src/commands.js';
export class FixtureImprovementWorker implements ImprovementWorker {
  constructor(private root: string) { assertTestRoot(root); }
  async edit(candidate: string, request: ImprovementRequest, stage: 'regression' | 'implementation', regression: string) {
    assertTestRoot(this.root); assertTestRoot(dirname(candidate)); if (!request.description.startsWith('Synthetic self-update scenario:') || !/^tests\/e2e\/update-[a-f0-9-]{36}\.spec\.ts$/.test(regression)) throw new DomainError('fixture_improvement_scope_denied');
    if (stage === 'regression') { const path = join(candidate, regression); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, "import {test,expect} from '@playwright/test'; import {pair} from './helpers.js'; test('Work remembers its selected filter after returning',async({page})=>{await pair(page);await page.getByRole('link',{name:'Work',exact:true}).click();await page.getByRole('combobox',{name:'Status',exact:true}).selectOption('paused');await page.reload();await expect(page.getByRole('combobox',{name:'Status',exact:true})).toHaveValue('paused');});\n", { flag: 'wx' }); }
    else if (request.description.includes(': protected')) { const path = join(candidate, 'apps/server/src/auth/synthetic-protected-change.ts'); writeFileSync(path, 'export const syntheticProtectedChange = true;\n', { flag: 'wx' }); }
    else if (!request.description.includes(': failing')) writeFileSync(join(candidate, 'apps/web/src/work-filters.ts'), readFileSync(join(this.root, 'supervisor/fixture-work-filter.txt')));
  }
}
