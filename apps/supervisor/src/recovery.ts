import Database from 'better-sqlite3';
import { readFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash, createHmac } from 'node:crypto';
import { Store } from '../../server/src/db/store.js';
import { installationSecrets } from '../../broker/src/certification.js';
import { acquireInstance } from '../../broker/src/instance.js';
import { readOwner } from '../../broker/src/registry.js';
import { canonicalJson, DomainError } from '../../../packages/contracts/src/commands.js';
import { canonicalPath, safePath } from '../../../packages/contracts/src/paths.js';
import { dataAccess } from '../../server/src/security/access.js';
import { assertTestRoot } from '../../../packages/test-support/src/index.js';
import { verifyRelease } from './releases.js';
import { ReceiptJournal } from '../../broker/src/journal.js';
import { atomicJson, copyPrimaryFile } from '../../../packages/contracts/src/files.js';
function logicalHash(db: Database.Database) {
  const hash = createHash('sha256'); const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[];
  for (const { name } of tables) { if (!/^[a-z_]+$/.test(name)) throw new DomainError('recovery_schema_invalid'); const rows = db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all() as Record<string, unknown>[]; hash.update(name); for (const row of rows) { if (name === 'service_checkpoints' && row.name === 'recovery') continue; if (name === 'installations') delete row.dispatch_paused; hash.update(canonicalJson(row)); } } return hash.digest('hex');
}
function materialHash(root: string) {
  const hash = createHash('sha256'); const files = ['state/config.json', 'state/device-key', 'state/ipc-secrets.json', 'state/broker-receipts.jsonl', 'state/broker-events.jsonl', 'state/update-worker.jsonl', 'supervisor/active.json', 'supervisor/activation.jsonl'];
  for (const folder of ['state/evidence', 'state/sources', 'state/certifications', 'state/update-grants', 'supervisor/improvements', 'supervisor/validation']) { const path = join(root, folder); if (existsSync(path)) for (const item of readdirSync(path, { withFileTypes: true })) { if (!item.isFile() || item.isSymbolicLink()) throw new DomainError('recovery_material_invalid'); files.push(`${folder}/${item.name}`); } }
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
      const updates = new ReceiptJournal(join(source, 'state/update-worker.jsonl')); if ([...new Map(updates.list().map(receipt => [receipt.commandId, receipt])).values()].some(receipt => receipt.state !== 'resolved') || original.prepare("SELECT 1 FROM updates WHERE state IN ('reproducing','implementing','verifying','activating','checking','rolling_back') LIMIT 1").get()) return { state: 'reconciliation_required', code: 'unresolved_update_work', nextAction: 'Reconcile the source update worker before creating a fresh backup.' };
      // Application bytes come from verified immutable releases, never from a database archive.
      const pointerFile = join(source, 'supervisor/active.json'); if (existsSync(pointerFile)) { const pointer = JSON.parse(readFileSync(pointerFile, 'utf8')) as { current: string; previous: string | null; phase: string }; if (pointer.phase !== 'stable') throw new DomainError('source_release_recovery_required'); const copyBundle = (from: string, to: string) => { const release = verifyRelease(from); for (const file of [...release.manifest.files, { path: 'release-manifest.json' }]) { const destination = safePath(to, file.path); mkdirSync(dirname(destination), { recursive: true }); copyPrimaryFile(safePath(from, file.path), destination); } verifyRelease(to, release.hash); }; for (const id of [pointer.current, pointer.previous].filter((id): id is string => Boolean(id))) { const destination = safePath(target, `releases/${id}`); mkdirSync(destination, { recursive: true }); copyBundle(safePath(source, `releases/${id}`), destination); } const runtime = join(target, 'supervisor/runtime'); mkdirSync(runtime, { recursive: true }); copyBundle(safePath(source, 'supervisor/runtime'), runtime); }
      const proof = logicalHash(original); const fence = { installationId: sourceInstallation.id, restoredRootHash: createHash('sha256').update(canonicalPath(target)).digest('hex'), proof, retiredAt: Date.now() }; atomicJson(join(source, 'state/recovery-fence.json'), { fence, signature: createHmac('sha256', sourceKeys.supervisor).update(canonicalJson(fence)).digest('hex') }); restored.db.prepare("UPDATE service_checkpoints SET state_json=? WHERE name='recovery'").run(JSON.stringify({ reconciliationRequired: false, sourceProof: proof, verifiedAt: Date.now(), sourceWasStopped: true })); return { state: 'reconciled_paused', proof, dispatchPaused: true, sourceRetired: true };
    } finally { restored.close(); original.close(); }
  } finally { for (const lock of locks.reverse()) await lock.release(); }
}
