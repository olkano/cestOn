import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Config } from '../../../packages/contracts/src/config.js';
import { canonicalJson, DomainError } from '../../../packages/contracts/src/commands.js';
import { safePath, canonicalPath } from '../../../packages/contracts/src/paths.js';
import { certificationValid } from '../../broker/src/certification.js';
import { ReceiptJournal } from '../../broker/src/journal.js';
import { ToolPolicy, childEnvironment } from '../../broker/src/policy/index.js';
import { CodexAdapter } from '../../../packages/adapters/src/codex/index.js';
import { ClaudeAdapter } from '../../../packages/adapters/src/claude/index.js';
import type { Adapter, RunRef } from '../../../packages/adapters/src/types.js';
import type { ImprovementRequest, ImprovementWorker } from './improvement.js';
const responseSchema = z.strictObject({ summary: z.string().min(1).max(2000) });
export class NativeUpdateWorker implements ImprovementWorker {
  private journal: ReceiptJournal;
  constructor(private root: string, private config: Config) { this.journal = new ReceiptJournal(join(root, 'supervisor/update-worker.jsonl')); }
  async edit(workspace: string, request: ImprovementRequest, stage: 'regression' | 'implementation', regression: string) {
    const profile = this.config.providers.find(provider => provider.id === this.config.assistant.providerId);
    if (!profile || canonicalJson(profile) !== canonicalJson(request.provider)) throw new DomainError('improvement_profile_changed_or_unbound');
    if (!profile || !['codex', 'claude'].includes(profile.kind) || profile.profile !== 'constrained' || !profile.home || !certificationValid(this.root, profile)) throw new DomainError('certified_improvement_profile_required');
    if (profile.billingMode === 'unknown' || profile.kind === 'codex' && profile.billingMode === 'metered' || profile.billingMode === 'metered' && !this.config.limits.spendUsd) throw new DomainError('improvement_billing_cap_required');
    const environment = childEnvironment(process.env, profile.kind === 'claude' && profile.billingMode === 'metered' ? ['ANTHROPIC_API_KEY'] : []); environment[profile.kind === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR'] = profile.home;
    const policy = new ToolPolicy(workspace, ['read', 'edit'], []); const check = (name: string, input: Record<string, unknown>) => { const allowed = policy.check(name, input); if (!allowed.allowed || !['Write', 'Edit'].includes(name)) return allowed; try { const target = canonicalPath(resolve(workspace, String(input.file_path ?? input.path ?? ''))); if (stage === 'regression' ? target !== canonicalPath(safePath(workspace, regression)) : target === canonicalPath(safePath(workspace, regression))) return { allowed: false, reason: 'Regression test is fixed for this phase' }; return allowed; } catch { return { allowed: false, reason: 'Invalid update path' }; } };
    const adapter: Adapter & { close(): Promise<void> } = profile.kind === 'codex' ? new CodexAdapter({ command: profile.executable, args: ['app-server'], cwd: workspace, env: environment }, { version: profile.version, certified: true, readOnly: false, ...(profile.model ? { model: profile.model } : {}) }) : new ClaudeAdapter({ executable: profile.executable, version: profile.version, workspace, env: environment, certified: true, billingMode: profile.billingMode, check, ...(profile.model ? { model: profile.model } : {}) });
    const commandId = `${request.commandId}:${stage}`; let ref: RunRef | undefined;
    try {
      const probe = await adapter.probe(); if (!probe.authenticated || probe.capabilities.billingMode !== profile.billingMode) throw new DomainError('improvement_authentication_or_billing_mismatch');
      const prompt = JSON.stringify({ instruction: stage === 'regression' ? 'Create only the assigned Playwright regression test. Reproduce the requested ordinary UI behavior against the existing app. Use tests/e2e/helpers.ts to pair. Include real assertions, avoid infrastructure changes. Do not change application code yet. Return only the summary JSON.' : 'Fix the requested behavior in the isolated source. The regression test is frozen and must remain unchanged. Do not alter authentication, authority, update policy, dependencies, package scripts, existing mandatory tests or provider settings. The supervisor independently verifies and builds your work. Return only the summary JSON.', description: request.description, acceptanceCriteria: request.acceptanceCriteria, regression, schema: responseSchema.toJSONSchema(), scope: 'Candidate source only; no real projects, external actions, publication or Git push.' });
      if (Buffer.byteLength(prompt) > 65536) throw new DomainError('improvement_context_too_large');
      const spend = Math.min(request.budgets.spendUsd ?? 0, this.config.limits.spendUsd ?? 0); if (profile.billingMode === 'metered' && !spend) throw new DomainError('improvement_billing_cap_required');
      const accepted = await this.journal.dispatch(commandId, { workspace, requestHash: request.requestHash, stage, regression }, async () => { ref = await adapter.start({ commandId: randomUUID(), taskId: randomUUID(), workspace, prompt, operations: ['read', 'edit'], limits: { turns: Math.min(request.budgets.turns, this.config.limits.turns, stage === 'regression' ? 2 : 4), runMinutes: Math.min(request.budgets.runMinutes, this.config.limits.runMinutes, stage === 'regression' ? 5 : 8), ...(spend ? { spendUsd: spend / 2 } : {}) }, outputSchema: responseSchema.toJSONSchema() }); return { ref }; });
      if (!ref || (accepted.result.ref as RunRef).runId !== ref.runId) throw new DomainError('improvement_worker_reconciliation_required');
      let text = ''; let output: unknown; for await (const event of adapter.events(ref.runId)) { if (event.type === 'message.delta' && typeof event.data.text === 'string') text = (text + event.data.text).slice(-32768); if (event.type === 'turn.completed') output = event.data.result; }
      const state = await adapter.reconcile(ref.runId); if (state.state !== 'succeeded') throw new DomainError('improvement_worker_reconciliation_required'); const value = output ?? text; responseSchema.parse(typeof value === 'string' ? JSON.parse(value) : value); this.journal.resolve(commandId, { ref, state: 'succeeded' });
    } finally { await adapter.close(); }
  }
}
