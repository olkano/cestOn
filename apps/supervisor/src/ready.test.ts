import { describe, expect, it, vi } from 'vitest';
import { reportReady } from './ready.js';

describe('Supervisor ready message', () => {
  it('reaches the starter while it is still waiting', () => {
    const send = vi.fn();
    reportReady({ ready: true }, { connected: true, send });
    expect(send).toHaveBeenCalledWith({ ready: true });
  });

  it('is skipped once the starter has given up, so a slow start at Windows sign-in keeps running', () => {
    const send = vi.fn();
    reportReady({ ready: true, recovery: true }, { connected: false, send });
    expect(send).not.toHaveBeenCalled();
    expect(() => reportReady({ ready: true }, { connected: false })).not.toThrow();
  });
});
