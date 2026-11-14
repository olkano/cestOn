import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { publicSourceFiles } from '../apps/supervisor/src/package.js';

let files: string[]; try { files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).split('\0').filter(Boolean); } catch { files = publicSourceFiles(process.cwd()); }
const errors: string[] = [];
for (const file of [...new Set(files)]) {
  if (file.includes('reference-private') || file.includes('evidence-private')) { errors.push('Private content appears in public file list'); continue; }
  if (!file.endsWith('.md')) continue;
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(/(?<!!)\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1]!.split('#')[0]!;
    if (target && !/^[a-z]+:/i.test(target) && !existsSync(resolve(dirname(file), target))) errors.push(`${file}: broken link ${target}`);
  }
}
if (readFileSync('AGENTS.md', 'utf8').includes('../AGENTS.md')) errors.push('Contributor instructions depend on personal workspace');
if (errors.length) throw new Error(errors.join('\n'));
console.log(`Documentation checks passed for ${new Set(files).size} public files.`);
