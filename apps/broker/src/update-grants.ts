import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { z } from 'zod';
import { atomicJson } from '../../../packages/contracts/src/files.js';
import { canonicalJson, DomainError } from '../../../packages/contracts/src/commands.js';
import { canonicalPath, within } from '../../../packages/contracts/src/paths.js';
import { assertTestRoot } from '../../../packages/test-support/src/index.js';
import { installationSecrets } from './certification.js';
import type { ImprovementRequest } from '../../supervisor/src/improvement.js';
const grantSchema = z.strictObject({ id: z.uuid(), workspace: z.string().min(1).max(2048), runId: z.uuid(), request: z.unknown(), stage: z.enum(['regression', 'implementation']), regression: z.string().regex(/^tests\/e2e\/update-[a-f0-9-]{36}\.spec\.ts$/), expiresAt: z.number().int() });
type Grant = Omit<z.infer<typeof grantSchema>, 'request'> & { request: ImprovementRequest };
export function grantUpdate(root: string, workspace: string, request: ImprovementRequest, stage: Grant['stage'], regression: string) {
  const marker = assertTestRoot(dirname(workspace)); const grant = grantSchema.parse({ id: randomUUID(), workspace, runId: marker.runId, request, stage, regression, expiresAt: Date.now() + 120000 });
  const signature = createHmac('sha256', installationSecrets(root).supervisor).update(canonicalJson(grant)).digest('hex');
  atomicJson(join(root, 'state/update-grants', `${grant.id}.json`), { grant, signature }); return grant.id;
}
export function readUpdateGrant(root: string, id: string): Grant {
  z.uuid().parse(id);
  const value = JSON.parse(readFileSync(join(root, 'state/update-grants', `${id}.json`), 'utf8')) as { grant: unknown; signature: string }; const grant = grantSchema.parse(value.grant);
  const expected = createHmac('sha256', installationSecrets(root).supervisor).update(canonicalJson(grant)).digest(); const supplied = Buffer.from(value.signature, 'hex');
  if (supplied.length !== expected.length || !timingSafeEqual(expected, supplied) || grant.id !== id || grant.expiresAt < Date.now() || grant.expiresAt > Date.now() + 120000) throw new DomainError('update_grant_denied');
  assertTestRoot(dirname(grant.workspace), grant.runId);
  if (canonicalPath(join(dirname(grant.workspace), 'source')) !== canonicalPath(grant.workspace) || within(root, grant.workspace) || within(grant.workspace, root)) throw new DomainError('update_workspace_denied');
  return grant as Grant;
}
