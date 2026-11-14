import { readdirSync, existsSync, statSync } from 'node:fs';
import type { Store } from '../../server/src/db/store.js';
import { safePath } from '../../../packages/contracts/src/paths.js';
export function retention(store: Store, dryRun = true) {
  let bytes = 0; const walk = (directory: string) => { if (!existsSync(directory)) return; for (const entry of readdirSync(directory, { withFileTypes: true })) { if (entry.isSymbolicLink()) continue; const file = safePath(directory, entry.name); if (entry.isDirectory()) walk(file); else if (entry.isFile()) bytes += statSync(file).size; } }; walk(store.dataRoot);
  const commands = dryRun ? { commands: 0 } : store.prune();
  return { dryRun, bytes, ...commands, preserved: ['active and unresolved records', 'broker receipt tombstones', 'release and rollback artifacts', 'private backups', 'provider-owned history'], note: 'Broker event pruning requires terminal run acknowledgement. Logs rotate independently at 10 MiB with five generations.' };
}
