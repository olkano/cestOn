import { spawn } from 'node:child_process';
import { createTestRoot, cleanupTestRoot } from '../packages/test-support/src/index.js';
import { fixtureConfig } from './fixture-config.js';
import { npmScript } from './run.js';
const t = createTestRoot(); fixtureConfig(t.root);
try {
  await npmScript('build');
  const child = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', ...process.argv.slice(2)], { stdio: 'inherit', shell: false, env: { ...process.env, CESTON_E2E_ROOT: t.root, CESTON_E2E_STATIC: '1' } });
  const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); }); process.exitCode = code ?? 1;
} finally { cleanupTestRoot(t.root, t.runId); }
