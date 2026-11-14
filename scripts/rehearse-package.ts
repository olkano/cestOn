import { resolve, join } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { runCanary } from '../apps/supervisor/src/host.js';
import { initializeInstallation, startInstallation, supervisorRequest, localStatus, doctor } from '../apps/supervisor/src/operations.js';
import { startup } from '../apps/supervisor/src/startup.js';
import { createTestRoot, cleanupTestRoot } from '../packages/test-support/src/index.js';
import { readOwner } from '../apps/broker/src/registry.js';
import { installationSecrets } from '../apps/broker/src/certification.js';
import { setTimeout as delay } from 'node:timers/promises';
const bundle = resolve(process.argv[2]!); const t = createTestRoot(); let started = false; const checks: string[] = [];
async function waitForStop(installationId: string) { const deadline = Date.now() + 10000; while (await readOwner(t.root, 'supervisor', installationId, installationSecrets(t.root).supervisor)) { if (Date.now() > deadline) throw new Error('Cleanup is waiting for the exact supervisor'); await delay(200); } }
try {
  if (!await runCanary(bundle)) throw new Error('Packaged separate-process canary failed'); checks.push('packaged-api-broker-command-canary');
  const configured = { listen: { port: 0 }, projects: [{ id: randomUUID(), displayName: 'Synthetic installation rehearsal', root: join(t.root, 'project'), kind: 'documents', providerId: 'fixture' }], providers: [{ id: 'fixture', kind: 'fixture', executable: '', version: '1', profile: 'constrained' }] };
  const installed = await initializeInstallation(t.root, bundle, configured, true); const installationId = installed.installationId; mkdirSync(join(t.root, 'project')); checks.push('empty-root-owner-only-install');
  const planned = await startup(t.root, 'Install', true, true); if (planned.changesPersistence) throw new Error('Startup rehearsal mutated persistence'); checks.push('startup-plan-only');
  started = true; const status = await startInstallation(t.root, true) as { releaseId: string }; if (status.releaseId !== installed.releaseId) throw new Error('Wrong release started'); checks.push('stable-supervisor-start-release-readback');
  const health = await doctor(t.root, true); if (health.checks.some(check => check.status === 'blocked')) throw new Error('Installed doctor has a blocked capability'); checks.push('installed-doctor');
  await supervisorRequest(t.root, 'stop', { scope: 'all' }, true); const deadline = Date.now() + 10000; const key = installationSecrets(t.root).supervisor; while (await readOwner(t.root, 'supervisor', installationId, key)) { if (Date.now() > deadline) throw new Error('Supervisor did not stop'); await delay(200); } started = false; if ((await localStatus(t.root, true)).state !== 'stopped') throw new Error('Stop readback failed'); checks.push('exact-owned-stop-and-removal');
  console.log(JSON.stringify({ state: 'pass', checks, mode: 'isolated_fixture', persistentStartupInstalled: false, liveProviderTurns: 0 }, null, 2));
} catch (error) { console.error(error); throw error; }
finally { if (started) { await supervisorRequest(t.root, 'stop', { scope: 'all' }, true); const current = await localStatus(t.root, true, false); await waitForStop(current.installationId); } cleanupTestRoot(t.root, t.runId); const evidence = resolve('zz_Specifications/evidence-private', `package-rehearsal-${Date.now()}.json`); writeFileSync(evidence, JSON.stringify({ bundle: bundle.split(/[\\/]/).at(-1), checks, cleanup: 'Only the marked synthetic installation removed', persistentActivation: false }, null, 2)); }
