#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DomainError } from '../../../packages/contracts/src/commands.js';
import { initializeInstallation, startInstallation, supervisorRequest, localStatus, pairingInvitation, backupInstallation, doctor, defaultRoot } from './operations.js';
import { startup } from './startup.js';
import { reconcileRestore } from './recovery.js';
import { Store } from '../../server/src/db/store.js';
import { BackupService } from './backups.js';
import { OsProtector } from '../../server/src/security/protection.js';
import { safePath } from '../../../packages/contracts/src/paths.js';
const args = process.argv.slice(2); const command = args[0] ?? 'help'; const option = (name: string) => { const index = args.indexOf(`--${name}`); return index < 0 ? undefined : args[index + 1]; }; const root = resolve(option('root') ?? defaultRoot()); const testMode = args.includes('--test');
try {
  let result: unknown;
  if (command === 'init') { const bundle = option('bundle'); const config = option('config'); if (!bundle || !config) throw new DomainError('bundle_and_config_required', 400); result = await initializeInstallation(root, resolve(bundle), JSON.parse(readFileSync(config, 'utf8')), testMode); }
  else if (command === 'start') result = await startInstallation(root, testMode);
  else if (command === 'stop') { const scope = option('scope'); if (scope !== 'coordinator' && scope !== 'all') throw new DomainError('explicit_stop_scope_required', 400); result = await supervisorRequest(root, 'stop', { scope }, testMode); }
  else if (command === 'status' || command === 'version') result = await localStatus(root, testMode);
  else if (command === 'doctor') result = await doctor(root, testMode);
  else if (command === 'pair') { if (!process.stdout.isTTY || args.includes('--json')) throw new DomainError('pairing_requires_private_terminal', 403); console.log(`One-use invitation, expires in ten minutes:\n${await pairingInvitation(root, testMode)}`); process.exit(0); }
  else if (command === 'backup') result = await backupInstallation(root);
  else if (command === 'recover') {
    const source = option('reconcile-from'); const backup = option('backup'); const target = option('target');
    if (source) result = await reconcileRestore(root, resolve(source), testMode);
    else if (backup && target) { if (!/^backup-[a-zA-Z0-9-]+\.ceston$/.test(backup)) throw new DomainError('invalid_backup_name'); const store = new Store(root, { testMode }); try { result = await new BackupService(store, new OsProtector(store.installation().id)).restore(safePath(root, `backups/${backup}`), resolve(target), testMode); } finally { store.close(); } }
    else result = await supervisorRequest(root, 'recover', {}, testMode);
  }
  else if (command === 'install-startup' || command === 'uninstall-startup') result = await startup(root, command === 'install-startup' ? 'Install' : 'Uninstall', args.includes('--plan'), testMode);
  else result = { commands: ['init --bundle PATH --config PATH', 'start', 'stop --scope coordinator|all', 'status', 'version', 'pair', 'doctor', 'backup', 'recover', 'install-startup --plan', 'uninstall-startup --plan'], options: ['--root PATH', '--json'], note: 'Starting is temporary. Installing startup is a separate explicit operation. Pairing is private terminal output only.' };
  console.log(JSON.stringify(result, null, 2));
} catch (error) { console.error(JSON.stringify({ error: { code: error instanceof DomainError ? error.code : 'operation_failed', message: 'The operation did not complete. Run doctor for sanitized checks.' } })); process.exitCode = 1; }
