import { it, expect } from 'vitest';
import { processIdentity, sameProcess } from '../../apps/broker/src/process-identity.js';

it('T07 PID reuse cannot turn a stale ownership record into a live owner', async () => {
  const identity = await processIdentity(process.pid);
  expect(identity).not.toBeNull(); expect(await sameProcess(identity!)).toBe(true);
  expect(await sameProcess({ pid: process.pid, startedAt: 'a-different-start-time' })).toBe(false);
  expect(await processIdentity(-1)).toBeNull();
});
