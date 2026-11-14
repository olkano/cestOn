import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from '@playwright/test';
import { verificationEnvironment } from './environment.js';
import { sourceSnapshot } from '../apps/supervisor/src/package.js';

const scripts = process.argv.slice(2);
if (!scripts.length || scripts.some(s => !/^[a-z:]+$/.test(s))) throw new Error('Supply npm verification script names');
const runId = `${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
const root = join('zz_Specifications/evidence-private', runId); mkdirSync(root, { recursive: true });
const sourceSnapshotHash = sourceSnapshot(process.cwd());
const browser = await chromium.launch(); const browserVersion = browser.version(); await browser.close();
const records = [];
for (const script of scripts) {
  const start = new Date().toISOString();
  const child = spawn(process.execPath, [process.env.npm_execpath ?? '', 'run', script], { stdio: ['ignore', 'pipe', 'pipe'], shell: false, env: verificationEnvironment(), windowsHide: true });
  let output = ''; child.stdout.on('data', (b: Buffer) => { output += b.toString(); process.stdout.write(b); }); child.stderr.on('data', (b: Buffer) => { output += b.toString(); process.stderr.write(b); });
  const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  writeFileSync(join(root, `${script.replaceAll(':', '-')}.log`), output, { flag: 'wx' });
  records.push({ command: `npm run ${script}`, startedAt: start, endedAt: new Date().toISOString(), expected: 'Exit 0, tests clean up owned resources', exitCode: code, result: code === 0 ? 'pass' : 'fail' });
  if (code !== 0) break;
}
writeFileSync(join(root, 'record.json'), JSON.stringify({ runId, sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sourceSnapshotHash, runtime: process.version, browserVersion, platform: process.platform, mode: 'fixture', records, limits: 'This record proves only the commands and test assertions shown; live providers and devices require separate evidence.' }, null, 2), { flag: 'wx' });
console.log(`Evidence: ${root}/record.json`);
process.send?.({ recordPath: join(root, 'record.json') });
if (records.some(r => r.result === 'fail')) process.exitCode = 1;
