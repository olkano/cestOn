import { copyPrimaryFile } from '../../../packages/contracts/src/files.js';
import { mkdirSync, symlinkSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createTestRoot, cleanupTestRoot } from '../../../packages/test-support/src/index.js';
import { publicSourceFiles } from './package.js';
import type { Validation } from './activation.js';
import type { Config } from '../../../packages/contracts/src/config.js';
import { childEnvironment } from '../../broker/src/policy/index.js';
import { executeSandboxedRecipe } from '../../broker/src/recipes.js';
import { DomainError } from '../../../packages/contracts/src/commands.js';
import { selfUpdateCertified } from './certification.js';
import { inventory } from './releases.js';
export async function validateCandidate(dataRoot: string, bundle: string, config: Config, testMode = false): Promise<Validation> {
  const tools = config.executionHost.toolchainRoot ?? (testMode ? process.cwd() : undefined); if (!tools || !existsSync(join(tools, 'node_modules/tsx'))) throw new DomainError('validation_toolchain_required', 422);
  const t = createTestRoot(); const require = createRequire(join(resolve(tools), 'package.json')); const browser = require('@playwright/test') as { chromium: { executablePath(): string } }; const browsers = dirname(dirname(dirname(browser.chromium.executablePath())));
  try {
    const source = join(bundle, 'source'); const files = publicSourceFiles(source);
    for (const file of files) { const target = join(t.root, file); mkdirSync(dirname(target), { recursive: true }); copyPrimaryFile(join(source, file), target); }
    symlinkSync(join(resolve(tools), 'node_modules'), join(t.root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    const temporary = join(t.root, '.temporary'); const home = join(t.root, '.credentialless-home'); mkdirSync(temporary); mkdirSync(home);
    const npm = process.env.npm_execpath ?? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'); if (!existsSync(npm)) throw new DomainError('validation_npm_required', 422);
    const env = { ...childEnvironment(process.env), npm_execpath: npm, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home, TMP: temporary, TEMP: temporary, TMPDIR: temporary, PLAYWRIGHT_BROWSERS_PATH: browsers };
    const checks: Validation['checks'] = [];
    for (const [name, script] of [['verify', 'verify'], ['security', 'test:security'], ['updates', 'test:updates']] as const) {
      const args = [npm, 'run', script]; let exitCode: number; let outputHash: string;
      if (testMode) {
        const child = spawn(process.execPath, args, { cwd: t.root, env, stdio: ['ignore', 'pipe', 'pipe'], shell: false, windowsHide: true }); const hash = createHash('sha256'); child.stdout.on('data', data => hash.update(data)); child.stderr.on('data', data => hash.update(data)); const timer = setTimeout(() => child.kill(), 600000);
        try { exitCode = await new Promise<number>((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); }); outputHash = hash.digest('hex'); } finally { clearTimeout(timer); }
      } else ({ exitCode, outputHash } = await executeSandboxedRecipe(dataRoot, config, { id: `validate-${name}`, executable: process.execPath, args, operation: 'test', network: false, timeoutSeconds: 600 }, t.root, { readOnlyRoots: [join(resolve(tools), 'node_modules'), browsers, dirname(npm)], temporaryRoot: temporary, environment: env }));
      checks.push({ name, result: exitCode === 0 ? 'pass' : 'fail', evidenceHash: outputHash }); if (exitCode !== 0) return { checks, certifiedHost: false };
    }
    const original = JSON.parse(readFileSync(join(bundle, 'apps/web/dist/release.json'), 'utf8')) as { staticBundle: string }; const compiled = JSON.parse(readFileSync(join(t.root, 'apps/web/dist/release.json'), 'utf8')) as { staticBundle: string };
    const expectedRuntime = inventory(join(bundle, 'dist')); const rebuiltRuntime = inventory(join(t.root, 'dist')); const runtimeMatches = JSON.stringify(expectedRuntime) === JSON.stringify(rebuiltRuntime);
    checks.push({ name: 'canary', result: original.staticBundle === compiled.staticBundle && runtimeMatches ? 'pass' : 'fail', evidenceHash: createHash('sha256').update(original.staticBundle).update(compiled.staticBundle).update(JSON.stringify(rebuiltRuntime)).digest('hex') });
    return { checks, certifiedHost: !testMode && selfUpdateCertified(dataRoot, config) };
  } finally { cleanupTestRoot(t.root, t.runId); }
}
