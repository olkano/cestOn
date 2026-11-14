import { it, expect } from 'vitest';
import { OsProtector } from '../../apps/server/src/security/protection.js';
import { randomUUID } from 'node:crypto';
it.skipIf(process.platform !== 'win32')('T27 Windows DPAPI binds protected data to the user and installation purpose', async () => {
  const protection = new OsProtector(randomUUID()); const sealed = await protection.seal('synthetic subscription secret', 'fixture'); expect(sealed).not.toContain('synthetic'); expect(await protection.open(sealed, 'fixture')).toBe('synthetic subscription secret'); await expect(protection.open(sealed, 'other')).rejects.toThrow('os_protection_failed');
});
