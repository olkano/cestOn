import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { assertTestRoot } from '../../../../packages/test-support/src/index.js';
import { childEnvironment } from '../../../broker/src/policy/index.js';
import { DomainError } from '../../../../packages/contracts/src/commands.js';
export interface Protector { seal(value: string, purpose: string): Promise<string>; open(value: string, purpose: string): Promise<string>; }
export class TestProtector implements Protector {
  private key = randomBytes(32);
  constructor(root: string) { assertTestRoot(root); }
  async seal(value: string, purpose: string) { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.key, iv); cipher.setAAD(Buffer.from(purpose)); return [iv, cipher.update(value, 'utf8'), cipher.final(), cipher.getAuthTag()].map(b => b.toString('base64url')).join('.'); }
  async open(value: string, purpose: string) { const [iv, bytes, tail, tag] = value.split('.').map(b => Buffer.from(b, 'base64url')); const cipher = createDecipheriv('aes-256-gcm', this.key, iv!); cipher.setAAD(Buffer.from(purpose)); cipher.setAuthTag(tag!); return cipher.update(Buffer.concat([bytes!, tail!])).toString('utf8') + cipher.final().toString('utf8'); }
}
export class OsProtector implements Protector {
  constructor(private installationId: string) {}
  private async transform(value: string, purpose: string, mode: 'Protect' | 'Unprotect') {
    if (process.platform !== 'win32') throw new DomainError('os_protection_unavailable', 503);
    if (Buffer.byteLength(value) > 65536) throw new DomainError('protected_value_too_large', 413);
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', resolve('scripts/os-protect.ps1'), '-Mode', mode], { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: childEnvironment(process.env) });
    return new Promise<string>((resolve, reject) => { let output = ''; const timer = setTimeout(() => { child.kill(); reject(new DomainError('os_protection_timeout', 503)); }, 5000);
      child.stdout.on('data', data => { output += String(data); if (output.length > 200000) child.kill(); }); child.stderr.on('data', () => {}); child.stdin.on('error', () => {});
      child.once('error', () => { clearTimeout(timer); reject(new DomainError('os_protection_unavailable', 503)); }); child.once('exit', code => { clearTimeout(timer); if (code !== 0) reject(new DomainError('os_protection_failed', 503)); else resolve(output.trim()); });
      child.stdin.end(JSON.stringify({ value: mode === 'Protect' ? Buffer.from(value).toString('base64') : value, purpose: `${this.installationId}:${purpose}` }));
    });
  }
  async seal(value: string, purpose: string) { return `dpapi1:${await this.transform(value, purpose, 'Protect')}`; }
  async open(value: string, purpose: string) { if (!value.startsWith('dpapi1:')) throw new DomainError('protected_format_invalid'); return Buffer.from(await this.transform(value.slice(7), purpose, 'Unprotect'), 'base64').toString('utf8'); }
}
