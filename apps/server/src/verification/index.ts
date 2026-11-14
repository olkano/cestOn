import { readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { Store } from '../db/store.js';
import { safePath } from '../../../../packages/contracts/src/paths.js';
import { workerCompletionSchema, type PhasePlan } from '../../../../packages/contracts/src/model.js';
import { DomainError } from '../../../../packages/contracts/src/commands.js';
import type { ProjectConfig } from '../../../../packages/contracts/src/config.js';

export type RecipeResult = { exitCode: number; outputHash: string };
export type RecipeExecutor = (recipe: ProjectConfig['recipes'][number], root: string, context?: { runId: string; taskId: string; phaseId: string }) => Promise<RecipeResult>;
export class ArtifactVerifier {
  constructor(private store: Store, private executeRecipe: RecipeExecutor) {}
  async verify(input: { runId: string; phaseId: string; taskId: string; root: string; phase: PhasePlan; completion: unknown }) {
    const parsed = workerCompletionSchema.safeParse(input.completion);
    if (!parsed.success || parsed.data.runId !== input.runId || parsed.data.phaseId !== input.phaseId) throw new DomainError('worker_envelope_invalid');
    const result = parsed.data;
    if (result.status !== 'succeeded') throw new DomainError('worker_not_complete');
    const project = JSON.parse(this.store.project(this.store.taskRow(input.taskId).project_id).config_json) as ProjectConfig;
    if (result.artifactRefs.some(ref => !input.phase.expectedArtifacts.some(a => a.path === ref.path))) throw new DomainError('unexpected_artifact');
    const files: { path: string; hash: string; bytes: Buffer }[] = [];
    for (const expected of input.phase.expectedArtifacts) {
      const path = safePath(input.root, expected.path);
      let bytes: Buffer;
      try { const stat = statSync(path); if (!stat.isFile() || stat.size > expected.maxBytes) throw new DomainError('artifact_invalid'); bytes = readFileSync(path); } catch { throw new DomainError('artifact_missing_or_invalid'); }
      const hash = createHash('sha256').update(bytes).digest('hex');
      const claimed = result.artifactRefs.find(a => a.path === expected.path);
      if (!claimed || (claimed.sha256 && claimed.sha256 !== hash) || (expected.sha256 && expected.sha256 !== hash)) throw new DomainError('artifact_hash_mismatch');
      files.push({ path: expected.path, hash, bytes });
    }
    const checks: { recipeId: string; outputHash: string }[] = [];
    for (const recipeId of input.phase.verificationRecipeIds) {
      const recipe = project.recipes.find(r => r.id === recipeId); if (!recipe) throw new DomainError('recipe_unregistered');
      const checked = await this.executeRecipe(recipe, input.root, input);
      if (checked.exitCode !== 0) throw new DomainError('verification_failed');
      checks.push({ recipeId, outputHash: checked.outputHash });
    }
    // Re-read after tests so a verifier or concurrent mutation cannot silently change the reviewed bytes.
    for (const file of files) if (createHash('sha256').update(readFileSync(safePath(input.root, file.path))).digest('hex') !== file.hash) throw new DomainError('artifact_changed_during_verification');
    const directory = join(this.store.dataRoot, 'state', 'evidence'); mkdirSync(directory, { recursive: true });
    const evidence = files.map(file => {
      const id = randomUUID(); const relative = `state/evidence/${id}.blob`; writeFileSync(join(this.store.dataRoot, relative), file.bytes, { flag: 'wx', mode: 0o600 });
      return { id, relative, ...file };
    });
    this.store.db.transaction(() => {
      for (const file of evidence) this.store.db.prepare('INSERT INTO evidence(id,task_id,run_id,kind,content_hash,relative_blob_path,source,observed_at,retention_class) VALUES(?,?,?,?,?,?,?,?,?)').run(file.id, input.taskId, input.runId, 'artifact', file.hash, file.relative, 'verified-workspace-artifact', this.store.now(), 'summary');
      this.store.event(input.taskId, this.store.taskRow(input.taskId).revision, 'phase.verified', { phaseId: input.phaseId, evidenceIds: evidence.map(e => e.id), checks });
    })();
    return { evidenceIds: evidence.map(e => e.id), checks };
  }
}
