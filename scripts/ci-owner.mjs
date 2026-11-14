import { execFileSync, spawn } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
if (process.platform !== 'win32' || process.env.GITHUB_ACTIONS !== 'true') throw new Error('Disposable Windows Actions runner required');
const ownership = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "$identity=[Security.Principal.WindowsIdentity]::GetCurrent(); $principal=[Security.Principal.WindowsPrincipal]::new($identity); if($identity.Owner.Value -ne $identity.User.Value -or $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Expected restricted owner token'}; [Console]::Write('owner')"], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
if (ownership !== 'owner') throw new Error('Owner token read-back failed');
console.log(JSON.stringify({ stage: 'restricted-owner-token', ownerMatchesUser: true, administrator: false }));
execFileSync('git', ['config', '--global', '--add', 'safe.directory', process.cwd()], { windowsHide: true });
const npm = join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
for (const args of [[resolve('node_modules/tsx/dist/cli.mjs'), 'scripts/check-windows-host.ts'], [npm, 'run', 'package:local']]) {
  const child = spawn(process.execPath, args, { env: process.env, stdio: 'inherit', shell: false, windowsHide: true });
  const code = await new Promise((done, reject) => { child.once('error', reject); child.once('exit', done); });
  if (code !== 0) process.exit(Number(code) || 1);
}
