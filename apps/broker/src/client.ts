import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { installationSecrets } from './certification.js';
import { childEnvironment } from './policy/index.js';
import { ipcRequest } from './ipc.js';
import { DomainError } from '../../../packages/contracts/src/commands.js';
import type { Execution } from './runtime.js';
import type { BrokerEvent } from './events.js';
import type { RunRef } from '../../../packages/adapters/src/types.js';
import type { BrokerReceipt } from '../../server/src/commands/outbox.js';
import { readOwner } from './registry.js';

export class BrokerClient {
  constructor(readonly endpoint: string, private installationId: string, private token: string) {}
  private async request<T>(method: string, payload: unknown): Promise<T> {
    const requestId = randomUUID(); const response = await ipcRequest(this.endpoint, { protocol: 1, installationId: this.installationId, token: this.token, requestId, method, payload }, method === 'recipe' ? 610000 : method === 'infer' ? 65000 : method === 'start' ? 35000 : 12000);
    if (response.error) throw new DomainError(response.error.code, 503);
    if (response.requestId !== requestId || response.protocol !== 1) throw new DomainError('ipc_wrong_response', 503);
    return response.data as T;
  }
  start(execution: Execution) { return this.request<{ sequence: number; ref: RunRef; providerId: string; capabilities: unknown }>('start', execution); }
  workspace(projectId: string, taskId: string, scopeRevisionId: string) { return this.request<{ root: string; sourceHash: string }>('workspace', { projectId, taskId, scopeRevisionId }); }
  lookup(commandId: string) { return this.request<BrokerReceipt>('receipt', { commandId }); }
  events(runId: string, after: number) { return this.request<BrokerEvent[]>('events', { runId, after }); }
  reconcile(runId: string) { return this.request<{ state: string }>('reconcile', { runId }); }
  interrupt(runId: string) { return this.request<{ acknowledged: boolean; state: string }>('interrupt', { runId }); }
  steer(runId: string, turnId: string, text: string) { return this.request<{ state: string }>('steer', { runId, turnId, text }); }
  sessions() { return this.request<{ sessionId: string; runId: string; providerId: string; taskId: string; state: string; ownership: string }[]>('sessions', {}); }
  probes() { return this.request<Record<string, unknown>[]>('probe', {}); }
  prune() { return this.request<{ events: number }>('prune', {}); }
  shutdown() { return this.request('shutdown', {}); }
  infer(providerId: string, kind: 'plan' | 'intent', prompt: string) { return this.request<unknown>('infer', { providerId, kind, prompt }); }
  recipe(runId: string, recipeId: string) { return this.request<{ exitCode: number; outputHash: string }>('recipe', { runId, recipeId }); }
  discover(providerId: string, cursor?: string) { return this.request<{ sessions: { id: string; provider: string; providerSessionId: string; homeId: string; projectId: string; title: string; ownership: string; state: string; observedAt: string }[]; cursor?: string }>('discover', { providerId, ...(cursor ? { cursor } : {}) }); }
  history(providerId: string, id: string, after = 0) { return this.request<{ text: string; cursor?: number }>('history', { providerId, id, after }); }
}
export async function spawnBroker(root: string, installationId: string, testMode = false, fixtureDelayMs = 100) {
  const compiled = fileURLToPath(new URL('./main.js', import.meta.url)); const entry = existsSync(compiled) ? compiled : fileURLToPath(new URL('./main.ts', import.meta.url));
  const config = JSON.parse(readFileSync(join(root, 'state/config.json'), 'utf8')) as { providers?: { kind: string; billingMode: string }[] };
  const credentials = config.providers?.some(provider => provider.kind === 'claude' && provider.billingMode === 'metered') ? ['ANTHROPIC_API_KEY'] : [];
  const child = fork(entry, [root, installationId, ...(testMode ? ['--test', `--fixture-delay=${fixtureDelayMs}`] : [])], { execArgv: entry.endsWith('.ts') ? ['--import', 'tsx'] : [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: childEnvironment(process.env, credentials), windowsHide: true });
  let stderr = ''; child.stderr?.on('data', data => { stderr += String(data).slice(0, 4000); });
  let endpoint: string;
  try {
    endpoint = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Broker startup timeout: ${stderr}`)), 10000);
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('exit', () => { clearTimeout(timeout); reject(new Error(`Broker exited at startup: ${stderr}`)); });
      child.once('message', value => { const ready = value as { ready: boolean; endpoint: string }; clearTimeout(timeout); if (!ready.ready) reject(new Error('Invalid broker startup')); else resolve(ready.endpoint); });
    });
  } catch (error) { child.kill(); throw error; }
  const client = new BrokerClient(endpoint, installationId, installationSecrets(root).broker);
  return { client, child, async close() {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise<void>(resolve => child.once('exit', () => resolve())); child.send({ type: 'shutdown' }); await exited;
  } };
}
export async function ensureBroker(root: string, installationId: string, testMode = false) {
  const key = installationSecrets(root).broker; const owner = await readOwner(root, 'broker', installationId, key);
  if (owner) { const client = new BrokerClient(owner.endpoint, installationId, key); try { await client.lookup(randomUUID()); } catch { throw new DomainError('owned_broker_unreachable', 503); } return { client, child: null, async close() {} }; }
  return spawnBroker(root, installationId, testMode);
}
