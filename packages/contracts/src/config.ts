import { z } from 'zod';

export const operationSchema = z.enum(['read', 'edit', 'test', 'build', 'git.commit', 'git.push', 'external.write', 'deploy', 'publish']);
export const limitsSchema = z.strictObject({
  concurrency: z.number().int().min(1).max(8).default(2),
  phaseAttempts: z.number().int().min(1).max(5).default(2),
  runMinutes: z.number().int().min(1).max(180).default(45),
  taskPhases: z.number().int().min(1).max(32).default(8),
  turns: z.number().int().min(1).max(128).default(32),
  spendUsd: z.number().positive().max(100).optional(),
});
export const recipeSchema = z.strictObject({
  id: z.string().min(1).max(80), executable: z.string().min(1), args: z.array(z.string()).max(32),
  operation: z.enum(['test', 'build', 'read']), network: z.boolean().default(false), timeoutSeconds: z.number().int().min(1).max(600).default(120),
});
export const projectSchema = z.strictObject({
  id: z.uuid(), displayName: z.string().min(1).max(160), root: z.string().min(1), kind: z.enum(['git', 'documents']),
  allowedChildRoots: z.array(z.string()).default([]), providerId: z.string().optional(),
  operations: z.array(operationSchema).default(['read', 'edit', 'test', 'build']), recipes: z.array(recipeSchema).default([]),
});
export const providerSchema = z.strictObject({
  id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/), kind: z.enum(['codex', 'claude', 'claude-cli', 'cestdone', 'fixture']),
  executable: z.string(), version: z.string(), model: z.string().optional(), home: z.string().optional(),
  billingMode: z.enum(['subscription', 'metered', 'unknown']).default('unknown'),
  profile: z.enum(['constrained', 'observe_only', 'trusted_unrestricted']).default('observe_only'),
});
export const configSchema = z.strictObject({
  configVersion: z.literal(1).default(1),
  listen: z.strictObject({ host: z.literal('127.0.0.1').default('127.0.0.1'), port: z.number().int().min(0).max(65535).default(4318) }).prefault({}),
  publicOrigin: z.url().refine(value => {
    const u = new URL(value); return u.protocol === 'https:' && !u.hostname.endsWith('.invalid') && u.pathname === '/' && !u.search && !u.hash && !u.username && !u.password;
  }, 'A dedicated valid HTTPS origin is required').optional(),
  projects: z.array(projectSchema).max(100).default([]), providers: z.array(providerSchema).max(20).default([]),
  limits: limitsSchema.prefault({}),
  assistant: z.strictObject({ providerId: z.string().optional() }).prefault({}),
  executionHost: z.strictObject({ codexExecutable: z.string().optional(), version: z.string().optional(), home: z.string().optional(), toolchainRoot: z.string().optional() }).prefault({}),
  voice: z.strictObject({ enabled: z.boolean().default(false), endpoint: z.url().refine(value => { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash; }).optional(), credentialEnv: z.string().regex(/^CESTON_SPEECH_[A-Z0-9_]+$/).optional(), model: z.string().optional() }).prefault({}),
  push: z.strictObject({ enabled: z.boolean().default(false), subject: z.string().optional(), publicKey: z.string().optional(), privateKeyEnv: z.string().regex(/^CESTON_PUSH_[A-Z0-9_]+$/).optional() }).prefault({}),
  updates: z.strictObject({ requestedLocalApply: z.boolean().default(false), retainVerifiedReleases: z.number().int().min(3).max(10).default(3) }).prefault({}),
});
export type Config = z.infer<typeof configSchema>;
export type ProjectConfig = z.infer<typeof projectSchema>;
export type ProviderConfig = z.infer<typeof providerSchema>;
export type Limits = z.infer<typeof limitsSchema>;

export function parseConfig(input: unknown, options: { testMode?: boolean } = {}): Config {
  const parsed = configSchema.safeParse(input);
  if (!parsed.success) throw new Error(`Invalid configuration keys: ${parsed.error.issues.map(i => i.path.join('.') || '(root)').join(', ')}`);
  if (!options.testMode && parsed.data.providers.some(p => p.kind === 'fixture')) throw new Error('fixture provider requires a validated test installation');
  if (new Set(parsed.data.projects.map(p => p.id)).size !== parsed.data.projects.length || new Set(parsed.data.providers.map(p => p.id)).size !== parsed.data.providers.length) throw new Error('Duplicate configured IDs');
  return parsed.data;
}
