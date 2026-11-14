import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { sanitizeLog } from '../../../packages/contracts/src/logging.js';
export class RotatingLog {
  private path: string;
  constructor(root: string, role: string, private limit = 10 * 1048576, private generations = 5) { if (!/^[a-z-]+$/.test(role) || limit < 128 || generations < 1) throw new Error('Invalid log policy'); mkdirSync(join(root, 'logs'), { recursive: true }); this.path = join(root, 'logs', `${role}.jsonl`); }
  write(event: Record<string, unknown>) { const line = `${JSON.stringify(sanitizeLog(event))}\n`; if (existsSync(this.path) && statSync(this.path).size + Buffer.byteLength(line) > this.limit) { const last = `${this.path}.${this.generations-1}`; if (existsSync(last)) unlinkSync(last); for (let index = this.generations - 2; index >= 1; index--) if (existsSync(`${this.path}.${index}`)) renameSync(`${this.path}.${index}`, `${this.path}.${index+1}`); if (this.generations > 1) renameSync(this.path, `${this.path}.1`); else unlinkSync(this.path); } appendFileSync(this.path, line, { mode: 0o600 }); }
}
