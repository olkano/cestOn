import { it, expect } from 'vitest';
import { parseConfig } from '../../packages/contracts/src/config.js';

it('T27 fixture execution cannot be enabled for an ordinary installation', () => {
  expect(() => parseConfig({ providers: [{ id: 'fixture', kind: 'fixture', executable: '', version: '1' }] })).toThrow('fixture');
});
