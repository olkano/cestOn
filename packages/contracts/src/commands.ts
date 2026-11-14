import { z } from 'zod';
import { operationSchema, limitsSchema } from './config.js';

export const scopeSchema = z.strictObject({
  operations: z.array(operationSchema).min(1).max(16).default(['read']),
  budgets: limitsSchema.prefault({}), completionBoundary: z.enum(['user_review', 'automatic']).default('user_review'),
});
const revision = z.number().int().positive();
const text = z.string().min(1).max(32768).refine(value => new TextEncoder().encode(value).byteLength <= 32768, 'Text exceeds 32 KiB');
const target = { taskId: z.uuid(), expectedRevision: revision, scopeRevisionId: z.uuid() };
const empty = z.strictObject({}).default({});
const command = <T extends string, S extends z.ZodType>(type: T, payload: S) => z.strictObject({ type: z.literal(type), ...target, payload });
export const commandSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('task.create'), payload: z.strictObject({ projectId: z.uuid(), title: z.string().min(1).max(160), goal: text, requestedScope: scopeSchema, sourceIds: z.array(z.uuid()).max(20).default([]) }) }),
  command('task.instruct', z.strictObject({ text, deliveryMode: z.enum(['queue', 'steer']).default('queue') })),
  command('decision.answer', z.strictObject({ decisionId: z.uuid(), decisionRevision: revision, optionId: z.string().min(1).max(80) })),
  command('task.pause', empty), command('task.resume', empty), command('task.cancel', empty), command('task.accept', empty),
  command('task.prioritize', z.strictObject({ priority: z.number().int().min(-100).max(100), dependencyIds: z.array(z.uuid()).max(100).default([]) })),
  command('session.adopt', z.strictObject({ sessionId: z.uuid(), handoffEvidenceId: z.uuid() })),
  command('action.approve', z.strictObject({ approvalId: z.uuid(), revision, proposedHash: z.string().regex(/^[a-f0-9]{64}$/) })),
  z.strictObject({ type: z.literal('installation.pause'), expectedRevision: revision, payload: empty }),
  z.strictObject({ type: z.literal('installation.resume'), expectedRevision: revision, payload: empty }),
  z.strictObject({ type: z.literal('assistant.improve'), payload: z.strictObject({ description: text, acceptanceCriteria: z.array(z.string().min(1).max(1000)).min(1).max(20), applyLocally: z.boolean() }) }),
  z.strictObject({ type: z.literal('update.rollback'), expectedRevision: revision, payload: z.strictObject({ updateId: z.uuid(), targetRelease: z.string().min(1).max(100) }) }),
]);
export type Command = z.infer<typeof commandSchema>;
export type Scope = z.infer<typeof scopeSchema>;
export type Receipt = { id: string; taskId: string | null; state: string; errorCode: string | null };
export function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}
export class DomainError extends Error {
  constructor(public code: string, public status = 409) { super(code); }
}
