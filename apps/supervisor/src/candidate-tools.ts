import { mkdirSync, symlinkSync, existsSync, readFileSync, unlinkSync, rmdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { stripVTControlCharacters } from 'node:util';
import { assertTestRoot } from '../../../packages/test-support/src/index.js';
import type { Config } from '../../../packages/contracts/src/config.js';
import { DomainError } from '../../../packages/contracts/src/commands.js';
import { childEnvironment } from '../../broker/src/policy/index.js';
import { executeSandboxedRecipe } from '../../broker/src/recipes.js';
import { packageRelease } from './package.js';
import type { ImprovementTools } from './improvement.js';
export class CandidateTools implements ImprovementTools {
  constructor(private dataRoot: string, private config: Config, private testMode = false) { if (testMode) assertTestRoot(dataRoot); }
  private toolchain() { const root = this.config.executionHost.toolchainRoot; if (!root || !existsSync(join(root, 'node_modules/tsx'))) throw new DomainError('validation_toolchain_required'); return resolve(root); }
  private async run(root: string, script: string, args: string[] = [], extra: Record<string, string> = {}) {
    assertTestRoot(dirname(root)); const tools = this.toolchain(); const modules = join(root, 'node_modules'); if (existsSync(modules)) throw new DomainError('candidate_unowned_toolchain'); symlinkSync(join(tools, 'node_modules'), modules, process.platform === 'win32' ? 'junction' : 'dir');
    const home = join(root, '.credentialless'); const temporary = join(root, '.temporary'); mkdirSync(home, { recursive: true }); mkdirSync(temporary, { recursive: true }); const require = createRequire(join(tools, 'package.json')); const browser = require('@playwright/test') as { chromium: { executablePath(): string } }; const browsers = dirname(dirname(dirname(browser.chromium.executablePath()))); const npm = process.env.npm_execpath ?? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
    const environment = { ...childEnvironment(process.env), npm_execpath: npm, PLAYWRIGHT_BROWSERS_PATH: browsers, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home, TMP: temporary, TEMP: temporary, TMPDIR: temporary, ...extra };
    try {
      if (!this.testMode) return await executeSandboxedRecipe(this.dataRoot, this.config, { id: 'candidate-check', executable: process.execPath, args: [npm, 'run', script, ...(args.length ? ['--', ...args] : [])], operation: 'test', network: false, timeoutSeconds: 600 }, root, { readOnlyRoots: [join(tools, 'node_modules'), browsers, dirname(dirname(npm))], temporaryRoot: temporary, environment });
      const child = spawn(process.execPath, [npm, 'run', script, ...(args.length ? ['--', ...args] : [])], { cwd: root, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], shell: false }); const hash = createHash('sha256'); let output = ''; const receive = (bytes: Buffer) => { hash.update(bytes); if (Buffer.byteLength(output) < 1048576) output += bytes.toString(); }; child.stdout.on('data', receive); child.stderr.on('data', receive); const timer = setTimeout(() => child.kill(), 600000);
      try { const exitCode = await new Promise<number>((done, reject) => { child.once('error', reject); child.once('exit', code => done(code ?? 1)); }); const directory = join(this.dataRoot, 'supervisor/checks'); mkdirSync(directory, { recursive: true }); writeFileSync(join(directory, `${script.replaceAll(':', '-')}-${randomUUID()}.log`), output, { flag: 'wx', mode: 0o600 }); return { exitCode, outputHash: hash.digest('hex') }; } finally { clearTimeout(timer); }
    } finally { if (process.platform === 'win32') rmdirSync(modules); else unlinkSync(modules); }
  }
  async regression(root: string, path: string) {
    const report = join(root, 'test-results', 'update-regression.json'); if (existsSync(report)) unlinkSync(report);
    const result = await this.run(root, 'test:e2e', [path, '--reporter=json'], { PLAYWRIGHT_JSON_OUTPUT_FILE: report });
    if (!existsSync(report)) return { exitCode: result.exitCode || 1, failure: 'infrastructure' as const, hash: result.outputHash };
    const parsed = JSON.parse(readFileSync(report, 'utf8')) as { errors: unknown[]; stats: { expected: number; unexpected: number; skipped: number; flaky: number }; suites: unknown[] }; const messages: string[] = []; const visit = (value: unknown) => { if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) { if ((key === 'error' || key === 'errors') && item) { const errors = Array.isArray(item) ? item : [item]; for (const error of errors) if (typeof (error as { message?: unknown }).message === 'string') messages.push(stripVTControlCharacters((error as { message: string }).message)); } else visit(item); } }; visit(parsed.suites); const assertionsOnly = messages.length > 0 && messages.every(message => /expect\(|expect\.|AssertionError/.test(message)); const valid = !parsed.errors.length && parsed.stats.skipped === 0 && parsed.stats.flaky === 0 && parsed.stats.expected + parsed.stats.unexpected > 0 && (!result.exitCode || assertionsOnly);
    return { exitCode: result.exitCode, failure: !valid ? 'infrastructure' as const : result.exitCode ? 'assertion' as const : null, hash: createHash('sha256').update(result.outputHash).update(readFileSync(report)).digest('hex') };
  }
  async verify(root: string) { const hashes = []; for (const script of ['verify', 'test:security', 'test:updates']) { const result = await this.run(root, script); if (result.exitCode) throw new DomainError('candidate_verification_failed'); hashes.push(result.outputHash); } return { hashes }; }
  async bundle(root: string, updateId: string, base: string, evidence: string[]) { return packageRelease({ sourceRoot: root, runtimeRoot: this.toolchain(), output: join(this.dataRoot, 'staging', 'bundles', updateId), requestId: updateId, baseReleaseId: base, testEvidenceHashes: evidence, npmCli: process.env.npm_execpath ?? '' }); }
}
