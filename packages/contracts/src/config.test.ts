import { describe, it, expect } from 'vitest';
import { configSchema, parseConfig } from './config.js';

describe('T02 configuration fails closed', () => {
  it('has bounded defaults and no implicitly enabled external services', () => {
    const c = configSchema.parse({});
    expect(c.limits).toEqual({ concurrency: 2, phaseAttempts: 2, runMinutes: 45, taskPhases: 8, turns: 32 });
    expect(c.voice.enabled || c.push.enabled || c.updates.requestedLocalApply).toBe(false);
  });
  it('rejects unknown fields, unbounded runs, public listeners and invalid remote origins', () => {
    for (const input of [{ token: 'synthetic-secret' }, { listen: { host: '0.0.0.0' } }, { limits: { turns: 0 } }, { publicOrigin: 'http://example.com' }, { publicOrigin: 'https://assistant.example.invalid' }]) {
      expect(() => parseConfig(input)).toThrow();
    }
  });
  it('reports keys without disclosing invalid values', () => {
    expect(() => parseConfig({ limits: { turns: 'synthetic-secret' } })).toThrow('limits.turns');
    try { parseConfig({ limits: { turns: 'synthetic-secret' } }); } catch (e) { expect(String(e)).not.toContain('synthetic-secret'); }
  });
});
