import { it, expect } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { grantUpdate, readUpdateGrant } from './update-grants.js';
import { createTestRoot, cleanupTestRoot } from '../../../packages/test-support/src/index.js';
import { limitsSchema } from '../../../packages/contracts/src/config.js';
import type { ImprovementRequest } from '../../supervisor/src/improvement.js';
it('update delegation rejects forged payloads, expired grants and live installation roots', () => {
  const installation = createTestRoot(); const candidate = createTestRoot(); const workspace = join(candidate.root, 'source'); mkdirSync(workspace);
  const request: ImprovementRequest = { taskId: randomUUID(), commandId: randomUUID(), deviceId: randomUUID(), requestHash: 'a'.repeat(64), description: 'Synthetic update', acceptanceCriteria: ['Remember filter'], applyLocally: false, budgets: limitsSchema.parse({ turns: 2, runMinutes: 2, concurrency: 1 }), provider: null };
  try {
    const id = grantUpdate(installation.root, workspace, request, 'regression', `tests/e2e/update-${randomUUID()}.spec.ts`); const path = join(installation.root, 'state/update-grants', `${id}.json`); const original = readFileSync(path, 'utf8'); expect(readUpdateGrant(installation.root, id).request.taskId).toBe(request.taskId);
    const forged = JSON.parse(original); forged.grant.request.budgets.turns = 128; writeFileSync(path, JSON.stringify(forged)); expect(() => readUpdateGrant(installation.root, id)).toThrow('update_grant_denied');
    writeFileSync(path, original); const now = Date.now; Date.now = () => now() + 121000; try { expect(() => readUpdateGrant(installation.root, id)).toThrow('update_grant_denied'); } finally { Date.now = now; }
    const live = join(installation.root, 'source'); mkdirSync(live); const liveId = grantUpdate(installation.root, live, request, 'implementation', `tests/e2e/update-${randomUUID()}.spec.ts`); expect(() => readUpdateGrant(installation.root, liveId)).toThrow('update_workspace_denied');
  } finally { cleanupTestRoot(candidate.root, candidate.runId); cleanupTestRoot(installation.root, installation.runId); }
});
