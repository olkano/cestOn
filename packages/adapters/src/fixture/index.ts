import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { Adapter, RunRequest, RunRef, ProviderEvent, Capabilities } from '../types.js';
import { CapabilityError } from '../types.js';

export class FixtureAdapter implements Adapter {
  readonly mode = 'fixture';
  startCount = 0;
  private runs = new Map<string, { ref: RunRef; request: RunRequest; state: string }>();
  private keys = new Map<string, RunRef>();
  private queued = new Map<string, string[]>();
  constructor(private options: { duplicateEvents?: boolean; loseTerminal?: boolean; delayMs?: number; fail?: boolean; acknowledgeDelayMs?: number; artifactWriter?: (request: RunRequest, path: string) => { path: string; sha256: string } } = {}) {}
  async probe() { return { version: '1', transport: 'in-memory-fixture', capabilities: { discover: true, readHistory: true, start: true, resumeExact: true, steerActive: false, interruptOwned: true, toolApproval: true, usage: true, structuredResult: true, sandbox: true, reattachOwned: true, billingMode: 'fixture' } satisfies Capabilities, authenticated: true, verifiedAt: new Date().toISOString() }; }
  async listSessions() { return { sessions: [...this.runs.values()].map(r => ({ id: r.ref.sessionId, title: 'Synthetic session', state: r.state })) }; }
  async readHistory(sessionId: string) { if (![...this.runs.values()].some(r => r.ref.sessionId === sessionId)) throw new CapabilityError('Unknown session'); return { events: [] }; }
  async start(request: RunRequest): Promise<RunRef> {
    const prior = this.keys.get(request.commandId); if (prior) return prior;
    const ref = { runId: randomUUID(), sessionId: randomUUID(), turnId: randomUUID() };
    this.keys.set(request.commandId, ref); this.runs.set(ref.runId, { ref, request, state: 'running' }); this.startCount++;
    await delay(this.options.acknowledgeDelayMs ?? 0); return ref;
  }
  async resume(sessionId: string, request: RunRequest) { if (![...this.runs.values()].some(r => r.ref.sessionId === sessionId && r.state !== 'running')) throw new CapabilityError('Session unavailable or active'); const ref = await this.start(request); ref.sessionId = sessionId; return ref; }
  async enqueue(ref: RunRef, text: string): Promise<{ state: 'queued' }> { if (!this.runs.has(ref.runId)) throw new CapabilityError('Unknown run'); this.queued.set(ref.runId, [...(this.queued.get(ref.runId) ?? []), text]); return { state: 'queued' }; }
  async interrupt(ref: RunRef) { const r = this.runs.get(ref.runId); if (!r) throw new CapabilityError('Unknown run'); r.state = 'interrupted'; return { acknowledged: true }; }
  async reconcile(runId: string) { return { state: this.runs.get(runId)?.state ?? 'unknown' }; }
  async *events(runId: string): AsyncIterable<ProviderEvent> {
    const r = this.runs.get(runId); if (!r) throw new CapabilityError('Unknown run');
    const types: ProviderEvent['type'][] = ['session.created', 'turn.started', 'message.delta', 'usage.updated'];
    if (!this.options.loseTerminal) types.push(this.options.fail ? 'provider.error' : 'turn.completed');
    let sequence = 0;
    for (const type of types) {
      await delay(this.options.delayMs ?? 0);
      if (r.state === 'interrupted') return;
      let result: unknown;
      if (type === 'turn.completed' && r.request.workerContext) {
        const context = r.request.workerContext;
        const artifactRefs = context.artifacts.map(path => this.options.artifactWriter?.(r.request, path) ?? { path });
        result = { runId: context.runId, phaseId: context.phaseId, status: 'succeeded', summary: 'Fixture output. The coordinator must independently verify these bytes.', artifactRefs, claimedChecks: [], nextAction: 'Verify the artifacts.' };
      }
      const event = { key: `${runId}:${++sequence}`, sequence, type, data: type === 'message.delta' ? { text: 'Synthetic worker result. Verification is required.' } : { runId, sessionId: r.ref.sessionId, ...(result ? { result } : {}) } };
      yield event; if (this.options.duplicateEvents) yield event;
    }
    r.state = this.options.loseTerminal ? 'reconciling' : this.options.fail ? 'failed' : 'succeeded';
  }
}
