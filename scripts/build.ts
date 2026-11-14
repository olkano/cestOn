import { build } from 'vite';
import { generateIcons } from './icons.js';
import { run } from './run.js';
await generateIcons();
await run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json']);
await build({ root: 'apps/web' });
