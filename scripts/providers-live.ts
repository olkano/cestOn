import { readFileSync } from 'node:fs';
import { assertTestRoot } from '../packages/test-support/src/index.js';
import { parseConfig } from '../packages/contracts/src/config.js';

if (process.env.CESTON_LIVE_TESTS !== '1' || !process.env.CESTON_TEST_ROOT || !process.env.CESTON_TEST_CONFIG) throw new Error('Live certification requires CESTON_LIVE_TESTS=1, CESTON_TEST_ROOT, and CESTON_TEST_CONFIG. No provider work was started.');
assertTestRoot(process.env.CESTON_TEST_ROOT);
const config = parseConfig(JSON.parse(readFileSync(process.env.CESTON_TEST_CONFIG, 'utf8')));
if (config.providers.length === 0) throw new Error('Explicit provider profiles required.');
throw new Error('Live execution certification is blocked until the phase-2 adapter harness is implemented. No provider work was started.');
