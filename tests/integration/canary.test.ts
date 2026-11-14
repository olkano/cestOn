import { it, expect } from 'vitest';
import { runCanary } from '../../apps/supervisor/src/host.js';
it('T30 a separate coordinator and broker pass authenticated API, duplicate receipt and artifact canary checks', async () => { expect(await runCanary(process.cwd(), true)).toBe(true); });
