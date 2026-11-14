export type ProviderEvent = { key: string; sequence: number; type: 'session.created' | 'turn.started' | 'message.delta' | 'tool.requested' | 'tool.started' | 'tool.completed' | 'usage.updated' | 'turn.completed' | 'provider.error'; data: Record<string, unknown> };
export type RunRequest = { commandId: string; taskId: string; prompt: string; workspace: string; operations?: string[]; limits?: { turns: number; runMinutes: number; spendUsd?: number | undefined } };
export type RunRef = { runId: string; sessionId: string; turnId: string };
export type Capabilities = { discover: boolean; readHistory: boolean; start: boolean; resumeExact: boolean; steerActive: boolean; interruptOwned: boolean; toolApproval: boolean; usage: boolean; structuredResult: boolean; sandbox: boolean; reattachOwned: boolean; billingMode: 'subscription' | 'metered' | 'unknown' | 'fixture' };
export class CapabilityError extends Error { code = 'unsupported_capability'; }
export interface Adapter {
  probe(): Promise<{ version: string; transport: string; capabilities: Capabilities; authenticated: boolean; verifiedAt: string }>;
  listSessions(cursor?: string): Promise<{ sessions: { id: string; title: string; state: string }[]; cursor?: string }>;
  readHistory(sessionId: string, cursor?: string): Promise<{ events: ProviderEvent[]; cursor?: string }>;
  start(request: RunRequest): Promise<RunRef>;
  resume(sessionId: string, request: RunRequest): Promise<RunRef>;
  enqueue(ref: RunRef, text: string): Promise<{ state: 'queued' | 'accepted' }>;
  interrupt(ref: RunRef): Promise<{ acknowledged: boolean }>;
  reconcile(runId: string): Promise<{ state: string }>;
  events(runId: string): AsyncIterable<ProviderEvent>;
}
