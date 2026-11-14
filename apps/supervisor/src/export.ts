import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { publicSourceFiles, sourceSnapshot } from './package.js';
export function sensitiveContent(bytes: Buffer | string) {
  const text = String(bytes); const codes: string[] = [];
  if (/[a-z]:[\\/]+Users[\\/]+(?!Public[\\/]|Default[\\/])[^\\/\s]+[\\/]/i.test(text) || /\/(?:home|Users)\/(?!example\/)[a-z0-9_.-]+\//i.test(text)) codes.push('personal_home_path');
  if (/(?:gh[pousr]_[A-Za-z0-9]{24,}|sk-(?:proj-)?[A-Za-z0-9_-]{32,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(text)) codes.push('credential_pattern');
  return codes;
}
export function inspectPublicSource(root: string) {
  const files = publicSourceFiles(root); const issues = files.flatMap(path => sensitiveContent(readFileSync(join(root, path))).map(code => ({ path, code })));
  if (readFileSync(join(root, 'AGENTS.md'), 'utf8').includes('../AGENTS.md')) issues.push({ path: 'AGENTS.md', code: 'personal_parent_dependency' });
  return { files, sourceSnapshotHash: sourceSnapshot(root, files), issues };
}
export function inspectPublicHistory(root: string) {
  const raw = execFileSync('git', ['-C', root, 'rev-list', '--objects', '--all'], { encoding: 'utf8', maxBuffer: 16777216 }); const objects = raw.trim().split('\n').map(line => { const [sha, ...path] = line.split(' '); return { sha: sha!, path: path.join(' ') }; }).filter(object => object.path);
  const output = execFileSync('git', ['-C', root, 'cat-file', '--batch'], { input: objects.map(object => object.sha).join('\n') + '\n', maxBuffer: 134217728 }); let offset = 0; let blobs = 0; const issues: { object: string; path: string; code: string }[] = [];
  for (const object of objects) { const newline = output.indexOf(10, offset); if (newline < 0) throw new Error('history_scan_incomplete'); const [, type, length] = output.subarray(offset, newline).toString().split(' '); const size = Number(length); if (!Number.isSafeInteger(size) || size < 0 || newline + 1 + size >= output.length) throw new Error('history_scan_incomplete'); const bytes = output.subarray(newline + 1, newline + 1 + size); offset = newline + 1 + size + 1; if (type !== 'blob') continue; blobs++; if (/(?:^|\/)(?:reference-private|evidence-private|state|provider-home)(?:\/|$)|(?:^|\/)\.env(?:\.|$)|\.(?:sqlite|key|pem|log)$/.test(object.path)) issues.push({ object: object.sha, path: object.path, code: 'private_history_path' }); for (const code of sensitiveContent(bytes)) issues.push({ object: object.sha, path: object.path, code }); }
  return { objects: objects.length, blobs, issues, note: 'Pattern and private-path scan of reachable source blobs. This supplements manual review; it does not certify absence of every possible secret format.' };
}
