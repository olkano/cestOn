import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import type { Store } from '../db/store.js';
import { safePath } from '../../../../packages/contracts/src/paths.js';
import { DomainError } from '../../../../packages/contracts/src/commands.js';
import { redactText } from '../../../../packages/contracts/src/logging.js';
import { childEnvironment } from '../../../broker/src/policy/index.js';

export class SourceIntake {
  constructor(private store: Store) {}
  async accept(projectId: string, mime: string, bytes: Buffer) {
    this.store.project(projectId);
    if (bytes.length > 10485760) throw new DomainError('upload_too_large', 413);
    if (!['text/plain', 'text/markdown', 'application/pdf', 'text/uri-list'].includes(mime) || bytes.subarray(0, 2).toString() === 'MZ' || bytes.subarray(0, 2).toString() === 'PK') throw new DomainError('unsupported_content', 422);
    const pdf = bytes.subarray(0, 5).toString() === '%PDF-';
    if ((mime === 'application/pdf') !== pdf) throw new DomainError('unsupported_content', 422);
    const hash = createHash('sha256').update(bytes).digest('hex');
    const prior = this.store.db.prepare('SELECT id FROM sources WHERE project_id=? AND content_hash=?').get(projectId, hash) as { id: string } | undefined;
    if (prior) return this.read(projectId, prior.id);
    let text: string; let truncated: boolean;
    if (pdf) ({ text, truncated } = await this.extractPdf(bytes));
    else { try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new DomainError('unsupported_content', 422); } for (let index = 0; index < text.length; index++) { const code = text.charCodeAt(index); if (code < 32 && ![9, 10, 13].includes(code)) throw new DomainError('unsupported_content', 422); } truncated = Buffer.byteLength(text) > 32768; }
    text = redactText(text);
    const id = randomUUID(); const directory = join(this.store.dataRoot, 'state', 'sources'); mkdirSync(directory, { recursive: true });
    const blob = `state/sources/${id}.blob`;
    writeFileSync(join(this.store.dataRoot, blob), text, { flag: 'wx', mode: 0o600 });
    writeFileSync(join(directory, `${id}.raw`), bytes, { flag: 'wx', mode: 0o600 });
    writeFileSync(join(directory, `${id}.json`), JSON.stringify({ truncated, textHash: createHash('sha256').update(text).digest('hex') }), { flag: 'wx', mode: 0o600 });
    this.store.db.prepare('INSERT INTO sources VALUES(?,?,?,?,?,?)').run(id, projectId, hash, pdf ? 'pdf' : mime === 'text/markdown' ? 'markdown' : 'text', blob, this.store.now());
    return this.read(projectId, id);
  }
  read(projectId: string, id: string) {
    const row = this.store.db.prepare('SELECT * FROM sources WHERE id=? AND project_id=?').get(id, projectId) as { id: string; content_hash: string; kind: string; relative_blob_path: string } | undefined;
    if (!row) throw new DomainError('source_not_found', 404);
    const raw = readFileSync(safePath(this.store.dataRoot, `state/sources/${row.id}.raw`));
    if (createHash('sha256').update(raw).digest('hex') !== row.content_hash) throw new DomainError('source_integrity_failed');
    const text = readFileSync(safePath(this.store.dataRoot, row.relative_blob_path), 'utf8');
    const metadata = JSON.parse(readFileSync(safePath(this.store.dataRoot, `state/sources/${row.id}.json`), 'utf8')) as { truncated: boolean; textHash: string };
    if (createHash('sha256').update(text).digest('hex') !== metadata.textHash) throw new DomainError('source_integrity_failed');
    return { id: row.id, projectId, kind: row.kind, contentHash: row.content_hash, excerpt: text, truncated: metadata.truncated, authority: 'untrusted_source' as const };
  }
  private async extractPdf(bytes: Buffer): Promise<{ text: string; truncated: boolean }> {
    const child = spawn(process.execPath, ['--max-old-space-size=128', resolve('scripts/pdf-extract.mjs')], { stdio: ['pipe', 'pipe', 'pipe'], shell: false, env: childEnvironment(process.env), windowsHide: true });
    const result = await new Promise<{ text: string; truncated: boolean }>((resolve, reject) => {
      let output = ''; const timer = setTimeout(() => { child.kill(); reject(new DomainError('pdf_parse_timeout', 422)); }, 5000);
      child.stdin.on('error', () => {}); child.stderr.on('data', () => {});
      child.stdout.on('data', data => { output += String(data); if (output.length > 262144) { child.kill(); reject(new DomainError('pdf_text_too_large', 413)); } });
      child.once('error', () => { clearTimeout(timer); reject(new DomainError('pdf_parser_unavailable', 422)); });
      child.once('exit', code => { clearTimeout(timer); if (code !== 0) reject(new DomainError('invalid_pdf', 422)); else { try { const parsed = JSON.parse(output) as { text: string; truncated: boolean }; if (typeof parsed.text !== 'string' || parsed.text.length > 32768) throw new Error(); resolve(parsed); } catch { reject(new DomainError('invalid_pdf', 422)); } } });
      child.stdin.end(bytes);
    });
    return result;
  }
}
