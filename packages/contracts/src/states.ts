const machines: Record<string, Record<string, readonly string[]>> = {
  task: {
    draft: ['queued', 'cancelled'], queued: ['running', 'waiting_input', 'blocked', 'paused', 'cancelled'],
    running: ['waiting_input', 'blocked', 'pausing', 'review_ready'], waiting_input: ['queued', 'blocked', 'paused', 'cancelled'],
    blocked: ['queued', 'paused', 'cancelled'], pausing: ['paused', 'cancelled', 'blocked'], paused: ['queued', 'cancelled'],
    review_ready: ['completed', 'queued', 'cancelled'], completed: [], cancelled: [],
  },
  run: {
    created: ['starting', 'interrupting', 'failed', 'reconciling'], starting: ['running', 'interrupting', 'failed', 'reconciling'],
    running: ['verifying', 'interrupting', 'failed', 'reconciling'], verifying: ['succeeded', 'failed', 'interrupting', 'reconciling'],
    interrupting: ['interrupted', 'failed', 'reconciling'], reconciling: ['running', 'verifying', 'succeeded', 'failed', 'interrupted', 'needs_attention'],
    interrupted: [], succeeded: [], failed: [], needs_attention: ['reconciling'],
  },
  command: {
    received: ['queued', 'rejected'], queued: ['dispatching', 'rejected', 'cancelled'], dispatching: ['accepted', 'failed', 'reconciling'],
    accepted: ['running', 'reconciling', 'failed', 'cancelled'], running: ['succeeded', 'failed', 'reconciling', 'cancelled'],
    reconciling: ['accepted', 'running', 'succeeded', 'failed', 'cancelled'], rejected: [], failed: [], succeeded: [], cancelled: [],
  },
  phase: {
    pending: ['eligible', 'cancelled', 'blocked'], eligible: ['running', 'blocked', 'cancelled'], running: ['verifying', 'waiting_input', 'blocked', 'cancelled'],
    verifying: ['done', 'eligible', 'waiting_input', 'blocked', 'cancelled'], waiting_input: ['eligible', 'blocked', 'cancelled'], blocked: ['eligible', 'cancelled'], done: [], cancelled: [],
  },
};
export function transition(kind: keyof typeof machines, from: string, to: string): string {
  if (!machines[kind]?.[from]?.includes(to)) throw new Error(`invalid_transition:${kind}:${from}:${to}`);
  return to;
}
