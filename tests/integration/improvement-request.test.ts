import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Store } from '../../apps/server/src/db/store.js';
import { CommandService } from '../../apps/server/src/commands/service.js';
import { ImprovementService } from '../../apps/server/src/updates/service.js';
import { parseConfig } from '../../packages/contracts/src/config.js';
import { createTestRoot, cleanupTestRoot } from '../../packages/test-support/src/index.js';
it('T31 T35 a direct improvement request persists its exact authority once and remains separate from project dispatch', () => {
  const t = createTestRoot(); const store = new Store(t.root, { testMode: true });
  try { const device = randomUUID(); store.db.prepare('INSERT INTO devices(id,display_name,token_hash,created_at,last_seen_at,expires_at) VALUES(?,?,?,?,?,?)').run(device, 'Synthetic', randomUUID(), Date.now(), Date.now(), Date.now() + 600000); const commands = new CommandService(store, parseConfig({})); const improvements = new ImprovementService(store, commands); const key = randomUUID(); const input = { type: 'assistant.improve', payload: { description: 'Remember my Work filter after returning and apply the fix.', acceptanceCriteria: ['The selected filter survives returning to Work.'], applyLocally: true } }; const receipt = commands.receive(device, key, input); expect(commands.receive(device, key, input)).toEqual(receipt); expect(improvements.list()).toHaveLength(1); const update = improvements.list()[0]!; expect(update.state).toBe('requested'); expect(update.applyLocally).toBe(true); expect(update.acceptanceCriteria).toEqual(input.payload.acceptanceCriteria); expect(store.getTask(receipt.taskId!).project).toBe('cestOn'); expect(store.getTask(receipt.taskId!).state).toBe('blocked'); expect(store.db.prepare('SELECT 1 FROM outbox WHERE command_id=?').get(receipt.id)).toBeUndefined(); expect(store.getTask(receipt.taskId!).scope.operations).not.toContain('git.push'); expect(store.events(0, receipt.taskId!).some(event => event.type === 'update.changed')).toBe(true);
  } finally { store.close(); cleanupTestRoot(t.root, t.runId); }
});
