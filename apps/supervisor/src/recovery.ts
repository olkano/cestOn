import Database from 'better-sqlite3';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, createHmac } from 'node:crypto';
import { Store } from '../../server/src/db/store.js';
import { installationSecrets } from '../../broker/src/certification.js';
import { acquireInstance } from '../../broker/src/instance.js';
import { readOwner } from '../../broker/src/registry.js';
import { canonicalJson, DomainError } from '../../../packages/contracts/src/commands.js';
import { canonicalPath, safePath } from '../../../packages/contracts/src/paths.js';
import { dataAccess } from '../../server/src/security/access.js';
import { assertTestRoot } from '../../../packages/test-support/src/index.js';
import { atomicJson } from '../../../packages/contracts/src/files.js';
function logicalHash(db: Database.Database) {
  const hash = createHash('sha256'); const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[];
  for (const { name } of tables) { if (!/^[a-z_]+$/.test(name)) throw new DomainError('recovery_schema_invalid'); const rows = db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all() as Record<string, unknown>[]; hash.update(name); for (const row of rows) { if (name === 'service_checkpoints' && row.name === 'recovery') continue; if (name === 'installations') delete row.dispatch_paused; hash.update(canonicalJson(row)); } } return hash.digest('hex');
}
function materialHash(root: string) {
  const hash = createHash('sha256'); const files = ['state/config.json', 'state/device-key', 'state/ipc-secrets.json', 'state/broker-receipts.jsonl', 'state/broker-events.jsonl'];
  for (const folder of ['evidence', 'sources', 'certifications']) { const path = join(root, 'state', folder); if (existsSync(path)) for (const item of readdirSync(path, { withFileTypes: true })) { if (!item.isFile() || item.isSymbolicLink()) throw new DomainError('recovery_material_invalid'); files.push(`state/${folder}/${item.name}`); } }
  for (const file of files.sort()) { hash.update(file).update(existsSync(join(root, file)) ? readFileSync(safePath(root, file)) : 'absent'); } return hash.digest('hex');
}
export async function reconcileRestore(target: string, source: string, testMode = false) {
  if (canonicalPath(target) === canonicalPath(source)) throw new DomainError('independent_recovery_source_required'); if (testMode) { assertTestRoot(target); assertTestRoot(source); } else { await dataAccess(target); await dataAccess(source); }
  const locks: Awaited<ReturnType<typeof acquireInstance>>[] = []; const sourceKeys = installationSecrets(source); const targetKeys = installationSecrets(target);
  try {
    for (const [root, keys] of [[source, sourceKeys], [target, targetKeys]] as const) for (const role of ['supervisor', 'coordinator', 'broker']) locks.push(await acquireInstance(root, role, role === 'broker' ? keys.broker : keys.supervisor));
    const original = new Database(join(source, 'state/ceston.sqlite'), { readonly: true }); const restored = new Store(target, { testMode });
    try {
      restored.db.prepare("UPDATE service_checkpoints SET state_json=? WHERE name='recovery'").run(JSON.stringify({ reconciliationRequired: true }));
      const sourceInstallation = original.prepare('SELECT id FROM installations').get() as { id: string }; if (sourceInstallation.id !== restored.installation().id) throw new DomainError('recovery_installation_mismatch');
      for (const role of ['supervisor', 'coordinator', 'broker']) if (await readOwner(source, role, sourceInstallation.id, role === 'broker' ? sourceKeys.broker : sourceKeys.supervisor)) throw new DomainError('recovery_source_running');
      if (original.pragma('integrity_check', { simple: true }) !== 'ok') throw new DomainError('recovery_source_invalid');
      if (logicalHash(original) !== logicalHash(restored.db) || materialHash(source) !== materialHash(target)) return { state: 'reconciliation_required', code: 'backup_delta_present', nextAction: 'Preserve both roots. Create and verify a fresh consistent backup from the stopped intact source, then restore that snapshot. Do not resume this older snapshot.' };
      if (original.prepare('SELECT 1 FROM leases LIMIT 1').get() || original.prepare('SELECT 1 FROM outbox LIMIT 1').get() || original.prepare("SELECT 1 FROM runs WHERE state NOT IN ('succeeded','failed','interrupted') LIMIT 1").get()) return { state: 'reconciliation_required', code: 'unresolved_work', nextAction: 'Reconcile owned provider work in the source installation before creating the replacement backup.' };
      const proof = logicalHash(original); const fence = { installationId: sourceInstallation.id, restoredRootHash: createHash('sha256').update(canonicalPath(target)).digest('hex'), proof, retiredAt: Date.now() }; atomicJson(join(source, 'state/recovery-fence.json'), { fence, signature: createHmac('sha256', sourceKeys.supervisor).update(canonicalJson(fence)).digest('hex') }); restored.db.prepare("UPDATE service_checkpoints SET state_json=? WHERE name='recovery'").run(JSON.stringify({ reconciliationRequired: false, sourceProof: proof, verifiedAt: Date.now(), sourceWasStopped: true })); return { state: 'reconciled_paused', proof, dispatchPaused: true, sourceRetired: true };
    } finally { restored.close(); original.close(); }
  } finally { for (const lock of locks.reverse()) await lock.release(); }
}
