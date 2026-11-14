import { readdirSync, existsSync, statSync } from 'node:fs';
import type { Store } from '../../server/src/db/store.js';
import { safePath } from '../../../packages/contracts/src/paths.js';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { parseConfig } from '../../../packages/contracts/src/config.js';
import { pruneReleases, releasePins } from './release-retention.js';
export function retention(store: Store, dryRun = true) {
  let bytes = 0; const walk = (directory: string) => { if (!existsSync(directory)) return; for (const entry of readdirSync(directory, { withFileTypes: true })) { if (entry.isSymbolicLink()) continue; const file = safePath(directory, entry.name); if (entry.isDirectory()) walk(file); else if (entry.isFile()) bytes += statSync(file).size; } }; walk(store.dataRoot);
  const commands = dryRun ? { commands: 0 } : store.prune();
  const pins = releasePins(store.dataRoot); const configFile = join(store.dataRoot, 'state/config.json'); const retain = existsSync(configFile) ? parseConfig(JSON.parse(readFileSync(configFile, 'utf8')), { testMode: true }).updates.retainVerifiedReleases : 3; const pending = (store.db.prepare("SELECT candidate_release FROM updates WHERE state NOT IN ('applied','rolled_back','failed','needs_authority') AND candidate_release IS NOT NULL").all() as { candidate_release: string }[]).map(update => update.candidate_release); const releases = pins ? pruneReleases(store.dataRoot, retain, [...pins, ...pending], dryRun) : null;
  return { dryRun, bytes, ...commands, releases, preserved: ['active and unresolved records', 'broker receipt tombstones', 'current and rollback releases plus pending candidates', 'private backups', 'provider-owned history'], note: 'Only hash-verified surplus releases without credential files are eligible. Unknown/corrupt directories remain blocked. Broker event pruning requires terminal run acknowledgement. Logs rotate independently at 10 MiB with five generations.' };
}
