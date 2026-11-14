import { it, expect } from 'vitest';
import { createApp } from '../../apps/server/src/create-app.js';

it('T01/T02 runs a loopback service without claiming managed readiness', async () => {
  const { app } = await createApp();
  try {
    const origin = await app.listen({ host: '127.0.0.1', port: 0 });
    expect((await fetch(`${origin}/health/live`)).status).toBe(200);
    expect((await fetch(`${origin}/api/v1/health/ready`)).status).toBe(503);
    expect((await fetch(`${origin}/api/v1/tasks`)).status).toBe(404);
    expect((await fetch(`${origin}/health/live`)).headers.get('content-security-policy')).toContain("default-src 'self'");
  } finally { await app.close(); }
});
