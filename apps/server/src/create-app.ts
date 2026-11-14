import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import { parseConfig, type Config } from '../../../packages/contracts/src/config.js';

export async function createApp(input: { config?: Config } = {}) {
  const config = input.config ?? parseConfig({});
  const app = Fastify({ logger: false, bodyLimit: 10 * 1024 * 1024, trustProxy: false });
  await app.register(helmet, { contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], frameAncestors: ["'none'"] } } });
  app.get('/health/live', async () => ({ data: { live: true }, meta: { requestId: 'health' } }));
  app.get('/api/v1/health/ready', async (_request, reply) => reply.code(503).send({ error: { code: 'setup_required', message: 'Complete local setup before managing work.', retryable: false }, meta: { requestId: 'readiness' } }));
  return { app, config };
}
