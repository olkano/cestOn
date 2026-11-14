import { join } from 'node:path';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createTestRoot, cleanupTestRoot } from '../packages/test-support/src/index.js';
import { executeSandboxedRecipe } from '../apps/broker/src/recipes.js';
import { parseConfig, recipeSchema } from '../packages/contracts/src/config.js';
import { DomainError } from '../packages/contracts/src/commands.js';
const t = createTestRoot(); const workspace = join(t.root, 'project'); mkdirSync(workspace);
const executable = join(process.env.APPDATA ?? '', 'npm/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe');
let result: Record<string, unknown>;
try {
  if (!existsSync(executable)) throw new DomainError('native_execution_host_absent');
  const checked = await executeSandboxedRecipe(t.root, parseConfig({ executionHost: { codexExecutable: executable, version: '0.160.0' } }), recipeSchema.parse({ id: 'synthetic', executable: process.execPath, args: ['-e', "require('node:fs').writeFileSync('recipe.txt','synthetic recipe')"], operation: 'test', timeoutSeconds: 5 }), workspace);
  result = { result: checked.exitCode === 0 && readFileSync(join(workspace, 'recipe.txt'), 'utf8') === 'synthetic recipe' ? 'pass' : 'fail', modelTurns: 0, ...checked };
} catch (error) { result = { result: 'blocked', modelTurns: 0, code: error instanceof DomainError ? error.code : error instanceof Error ? error.message.replaceAll(/[^a-zA-Z0-9_ -]/g, '').slice(0, 80) : 'native_recipe_probe_failed' }; }
finally { cleanupTestRoot(t.root, t.runId); }
const directory = join('zz_Specifications/evidence-private', `recipe-probe-${Date.now()}`); mkdirSync(directory, { recursive: true }); writeFileSync(join(directory, 'record.json'), JSON.stringify({ ...result, cleanup: 'pass', limits: 'No authentication, model turn or sandbox setup operation was requested.' }, null, 2)); console.log(JSON.stringify(result));
