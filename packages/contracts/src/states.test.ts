import { expect, it } from 'vitest';
import { transition } from './states.js';

it('T03 terminal completion cannot bypass verification or be resurrected', () => {
  expect(() => transition('task', 'queued', 'completed')).toThrow();
  expect(() => transition('run', 'interrupted', 'succeeded')).toThrow();
  expect(() => transition('task', 'completed', 'running')).toThrow();
  expect(transition('task', 'running', 'review_ready')).toBe('review_ready');
  expect(transition('run', 'reconciling', 'needs_attention')).toBe('needs_attention');
});
