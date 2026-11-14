import { npmScript } from './run.js';
for (const script of ['typecheck', 'lint', 'test:unit', 'test:integration', 'test:e2e', 'build', 'test:docs']) await npmScript(script);
