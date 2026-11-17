#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { DomainError } from '../../../packages/contracts/src/commands.js';
import { initializeInstallation, startInstallation, supervisorRequest, localStatus, pairingInvitation, backupInstallation, doctor, defaultRoot } from './operations.js';
import { startup } from './startup.js';
import { reconcileRestore } from './recovery.js';
import { recoverBackup } from './backups.js';
import { dataAccess } from '../../server/src/security/access.js';
import { safePath } from '../../../packages/contracts/src/paths.js';
import { certifyProvider } from './provider-certification.js';
import { certifySelfUpdate } from './self-update-certification.js';
const args = process.argv.slice(2); const command = args[0] ?? 'help'; const option = (name: string) => { const index = args.indexOf(`--${name}`); return index < 0 ? undefined : args[index + 1]; }; const root = resolve(option('root') ?? defaultRoot()); const testMode = args.includes('--test');
try {
  let result: unknown;
  if (command === 'init') { const bundle = option('bundle'); const config = option('config'); if (!bundle || !config) throw new DomainError('bundle_and_config_required', 400); result = await initializeInstallation(root, resolve(bundle), JSON.parse(readFileSync(config, 'utf8')), testMode); }
  else if (command === 'setup') {
    const bundle = option('bundle');
    if (!bundle) throw new DomainError('bundle_required', 400);
    const existing = existsSync(join(root, 'state/config.json'));
    const discover = args.includes('--with-history');
    if (discover && testMode) throw new DomainError('history_root_denied', 403);
    const history = discover ? {
      codexHome: resolve(process.env.CODEX_HOME || join(homedir(), '.codex')),
      claudeHome: resolve(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')),
    } : {};
    if (!existing) await initializeInstallation(root, resolve(bundle), { history }, testMode);
    result = await startInstallation(root, testMode);
  }
  else if (command === 'start') result = await startInstallation(root, testMode);
  else if (command === 'stop') { const scope = option('scope'); if (scope !== 'coordinator' && scope !== 'all') throw new DomainError('explicit_stop_scope_required', 400); result = await supervisorRequest(root, 'stop', { scope }, testMode); }
  else if (command === 'status' || command === 'version') result = await localStatus(root, testMode);
  else if (command === 'doctor') result = await doctor(root, testMode);
  else if (command === 'certify-provider') { const providerId = option('provider'); if (!providerId) throw new DomainError('provider_required'); result = await certifyProvider(root, providerId, testMode); }
  else if (command === 'certify-self-update') { const providerId = option('provider'); if (!providerId || testMode) throw new DomainError('explicit_native_provider_required'); result = await certifySelfUpdate(root, providerId); }
  else if (command === 'pair') { if (!process.stdout.isTTY || args.includes('--json')) throw new DomainError('pairing_requires_private_terminal', 403); console.log(`One-use invitation, expires in ten minutes:\n${await pairingInvitation(root, testMode)}`); process.exit(0); }
  else if (command === 'backup') result = await backupInstallation(root);
  else if (command === 'recover') {
    const source = option('reconcile-from'); const backup = option('backup'); const target = option('target');
    if (source) result = await reconcileRestore(root, resolve(source), testMode);
    else if (backup && target) { if (!/^backup-[a-zA-Z0-9-]+\.ceston$/.test(backup)) throw new DomainError('invalid_backup_name'); await dataAccess(root); result = await recoverBackup(safePath(root, `backups/${backup}`), resolve(target), testMode); }
    else result = await supervisorRequest(root, 'recover', {}, testMode);
  }
  else if (command === 'install-startup' || command === 'uninstall-startup') result = await startup(root, command === 'install-startup' ? 'Install' : 'Uninstall', args.includes('--plan'), testMode);
  else result = { commands: ['setup --bundle PATH [--with-history]', 'init --bundle PATH --config PATH', 'start', 'stop --scope coordinator|all', 'status', 'version', 'pair', 'doctor', 'certify-provider --provider ID', 'certify-self-update --provider ID', 'backup', 'recover', 'install-startup --plan', 'uninstall-startup --plan'], options: ['--root PATH', '--json'], note: 'Starting is temporary. Installing startup is a separate explicit operation. Pairing is private terminal output only.' };
  console.log(JSON.stringify(result, null, 2));
} catch (error) { console.error(JSON.stringify({ error: { code: error instanceof DomainError ? error.code : 'operation_failed', message: 'The operation did not complete. Run doctor for sanitized checks.' } })); process.exitCode = 1; }
