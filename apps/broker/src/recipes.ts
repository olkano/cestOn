import { join } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { RpcProcess } from '../../../packages/adapters/src/rpc.js';
import { permissionConfig } from '../../../packages/adapters/src/codex/permissions.js';
import { childEnvironment } from './policy/index.js';
import { DomainError } from '../../../packages/contracts/src/commands.js';
import type { Config, ProjectConfig } from '../../../packages/contracts/src/config.js';
import { canonicalPath, within } from '../../../packages/contracts/src/paths.js';

function toml(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(toml).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).map(([key,item]) => `${JSON.stringify(key)}=${toml(item)}`).join(',')}}`;
  throw new DomainError('invalid_recipe_policy');
}
export async function executeSandboxedRecipe(dataRoot: string, config: Config, recipe: ProjectConfig['recipes'][number], workspace: string, validation?: { readOnlyRoots: string[]; temporaryRoot: string; environment: NodeJS.ProcessEnv }) {
  const executable = config.executionHost.codexExecutable;
  if (!executable || !existsSync(executable) || config.executionHost.version !== '0.160.0') throw new DomainError('recipe_host_unconfigured', 422);
  const home = config.executionHost.home ?? join(dataRoot, 'staging', 'recipe-home'); mkdirSync(home, { recursive: true });
  if (config.providers.some(provider => provider.home && canonicalPath(provider.home) === canonicalPath(home))) throw new DomainError('verification_home_must_be_separate', 403);
  const env = childEnvironment(validation?.environment ?? process.env, validation ? ['npm_execpath', 'PLAYWRIGHT_BROWSERS_PATH', 'PLAYWRIGHT_JSON_OUTPUT_FILE'] : []); env.CODEX_HOME = home;
  const policy = permissionConfig(workspace, false);
  if (validation) { if (!within(workspace, validation.temporaryRoot)) throw new DomainError('validation_temp_denied', 403); Object.assign(policy.permissions.ceston.filesystem, { ':tmpdir': 'write', [validation.temporaryRoot]: { '.': 'write' }, ...Object.fromEntries(validation.readOnlyRoots.map(root => [canonicalPath(root), { '.': 'read' }])) }); }
  if (recipe.network) throw new DomainError('network_recipe_requires_separate_certification', 422);
  const args = Object.entries(policy).flatMap(([key, value]) => ['-c', `${key}=${toml(value)}`]);
  const rpc = new RpcProcess({ command: executable, args: [...args, 'app-server'], cwd: workspace, env });
  try {
    await rpc.request('initialize', { clientInfo: { name: 'ceston-verifier', version: '0.1.0' }, capabilities: { experimentalApi: false } }); rpc.notify('initialized');
    if (process.platform === 'win32') {
      const ready = await rpc.request<{ status: string }>('windowsSandbox/readiness', {});
      if (ready.status !== 'ready') throw new DomainError('native_sandbox_setup_required', 422);
    }
    const result = await rpc.request<{ exitCode: number; stdout: string; stderr: string }>('command/exec', { command: [recipe.executable, ...recipe.args], cwd: workspace, timeoutMs: recipe.timeoutSeconds * 1000, outputBytesCap: 65536 }, recipe.timeoutSeconds * 1000 + 5000);
    if (!Number.isInteger(result.exitCode)) throw new DomainError('reconciliation_required');
    return { exitCode: result.exitCode, outputHash: createHash('sha256').update(result.stdout).update(result.stderr).digest('hex') };
  } finally { await rpc.close(); }
}
