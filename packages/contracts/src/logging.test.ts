import { it, expect } from 'vitest';
import { sanitizeLog } from './logging.js';

it('T27 keeps only allowlisted metadata, never raw payloads or secrets', () => {
  const log = sanitizeLog({ requestId: 'r1', operation: 'start', durationMs: 10, result: 'ok', message: 'synthetic-secret', token: 'synthetic-secret', path: 'private', payload: { key: 'secret' } });
  expect(log).toEqual({ requestId: 'r1', operation: 'start', durationMs: 10, result: 'ok' });
  expect(JSON.stringify(log)).not.toContain('secret');
});
