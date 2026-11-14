import { it, expect } from 'vitest';
import { CestDoneAdapter } from './index.js';

it('T26 an uncertified batch backend cannot execute hostile inherited settings', async () => {
  const adapter = new CestDoneAdapter('unconfigured');
  expect((await adapter.probe()).capabilities.start).toBe(false);
  await expect(adapter.start({ commandId: 'one', taskId: 'one', workspace: 'synthetic', prompt: 'Notifications and auto-commit must remain disabled' })).rejects.toThrow('batch_isolation_uncertified');
});
