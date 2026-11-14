import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { DomainError } from '../../../packages/contracts/src/commands.js';
import { canonicalPath } from '../../../packages/contracts/src/paths.js';
import { childEnvironment } from './policy/index.js';
import { windowsHelperEnvironment } from './windows-environment.js';
export async function acquireInstance(root: string, role: string, key: string) {
  if (!/^[a-z-]+$/.test(role) || !key) throw new DomainError('invalid_role'); mkdirSync(join(root, 'state'), { recursive: true });
  const name = createHash('sha256').update(canonicalPath(root)).update(role).digest('hex');
  const child = process.platform === 'win32' ? spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', resolve('scripts/windows-mutex.ps1'), '-Name', `ceston-${name}`], { stdio: ['pipe', 'pipe', 'pipe'], env: windowsHelperEnvironment(), windowsHide: true }) : spawn('flock', ['--nonblock', join(root, 'state', `${role}.lock`), process.execPath, '-e', "process.stdout.write('locked\\n');process.stdin.resume();process.stdin.on('end',()=>process.exit(0))"], { stdio: ['pipe', 'pipe', 'pipe'], env: childEnvironment(process.env) });
  let output = ''; child.stderr.on('data', () => {}); child.stdin.on('error', () => {});
  try { await new Promise<void>((done, reject) => { const timer = setTimeout(() => { child.kill(); reject(new DomainError('instance_lock_timeout')); }, 20000); child.once('error', () => { clearTimeout(timer); reject(new DomainError('instance_lock_unavailable')); }); child.once('exit', () => { clearTimeout(timer); reject(new DomainError('instance_already_running')); }); child.stdout.on('data', data => { output += String(data); if (output.includes('locked\n')) { clearTimeout(timer); done(); } }); }); }
  catch (error) { child.kill(); throw error; }
  return { async release() { if (child.exitCode !== null || child.signalCode !== null) return; const exited = new Promise<void>(done => child.once('exit', () => done())); child.stdin.end(); await exited; } };
}
