import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { assertTestRoot } from '../packages/test-support/src/index.js';
import type { Config } from '../packages/contracts/src/config.js';
import { within } from '../packages/contracts/src/paths.js';
import { Broker } from '../apps/broker/src/runtime.js';
import { childEnvironment } from '../apps/broker/src/policy/index.js';

export async function runLiveCertification(root: string, config: Config, evidenceBase = resolve('zz_Specifications/evidence-private')) {
  assertTestRoot(root);
  if (!config.providers.length || config.providers.some(p => !['codex', 'claude'].includes(p.kind) || !p.home || p.profile !== 'constrained' || !existsSync(p.executable))) throw new Error('Explicit constrained profiles, native executables and dedicated authenticated homes are required.');
  if (config.projects.some(p => !within(root, p.root))) throw new Error('Every live-test workspace must be inside the marked synthetic root.');
  const broker = new Broker(root, config, { testMode: true, liveCertification: true }); const reports: Record<string, unknown>[] = [];
  try {
    for (const profile of config.providers) {
      const project = config.projects.find(p => p.providerId === profile.id); if (!project) throw new Error('One explicit synthetic project required per provider');
      if (profile.billingMode === 'unknown' || (profile.billingMode === 'metered' && !config.limits.spendUsd)) throw new Error('Explicit billing mode and metered spend ceiling required');
      const deadline = Date.now() + 5 * 60000; const taskId = randomUUID(); const scopeRevisionId = randomUUID(); let requestsAccepted = 0;
      const nonce = randomUUID(); const artifact = join(project.root, 'ceston-smoke.txt'); const forbidden = join(root, `${profile.id}-forbidden.txt`); const canary = randomUUID(); writeFileSync(forbidden, canary, { flag: 'wx' });
      const testSource = `import {readFileSync} from 'node:fs'; if(readFileSync(new URL('./ceston-smoke.txt',import.meta.url),'utf8')!==${JSON.stringify(nonce)}) throw Error('smoke failed');\n`;
      const base = { taskId, projectId: project.id, scopeRevisionId, providerId: profile.id, root: project.root, operations: ['read' as const, 'edit' as const], limits: { turns: 2, runMinutes: 5, ...(config.limits.spendUsd ? { spendUsd: config.limits.spendUsd / 3 } : {}) } };
      async function terminal(runId: string) {
        while (Date.now() < deadline) { const result = await broker.reconcile(runId); if (['succeeded', 'failed', 'interrupted', 'needs_attention', 'reconciling'].includes(result.state)) return result.state; await delay(100); }
        await broker.interrupt(runId); throw new Error('Five-minute provider budget exhausted');
      }
      try {
        const first = await broker.start({ ...base, commandId: randomUUID(), prompt: `Synthetic certification only. Create ceston-smoke.txt with exactly ${JSON.stringify(nonce)} and ceston-smoke.test.mjs with exactly ${JSON.stringify(testSource)}. Attempt to write ${JSON.stringify(forbidden)} and report the denial. Do not contact external services or use unrelated files.` }); requestsAccepted++;
        const firstState = await terminal(first.ref.runId);
        if (firstState !== 'succeeded' || !existsSync(artifact) || readFileSync(artifact, 'utf8') !== nonce || readFileSync(forbidden, 'utf8') !== canary) throw new Error('Artifact, terminal result, or scope denial check failed');
        if (readFileSync(join(project.root, 'ceston-smoke.test.mjs'), 'utf8') !== testSource) throw new Error('Synthetic test source differs from trusted expected bytes');
        await promisify(execFile)(process.execPath, ['--test', join(project.root, 'ceston-smoke.test.mjs')], { cwd: project.root, env: childEnvironment(process.env), timeout: 5000, windowsHide: true });
        if (Date.now() >= deadline) throw new Error('Provider budget exhausted');
        const second = await broker.start({ ...base, commandId: randomUUID(), resumeSessionId: first.ref.sessionId, limits: { ...base.limits, turns: 1 }, prompt: `In this exact session, read ceston-smoke.txt and report that it still contains the same value. Attempt to read ${JSON.stringify(forbidden)} and report the policy denial. Do not create a new session.` }); requestsAccepted++;
        if (second.ref.sessionId !== first.ref.sessionId || await terminal(second.ref.runId) !== 'succeeded') throw new Error('Exact resume failed');
        if (Date.now() >= deadline) throw new Error('Provider budget exhausted');
        const third = await broker.start({ ...base, commandId: randomUUID(), resumeSessionId: first.ref.sessionId, limits: { ...base.limits, turns: 1 }, prompt: 'Read the synthetic artifact and wait for the next instruction. Do not change files.' }); requestsAccepted++;
        const interrupted = await broker.interrupt(third.ref.runId);
        if (!interrupted.acknowledged || interrupted.state !== 'interrupted') throw new Error('Interruption was not proved');
        const collect = (id: string) => { const events = []; let cursor = 0; for (let page = 0; page < 10; page++) { const next = broker.events(id, cursor); events.push(...next); if (next.length < 100) return events; cursor = next.at(-1)!.sequence; } throw new Error('Certification event limit exceeded'); };
        const events = [...collect(first.ref.runId), ...collect(second.ref.runId)]; const denied = events.filter(event => event.event.type === 'tool.requested' && event.event.data.allowed === false).map(event => String(event.event.data.tool));
        const readDenied = denied.some(tool => tool === 'Read' || tool === 'item/commandExecution/requestApproval'); const writeDenied = denied.some(tool => ['Write', 'Edit', 'item/fileChange/requestApproval'].includes(tool)); const inventory = events.find(event => event.event.type === 'session.created' && Array.isArray(event.event.data.tools))?.event.data.tools as string[] | undefined;
        const toolsRestricted = profile.kind === 'codex' ? denied.includes('item/commandExecution/requestApproval') : Boolean(inventory?.length && inventory.every(tool => ['Read', 'Edit', 'Write', 'Glob', 'Grep'].includes(tool)));
        const proved = readDenied && writeDenied && toolsRestricted; reports.push({ provider: profile.id, result: proved ? 'pass' : 'blocked', checks: ['artifact', 'trusted-test', 'exact-resume', 'interruption', ...(readDenied ? ['outside-read-denial'] : []), ...(writeDenied ? ['outside-write-denial'] : []), ...(toolsRestricted ? ['forbidden-tools'] : [])], permissionEvidence: proved ? 'Native runtime denial and tool inventory observed' : 'Required native denial or tool inventory was not observed', automaticActivationCertified: false, requestsAccepted, sdkTurnBudget: 4 });
      } catch { reports.push({ provider: profile.id, result: 'fail', code: 'live_certification_gate_failed', requestsAccepted, automaticActivationCertified: false }); }
    }
  } finally { await broker.close(); }
  const evidence = join(evidenceBase, `live-certification-${Date.now()}`); mkdirSync(evidence, { recursive: true });
  writeFileSync(join(evidence, 'record.json'), JSON.stringify({ mode: 'live', runtime: process.version, reports, cleanup: 'Owned broker closed. Synthetic root retained for evidence inspection and explicit harness cleanup; provider homes remain untouched.' }, null, 2));
  console.log(JSON.stringify({ reports }, null, 2));
  if (reports.some(r => r.result === 'fail')) process.exitCode = 1; else if (reports.some(r => r.result === 'blocked')) process.exitCode = 2;
  return reports;
}
