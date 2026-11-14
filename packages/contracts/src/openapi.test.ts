import { it, expect } from 'vitest';
import { openapi } from './openapi.js';
it('generated API references resolve and subscriptions keep the shared strict input boundary', () => {
  const root = openapi as unknown as Record<string, unknown>;
  function inspect(value: unknown) { if (!value || typeof value !== 'object') return; for (const [key, item] of Object.entries(value)) { if (key === '$ref') { expect(typeof item).toBe('string'); if (String(item).startsWith('#/')) { let target: unknown = root; for (const part of String(item).slice(2).split('/')) target = (target as Record<string, unknown>)?.[part.replaceAll('~1', '/').replaceAll('~0', '~')]; expect(target, String(item)).toBeDefined(); } } else inspect(item); } }
  inspect(root); expect(openapi.components.schemas.PushSubscription?.additionalProperties).toBe(false);
});
