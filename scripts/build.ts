import { build } from 'vite';
import { generateIcons } from './icons.js';
import { run } from './run.js';
import './api-schema.js';
import { generateServiceWorker } from './service-worker.js';
await generateIcons();
await run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json']);
await build({ root: 'apps/web' });
generateServiceWorker();
