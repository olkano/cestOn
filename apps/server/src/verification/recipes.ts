import type { Store } from '../db/store.js';
import type { BrokerClient } from '../../../broker/src/client.js';
import type { RecipeExecutor } from './index.js';
import { DomainError } from '../../../../packages/contracts/src/commands.js';

export function recipeExecutor(store: Store, broker: BrokerClient): RecipeExecutor {
  return async (recipe, root, context) => {
    if (!context || store.project(store.taskRow(context.taskId).project_id).canonical_root !== root) throw new DomainError('recipe_scope_denied', 403);
    const run = store.db.prepare('SELECT usage_json FROM runs WHERE id=?').get(context.runId) as { usage_json: string };
    const metadata = JSON.parse(run.usage_json) as { providerRunId?: string };
    if (!metadata.providerRunId) throw new DomainError('reconciliation_required');
    return broker.recipe(metadata.providerRunId, recipe.id);
  };
}
