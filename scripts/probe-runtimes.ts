import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CodexAdapter } from '../packages/adapters/src/codex/index.js';
import { ClaudeAdapter } from '../packages/adapters/src/claude/index.js';
import { childEnvironment } from '../apps/broker/src/policy/index.js';
import { createTestRoot, cleanupTestRoot } from '../packages/test-support/src/index.js';

const t = createTestRoot(); const records: Record<string, unknown>[] = [];
try {
  const prefix = join(process.env.APPDATA ?? '', 'npm', 'node_modules');
  const codex = join(prefix, '@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe');
  const claude = join(prefix, '@anthropic-ai/claude-code/bin/claude.exe');
  const cwd = join(t.root, 'project'); mkdirSync(cwd);
  for (const [provider, executable] of [['codex', codex], ['claude', claude]]) {
    if (!executable || !existsSync(executable)) { records.push({ provider, result: 'blocked', reason: 'Native runtime not detected by Windows npm probe; configure an explicit profile.' }); continue; }
    const home = join(t.root, `${provider}-home`); mkdirSync(home);
    const env = childEnvironment(process.env); env[provider === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR'] = home;
    const version = (await promisify(execFile)(executable, ['--version'], { env, timeout: 5000, windowsHide: true })).stdout.trim();
    if (provider === 'codex') {
      const adapter = new CodexAdapter({ command: executable, args: ['app-server'], cwd, env }, { version: '0.160.0', certified: false });
      try { const result = await adapter.probe(); records.push({ provider, version, result: 'blocked', authenticatedManagedHome: result.authenticated, reason: 'Dedicated constrained managed-home authentication and live certification are required; no model turn was started.' }); }
      catch { records.push({ provider, version, result: 'blocked', reason: 'Isolated app-server probe failed; no model turn was started.' }); }
      finally { await adapter.close(); }
    } else {
      const adapter = new ClaudeAdapter({ executable, version: '2.1.317', workspace: cwd, env, certified: false, billingMode: 'unknown', check: () => ({ allowed: false, reason: 'Probe only' }) });
      const result = await adapter.probe(); records.push({ provider, version, result: 'blocked', authenticatedManagedHome: result.authenticated, reason: 'Explicit managed-home authentication, billing mode and live certification are required; no model turn was started.' }); await adapter.close();
    }
  }
} finally { try { cleanupTestRoot(t.root, t.runId); } catch { records.push({ capability: 'test-cleanup', result: 'fail', reason: 'Isolated provider root remained locked after process exit. Investigate before accepting this probe.' }); } }
const directory = resolve('zz_Specifications/evidence-private', `provider-probe-${Date.now()}`); mkdirSync(directory, { recursive: true });
const cleanup = records.some(r => r.capability === 'test-cleanup') ? 'fail' : 'pass';
writeFileSync(join(directory, 'record.json'), JSON.stringify({ mode: 'live-probe-no-model-turns', runtime: process.version, records, cleanup, result: 'blocked' }, null, 2));
console.log(JSON.stringify({ records, cleanup }, null, 2));
if (cleanup === 'fail') process.exitCode = 1;
