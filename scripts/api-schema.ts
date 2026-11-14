import { writeFileSync, mkdirSync } from 'node:fs';
import { openapi } from '../packages/contracts/src/openapi.js';
mkdirSync('docs', { recursive: true }); writeFileSync('docs/api.openapi.json', JSON.stringify(openapi, null, 2) + '\n');
