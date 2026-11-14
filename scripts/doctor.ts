import { defaultRoot, doctor } from '../apps/supervisor/src/operations.js';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
const index = process.argv.indexOf('--root'); const root = index < 0 ? defaultRoot() : resolve(process.argv[index+1]!);
if (existsSync(join(root, 'state/config.json'))) console.log(JSON.stringify(await doctor(root), null, 2));
else console.log(JSON.stringify({ state: 'not_installed', checks: [{ capability: 'node', status: Number(process.versions.node.split('.')[0]) === 24 ? 'ready' : 'blocked' }], nextAction: 'Create and inspect a local package. Use ceston init with an explicit data root, bundle and configuration. No persistent service has been activated.' }, null, 2));
