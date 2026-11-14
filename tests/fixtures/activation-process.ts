import { join } from 'node:path';
import { Supervisor } from '../../apps/supervisor/src/activation.js';
import { assertTestRoot } from '../../packages/test-support/src/index.js';
import { SyntheticActivationHost } from './activation-host.js';
const [root, updateId, phase] = process.argv.slice(2) as [string, string, string]; assertTestRoot(root);
const supervisor = new Supervisor(root, 'synthetic key', new SyntheticActivationHost(), { testMode: true, crash: current => { if (current === phase) { process.send?.({ phase: current }); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0); } } });
await supervisor.initialize(join(root, 'base')); await supervisor.stage(updateId, join(root, 'candidate'), 'request'); await supervisor.activate(updateId, 'request');
