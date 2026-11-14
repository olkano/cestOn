import { it, expect } from 'vitest';
import { parseConfig } from '../../packages/contracts/src/config.js';

it('T32 unconfigured updates never opt into automatic activation', () => {
  expect(parseConfig({}).updates.requestedLocalApply).toBe(false);
  expect(() => parseConfig({ updates: { skipChecks: true } })).toThrow();
});
