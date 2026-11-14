import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { atomicJson } from '../../../packages/contracts/src/files.js';
import { canonicalJson, DomainError } from '../../../packages/contracts/src/commands.js';
import { processIdentity, sameProcess, type ProcessIdentity } from './process-identity.js';
type Owner = ProcessIdentity & { installationId: string; endpoint: string; protocol: 1 };
export async function writeOwner(root: string, role: string, installationId: string, endpoint: string, key: string) {
  const identity = await processIdentity(process.pid); if (!identity) throw new DomainError('process_identity_unavailable');
  const record: Owner = { ...identity, installationId, endpoint, protocol: 1 }; atomicJson(join(root, 'state', `${role}-owner.json`), { record, signature: createHmac('sha256', key).update(`${role}:`).update(canonicalJson(record)).digest('hex') }); return record;
}
export async function readOwner(root: string, role: string, installationId: string, key: string): Promise<Owner | null> {
  const file = join(root, 'state', `${role}-owner.json`); if (!existsSync(file)) return null;
  let record: Owner; let signature: string; try { ({ record, signature } = JSON.parse(readFileSync(file, 'utf8')) as { record: Owner; signature: string }); const supplied = Buffer.from(signature, 'hex'); const expected = createHmac('sha256', key).update(`${role}:`).update(canonicalJson(record)).digest(); if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected) || record.installationId !== installationId || record.protocol !== 1) throw new Error(); } catch { throw new DomainError('owner_registry_invalid'); }
  return await sameProcess(record) ? record : null;
}
