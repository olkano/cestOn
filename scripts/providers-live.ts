import { readFileSync } from 'node:fs';
import { assertTestRoot } from '../packages/test-support/src/index.js';
import { parseConfig } from '../packages/contracts/src/config.js';
import { probeConfinement } from '../apps/broker/src/confinement.js';
import { runLiveCertification } from './certify-provider.js';

if (process.env.CESTON_LIVE_TESTS !== '1' || !process.env.CESTON_TEST_ROOT || !process.env.CESTON_TEST_CONFIG) throw new Error('Live certification requires CESTON_LIVE_TESTS=1, CESTON_TEST_ROOT, and CESTON_TEST_CONFIG. No provider work was started.');
assertTestRoot(process.env.CESTON_TEST_ROOT);
const config = parseConfig(JSON.parse(readFileSync(process.env.CESTON_TEST_CONFIG, 'utf8')));
if (config.providers.length === 0) throw new Error('Explicit provider profiles required.');
await probeConfinement(process.env.CESTON_TEST_ROOT, config);
await runLiveCertification(process.env.CESTON_TEST_ROOT, config);
