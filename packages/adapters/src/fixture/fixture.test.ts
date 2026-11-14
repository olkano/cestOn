import { it, expect } from 'vitest';
import { FixtureAdapter } from './index.js';

it('T09/T10 fixtures deduplicate starts and distinguish terminal evidence from lost transport', async () => {
  const adapter = new FixtureAdapter({ duplicateEvents: true });
  const request = { commandId: 'one', taskId: 't', prompt: 'synthetic', workspace: 'fixture' };
  const first = await adapter.start(request);
  const duplicate = await adapter.start(request);
  expect(first).toEqual(duplicate);
  const events = []; for await (const e of adapter.events(first.runId)) events.push(e);
  expect(events.filter(e => e.type === 'turn.completed')).toHaveLength(2);
  expect(adapter.startCount).toBe(1);
  const broken = new FixtureAdapter({ loseTerminal: true });
  const run = await broken.start(request);
  const lost = []; for await (const e of broken.events(run.runId)) lost.push(e);
  expect(lost.some(e => e.type === 'turn.completed')).toBe(false);
  expect((await broken.reconcile(run.runId)).state).toBe('reconciling');
});
