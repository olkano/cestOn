import type { FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import { z, ZodError } from 'zod';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import type { Config } from '../../../../packages/contracts/src/config.js';
import { DomainError } from '../../../../packages/contracts/src/commands.js';
import { pairingSchema, conversationSchema, intakeSchema, pageSchema, taskQuerySchema, idSchema } from '../../../../packages/contracts/src/http.js';
import { safePath } from '../../../../packages/contracts/src/paths.js';
import type { Store } from '../db/store.js';
import { AuthService } from '../auth/service.js';
import { CommandService } from '../commands/service.js';
import { Assistant } from '../intents/assistant.js';
import { SourceIntake } from '../intents/intake.js';
import type { ActionService } from '../authority/actions.js';
import type { BrokerClient } from '../../../broker/src/client.js';
import { openapi } from '../../../../packages/contracts/src/openapi.js';
import { redactText } from '../../../../packages/contracts/src/logging.js';
import type { SpeechService } from '../voice/index.js';
import type { NotificationService } from '../notifications/index.js';
import type { ImprovementService } from '../updates/service.js';
import { ProjectMemory } from '../db/memory.js';
import { memoryQuery, memoryWrite } from '../../../../packages/contracts/src/memory.js';
import { LocalHistory } from '../projects/history.js';

export type ApiServices = { commands?: CommandService; assistant?: Assistant; actions?: ActionService; broker?: BrokerClient; speech?: SpeechService; notifications?: NotificationService; improvements?: ImprovementService; staticBundle?: string };
export async function registerApi(app: FastifyInstance, config: Config, input: ApiServices & { store?: Store; origin?: string }) {
  const store = input.store; const auth = store ? new AuthService(store) : null;
  const commands = input.commands ?? (store ? new CommandService(store, config) : null);
  const assistant = input.assistant ?? (store && commands ? new Assistant(store, commands, null) : null);
  const intake = store ? new SourceIntake(store) : null;
  const memory = store ? new ProjectMemory(store) : null;
  const history = new LocalHistory(config.history, store?.testMode ? store.dataRoot : undefined);
  const originUrl = new URL(input.origin ?? config.publicOrigin ?? `http://127.0.0.1:${config.listen.port}`); const secure = originUrl.protocol === 'https:';
  if (!secure && !['127.0.0.1', 'localhost', '[::1]'].includes(originUrl.hostname)) throw new DomainError('https_required');
  await app.register(cookie); await app.register(multipart, { limits: { fileSize: 10485760, files: 1, fields: 2, parts: 3 } });
  const streams = new Set<ServerResponse>();
  app.addHook('preClose', async () => { for (const stream of streams) stream.end(); streams.clear(); });
  app.setErrorHandler((error, request, reply) => {
    const err = error as Error & { statusCode?: number }; const code = error instanceof DomainError ? error.code : error instanceof ZodError ? 'invalid_request' : err.statusCode === 413 ? 'upload_too_large' : 'request_failed';
    const status = error instanceof DomainError ? error.status : error instanceof ZodError ? 400 : err.statusCode ?? 500;
    if (status === 429) reply.header('Retry-After', '60');
    void reply.code(status).send({ error: { code, message: code.replaceAll('_', ' '), retryable: [429, 503].includes(status) }, meta: { requestId: request.id } });
  });
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    reply.header('Cache-Control', 'no-store'); reply.header('Vary', 'Cookie');
    if (request.headers['x-ceston-protocol'] && request.headers['x-ceston-protocol'] !== '1') throw new DomainError('protocol_mismatch', 426);
    const pairing = request.url.split('?')[0] === '/api/v1/pairing/redeem' && request.method === 'POST';
    if (!auth) throw new DomainError('setup_required', 503);
    const device = pairing ? null : auth.authenticate(request.cookies.ceston);
    if (request.headers.host !== originUrl.host) throw new DomainError('host_rejected', 403);
    if (!['GET', 'HEAD'].includes(request.method)) {
      if (request.headers.origin !== originUrl.origin) throw new DomainError('origin_rejected', 403);
      if (device) auth.checkCsrf(device, request.headers['x-csrf-token']);
    }
  });
  const data = <T>(value: T, requestId: string) => ({ data: value, meta: { requestId } });
  app.post('/api/v1/pairing/redeem', async (request, reply) => {
    const body = pairingSchema.parse(request.body); const result = auth!.redeem(body.invitation, body.deviceName, request.ip);
    reply.setCookie('ceston', result.token, { path: '/api', httpOnly: true, sameSite: 'strict', secure, maxAge: 30 * 86400 });
    return data({ deviceId: result.device.id, csrf: result.csrf }, request.id);
  });
  app.get('/api/v1/me', async request => {
    const device = auth!.authenticate(request.cookies.ceston);
    return data({ installationId: store!.installation().id, deviceId: device.id, displayName: device.display_name, csrf: auth!.csrf(request.cookies.ceston!), protocol: 1, capabilities: { voice: input.speech?.available ?? false, push: config.push.enabled && Boolean(input.notifications?.pushAvailable), pushPublicKey: config.push.enabled && input.notifications?.pushAvailable ? config.push.publicKey ?? null : null, providers: config.providers.map(p => ({ id: p.id, kind: p.kind, profile: p.profile })) } }, request.id);
  });
  app.get('/api/v1/openapi.json', async () => openapi);
  app.get('/api/v1/updates', async request => data(input.improvements?.list() ?? [], request.id));
  app.get('/api/v1/updates/:id', async request => { const { id } = idSchema.parse(request.params); if (!input.improvements) throw new DomainError('updates_unavailable', 422); return data(input.improvements.view(id), request.id); });
  app.get('/api/v1/health/ready', async request => data({ ready: true, protocol: 1, database: 'ready', release: store!.installation().active_release ?? 'development', staticBundle: input.staticBundle ?? null }, request.id));
  app.get('/api/v1/snapshot', async request => { const query = pageSchema.extend({ expectedCursor: z.coerce.number().int().min(0).optional() }).parse(request.query); return data(store!.snapshot(query.after, query.expectedCursor), request.id); });
  app.get('/api/v1/memory', async request => {
    const query = memoryQuery.parse(request.query);
    return data(memory!.list(query.search, query.projectId, query.offset, query.focus), request.id);
  });
  app.get('/api/v1/memory/folders', async request => {
    const inventory = await history.list('', undefined, 0);
    memory!.rememberFolders(inventory.folders);
    return data(memory!.folders(), request.id);
  });
  app.post('/api/v1/memory/folders/move', async request => {
    auth!.commandLimit(auth!.authenticate(request.cookies.ceston).id);
    const { from, to } = z.strictObject({ from: z.uuid(), to: z.uuid() }).parse(request.body);
    memory!.confirmFolderMove(from, to);
    return data({ moved: true }, request.id);
  });
  app.get('/api/v1/history', async request => {
    const query = z.strictObject({
      search: z.string().trim().max(200).default(''), folderId: z.uuid().optional(),
      offset: z.coerce.number().int().min(0).max(8000).default(0),
    }).parse(request.query);
    return data(await history.list(query.search, query.folderId, query.offset), request.id);
  });
  app.get('/api/v1/history/:id', async request => {
    const { id } = z.strictObject({ id: z.string().regex(/^[a-f0-9]{32}$/) }).parse(request.params);
    const { before } = z.strictObject({ before: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional() }).parse(request.query);
    return data(await history.read(id, before), request.id);
  });
  app.post('/api/v1/memory', async request => {
    auth!.commandLimit(auth!.authenticate(request.cookies.ceston).id);
    return data(memory!.save(memoryWrite.parse(request.body)), request.id);
  });
  app.post('/api/v1/memory/:id/forget', async request => {
    auth!.commandLimit(auth!.authenticate(request.cookies.ceston).id);
    const { id } = idSchema.parse(request.params);
    const { revision } = z.strictObject({ revision: z.number().int().positive() }).parse(request.body);
    memory!.forget(id, revision);
    return data({ forgotten: true }, request.id);
  });
  app.get('/api/v1/memory/projects/:id', async request => {
    return data({ excluded: memory!.excluded(idSchema.parse(request.params).id) }, request.id);
  });
  app.post('/api/v1/memory/projects/:id', async request => {
    auth!.commandLimit(auth!.authenticate(request.cookies.ceston).id);
    const { excluded } = z.strictObject({ excluded: z.boolean() }).parse(request.body);
    memory!.setExcluded(idSchema.parse(request.params).id, excluded);
    return data({ excluded }, request.id);
  });
  app.get('/api/v1/sources', async request => { const query = z.strictObject({ projectId: z.uuid() }).parse(request.query); store!.project(query.projectId); return data(store!.db.prepare('SELECT id,kind,created_at AS createdAt FROM sources WHERE project_id=? ORDER BY created_at DESC LIMIT 100').all(query.projectId), request.id); });
  app.get('/api/v1/limits', async request => data(config.limits, request.id));
  app.get('/api/v1/notifications', async request => data(input.notifications?.list() ?? [], request.id));
  app.post('/api/v1/notifications/:id/read', async request => { if (!input.notifications) throw new DomainError('notifications_unavailable', 422); input.notifications.markRead(idSchema.parse(request.params).id); return data({ read: true }, request.id); });
  app.post('/api/v1/push/subscriptions', async request => { if (!config.push.enabled || !input.notifications?.pushAvailable) throw new DomainError('push_unavailable', 422); return data(await input.notifications.subscribe(auth!.authenticate(request.cookies.ceston).id, request.body), request.id); });
  app.delete('/api/v1/push/subscriptions/:id', async request => { if (!input.notifications) throw new DomainError('push_unavailable', 422); await input.notifications.unsubscribe(auth!.authenticate(request.cookies.ceston).id, idSchema.parse(request.params).id); return data({ removed: true }, request.id); });
  app.post('/api/v1/voice/transcribe', async request => { auth!.commandLimit(auth!.authenticate(request.cookies.ceston).id); if (!input.speech?.available) throw new DomainError('speech_unavailable', 422); const file = await request.file(); if (!file) throw new DomainError('audio_required', 400); return data(await input.speech.transcribe(await file.toBuffer(), file.mimetype), request.id); });
  app.post('/api/v1/voice/speak', async () => { throw new DomainError('server_voice_unavailable_use_browser_playback', 422); });
  app.get('/api/v1/projects', async request => data(store!.snapshot().projects.map(p => ({ ...p, operations: config.projects.find(c => c.id === p.id)?.operations ?? ['read'], recipes: config.projects.find(c => c.id === p.id)?.recipes.map(r => ({ id: r.id, operation: r.operation })) ?? [] })), request.id));
  app.get('/api/v1/tasks', async request => {
    const { attention, ...query } = taskQuerySchema.parse(request.query); const tasks = store!.listTasks({ after: query.after, ...(query.state ? { state: query.state } : {}), ...(query.project ? { project: query.project } : {}), ...(query.search ? { search: query.search } : {}), attention: attention === 'true' });
    return data({ items: tasks, nextCursor: tasks.length === 100 ? query.after + 100 : null }, request.id);
  });
  app.get('/api/v1/tasks/:id', async request => data(store!.getTask(idSchema.parse(request.params).id), request.id));
  app.get('/api/v1/decisions/:id', async request => { const row = store!.db.prepare('SELECT task_id FROM decisions WHERE id=?').get(idSchema.parse(request.params).id) as { task_id: string } | undefined; if (!row) throw new DomainError('decision_not_found', 404); return data({ taskId: row.task_id, decision: store!.getTask(row.task_id).decision }, request.id); });
  app.get('/api/v1/tasks/:id/events', async request => { const id = idSchema.parse(request.params).id; store!.taskRow(id); const events = store!.events(pageSchema.parse(request.query).after, id); return data(events.map(event => ({ sequence: event.sequence, type: event.type, occurredAt: new Date(event.created_at).toISOString(), data: JSON.parse(event.sanitized_payload_json) as unknown })), request.id); });
  app.post('/api/v1/commands', async (request, reply) => {
    const device = auth!.authenticate(request.cookies.ceston); auth!.commandLimit(device.id);
    const key = z.uuid().parse(request.headers['idempotency-key']); const receipt = commands!.receive(device.id, key, request.body);
    reply.code(202); return data({ ...receipt, statusUrl: `/api/v1/commands/${receipt.id}` }, request.id);
  });
  app.get('/api/v1/commands/:id', async request => data(store!.command(idSchema.parse(request.params).id), request.id));
  app.post('/api/v1/conversation', async request => { const device = auth!.authenticate(request.cookies.ceston); auth!.commandLimit(device.id); return data(await assistant!.respond({ ...conversationSchema.parse(request.body), deviceId: device.id }), request.id); });
  app.get('/api/v1/general', async request => data(assistant!.generalThreads(), request.id));
  app.get('/api/v1/general/:id', async request => data(assistant!.generalMessages(idSchema.parse(request.params).id), request.id));
  app.post('/api/v1/intake', async request => {
    auth!.commandLimit(auth!.authenticate(request.cookies.ceston).id);
    if (request.isMultipart()) {
      const file = await request.file(); if (!file) throw new DomainError('file_required', 400);
      const bytes = await file.toBuffer(); const project = file.fields.projectId; const projectId = z.uuid().parse(project && 'value' in project ? project.value : undefined);
      return data(await intake!.accept(projectId, file.mimetype, bytes), request.id);
    }
    const body = intakeSchema.parse(request.body); return data(await intake!.accept(body.projectId, body.mime, Buffer.from(body.text)), request.id);
  });
  app.get('/api/v1/evidence/:id', async (request, reply) => {
    const row = store!.db.prepare('SELECT relative_blob_path,content_hash FROM evidence WHERE id=?').get(idSchema.parse(request.params).id) as { relative_blob_path: string; content_hash: string } | undefined;
    if (!row) throw new DomainError('evidence_not_found', 404);
    const bytes = readFileSync(safePath(store!.dataRoot, row.relative_blob_path));
    if (createHash('sha256').update(bytes).digest('hex') !== row.content_hash) throw new DomainError('evidence_integrity_failed');
    return reply.header('Content-Disposition', 'attachment; filename="evidence.bin"').type('application/octet-stream').send(bytes);
  });
  app.get('/api/v1/evidence/:id/preview', async request => {
    const row = store!.db.prepare('SELECT task_id,run_id,relative_blob_path,content_hash FROM evidence WHERE id=?').get(idSchema.parse(request.params).id) as { task_id: string; run_id: string | null; relative_blob_path: string; content_hash: string } | undefined;
    if (!row) throw new DomainError('evidence_not_found', 404);
    const bytes = readFileSync(safePath(store!.dataRoot, row.relative_blob_path)); if (createHash('sha256').update(bytes).digest('hex') !== row.content_hash) throw new DomainError('evidence_integrity_failed');
    const file = row.run_id ? safePath(store!.dataRoot, `state/evidence/${row.run_id}.baseline.json`) : null;
    const baseline = file && existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as { taskId: string; artifacts: { path: string; before: { bytes: string; hash: string } | null }[] } : null;
    if (baseline && baseline.taskId !== row.task_id) throw new DomainError('baseline_integrity_failed');
    const metadataFile = safePath(store!.dataRoot, `state/evidence/${idSchema.parse(request.params).id}.json`); const metadata = existsSync(metadataFile) ? JSON.parse(readFileSync(metadataFile, 'utf8')) as { path: string; taskId: string; runId: string; hash: string } : null;
    if (metadata && (metadata.hash !== row.content_hash || metadata.taskId !== row.task_id || metadata.runId !== row.run_id)) throw new DomainError('evidence_integrity_failed');
    const path = metadata?.path ?? 'Verified artifact'; const original = baseline?.artifacts.find(item => item.path === path)?.before;
    const before = original ? Buffer.from(original.bytes, 'base64') : null; if (before && createHash('sha256').update(before).digest('hex') !== original!.hash) throw new DomainError('baseline_integrity_failed');
    const text = (value: Buffer) => { try { return redactText(new TextDecoder('utf-8', { fatal: true }).decode(value)); } catch { return 'Binary artifact. Download to inspect.'; } };
    return data({ path, before: before ? text(before) : baseline ? 'New file' : 'Baseline unavailable', after: text(bytes), truncated: bytes.length > 32768 || (before?.length ?? 0) > 32768 }, request.id);
  });
  app.get('/api/v1/devices', async request => data(auth!.list(), request.id));
  app.delete('/api/v1/devices/:id', async (request, reply) => { const id = idSchema.parse(request.params).id; const current = auth!.authenticate(request.cookies.ceston).id; auth!.revoke(id); if (id === current) reply.clearCookie('ceston', { path: '/api' }); return data({ revoked: true }, request.id); });
  app.get('/api/v1/sessions', async request => data(store!.db.prepare('SELECT id,provider,project_id AS projectId,task_id AS taskId,ownership,observed_state AS observedState,observed_at AS observedAt FROM sessions ORDER BY observed_at DESC LIMIT 100').all(), request.id));
  const historyRefs = new Map<string, { providerId: string; reference: string }>();
  app.get('/api/v1/sessions/discovery', async request => {
    const query = z.strictObject({ providerId: z.string().max(80), cursor: z.uuid().optional() }).parse(request.query);
    if (!input.broker || !config.providers.some(p => p.id === query.providerId && p.home)) throw new DomainError('session_discovery_unavailable', 422);
    const page = await input.broker.discover(query.providerId, query.cursor);
    for (const session of page.sessions) {
      store!.project(session.projectId);
      store!.db.prepare("INSERT INTO sessions(id,provider,provider_session_id,provider_home_id,project_id,ownership,observed_state,observed_at) VALUES(?,?,?,?,?,'observe_only','unknown',?) ON CONFLICT(provider,provider_home_id,provider_session_id) DO UPDATE SET observed_at=excluded.observed_at").run(randomUUID(), query.providerId, session.providerSessionId, session.homeId, session.projectId, Date.parse(session.observedAt));
      const row = store!.db.prepare('SELECT id FROM sessions WHERE provider=? AND provider_home_id=? AND provider_session_id=?').get(query.providerId, session.homeId, session.providerSessionId) as { id: string };
      if (historyRefs.size >= 1000) historyRefs.delete(historyRefs.keys().next().value!);
      historyRefs.set(row.id, { providerId: query.providerId, reference: session.id });
    }
    return data({ observed: page.sessions.length, nextCursor: page.cursor ?? null }, request.id);
  });
  app.get('/api/v1/sessions/:id/history', async request => {
    const id = idSchema.parse(request.params).id; const query = pageSchema.parse(request.query);
    const row = store!.db.prepare('SELECT project_id FROM sessions WHERE id=?').get(id) as { project_id: string } | undefined;
    if (!row) throw new DomainError('session_not_found', 404); store!.project(row.project_id);
    const reference = historyRefs.get(id); if (!input.broker || !reference) throw new DomainError('refresh_session_observation', 422);
    return data(await input.broker.history(reference.providerId, reference.reference, query.after), request.id);
  });
  app.get('/api/v1/tasks/:id/approvals', async request => { const id = idSchema.parse(request.params).id; store!.taskRow(id); const rows = store!.db.prepare('SELECT id FROM action_approvals WHERE task_id=? LIMIT 100').all(id) as { id: string }[]; return data(input.actions ? rows.map(r => input.actions!.view(r.id)) : [], request.id); });
  app.get('/api/v1/events', async (request, reply) => {
    let cursor = pageSchema.parse(request.query).after; const token = request.cookies.ceston; let blocked = false;
    reply.hijack(); const stream = reply.raw; streams.add(stream);
    stream.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff' });
    const send = (value: string) => { if (!stream.write(value)) blocked = true; }; stream.on('drain', () => { blocked = false; });
    const poll = () => {
      try {
        auth!.authenticate(token, false); if (blocked) return;
        const earliest = (store!.db.prepare('SELECT MIN(sequence) AS n FROM events').get() as { n: number | null }).n;
        if ((earliest !== null && cursor > 0 && cursor < earliest - 1) || cursor > store!.latestCursor()) { send('event: resync_required\ndata: {"snapshot":"/api/v1/snapshot"}\n\n'); stream.end(); return; }
        for (const event of store!.events(cursor)) { send(`id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify({ eventId: event.event_id, aggregateId: event.aggregate_id, revision: event.aggregate_revision, occurredAt: new Date(event.created_at).toISOString(), data: JSON.parse(event.sanitized_payload_json) as unknown })}\n\n`); cursor = event.sequence; if (blocked) break; }
      } catch { stream.end(); }
    };
    send(': connected\n\n'); poll(); const interval = setInterval(poll, 500); const heartbeat = setInterval(() => { if (!blocked) send('event: host.status\ndata: {"live":true}\n\n'); }, 15000);
    const cleanup = () => { clearInterval(interval); clearInterval(heartbeat); streams.delete(stream); }; stream.once('close', cleanup); stream.once('error', cleanup);
  });
  return { auth, commands };
}
