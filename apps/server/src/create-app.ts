import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import { parseConfig, type Config } from '../../../packages/contracts/src/config.js';
import type { Store } from './db/store.js';
import { registerApi, type ApiServices } from './http/routes.js';
import { randomUUID } from 'node:crypto';

export async function createApp(input: ApiServices & { config?: Config; store?: Store; origin?: string } = {}) {
  const config = input.config ?? parseConfig({});
  const app = Fastify({ logger: false, bodyLimit: 10 * 1024 * 1024, trustProxy: false, requestIdHeader: false, genReqId: () => randomUUID() });
  await app.register(helmet, { contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], frameAncestors: ["'none'"] } } });
  app.get('/health/live', async request => ({ data: { live: true }, meta: { requestId: request.id } }));
  const services = await registerApi(app, config, input);
  return { app, config, ...services };
}
