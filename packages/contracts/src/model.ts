import { z } from 'zod';
import { commandSchema, DomainError } from './commands.js';

export const artifactSchema = z.strictObject({ path: z.string().min(1).max(500).refine(p => !/^[\\/]|^[a-z]:/i.test(p) && !p.split(/[\\/]/).some(part => part === '..' || part === '.git' || part === '' || /^\.env(?:\.(?!example$).*)?$|^(?:auth|credentials)\.json$|^id_(?:rsa|ed25519)$|\.(?:pem|key)$/i.test(part)), 'Artifact path must stay within workspace and exclude credentials'), sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(), maxBytes: z.number().int().positive().max(10485760).default(1048576) });
export const planSchema = z.strictObject({
  goal: z.string().min(1).max(32768), completionBoundary: z.enum(['user_review', 'automatic']),
  phases: z.array(z.strictObject({ id: z.string().min(1).max(80), ordinal: z.number().int().positive(), goal: z.string().min(1).max(4000), dependsOn: z.array(z.string()).max(32), allowedRecipeIds: z.array(z.string()).max(32), expectedArtifacts: z.array(artifactSchema).max(100), verificationRecipeIds: z.array(z.string()).max(32), decisionBoundary: z.boolean() })).min(1).max(32),
});
export type Plan = z.infer<typeof planSchema>;
export type PhasePlan = Plan['phases'][number];
export function validatePlan(input: unknown, authority: { recipes: { id: string; operation: string }[]; operations: string[]; maxPhases: number; completionBoundary: string }): Plan {
  const parsed = planSchema.safeParse(input); if (!parsed.success) throw new DomainError('invalid_plan', 400);
  const plan = parsed.data;
  if (plan.phases.length > authority.maxPhases || plan.completionBoundary !== authority.completionBoundary) throw new DomainError('plan_scope_denied', 403);
  const phases = new Map(plan.phases.map(p => [p.id, p]));
  if (phases.size !== plan.phases.length || new Set(plan.phases.map(p => p.ordinal)).size !== plan.phases.length) throw new DomainError('duplicate_phase');
  for (const phase of plan.phases) {
    if (!phase.expectedArtifacts.length && !phase.verificationRecipeIds.length) throw new DomainError('verification_required');
    if (plan.completionBoundary === 'automatic' && !phase.verificationRecipeIds.length) throw new DomainError('automatic_verification_required');
    for (const recipeId of [...phase.allowedRecipeIds, ...phase.verificationRecipeIds]) {
      const recipe = authority.recipes.find(r => r.id === recipeId);
      if (!recipe || !authority.operations.includes(recipe.operation)) throw new DomainError('recipe_scope_denied', 403);
    }
    const visiting = new Set<string>(); const visited = new Set<string>();
    function visit(id: string) { if (visiting.has(id)) throw new DomainError('phase_dependency_cycle'); if (visited.has(id)) return; const p = phases.get(id); if (!p) throw new DomainError('unknown_phase_dependency'); visiting.add(id); for (const parent of p.dependsOn) visit(parent); visiting.delete(id); visited.add(id); }
    visit(phase.id);
  }
  return plan;
}
export const workerCompletionSchema = z.strictObject({
  runId: z.uuid(), phaseId: z.uuid(), status: z.enum(['succeeded', 'failed', 'needs_input']), summary: z.string().max(32768),
  artifactRefs: z.array(z.strictObject({ path: z.string().min(1).max(500), sha256: z.string().regex(/^[a-f0-9]{64}$/).optional() })).max(100),
  claimedChecks: z.array(z.string().max(2000)).max(100), nextAction: z.string().max(2000),
  decisionProposal: z.strictObject({ prompt: z.string().min(1).max(4000), options: z.array(z.strictObject({ id: z.string().min(1).max(80), label: z.string().min(1).max(160), meaning: z.string().min(1).max(2000) })).min(1).max(8) }).optional(),
});
export type WorkerCompletion = z.infer<typeof workerCompletionSchema>;
export const intentSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('answer'), text: z.string().max(32768), evidenceIds: z.array(z.string()).max(100) }),
  z.strictObject({ kind: z.literal('clarify'), question: z.string().min(1).max(1000), choices: z.array(z.string().max(160)).max(8).optional() }),
  z.strictObject({ kind: z.literal('propose_command'), interpretation: z.string().min(1).max(2000), command: commandSchema }),
]);
export type Intent = z.infer<typeof intentSchema>;
export function validateIntent(input: unknown, context: { taskIds: string[]; evidenceIds: string[] }): Intent {
  const parsed = intentSchema.safeParse(input); if (!parsed.success) throw new DomainError('invalid_intent', 400);
  const value = parsed.data;
  if (value.kind === 'answer' && value.evidenceIds.some(id => !context.evidenceIds.includes(id))) throw new DomainError('invented_evidence');
  if (value.kind === 'propose_command' && 'taskId' in value.command && !context.taskIds.includes(value.command.taskId)) throw new DomainError('invented_task');
  return value;
}
