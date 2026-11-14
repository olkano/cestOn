import type { Store } from '../db/store.js';
import type { BrokerClient } from '../../../broker/src/client.js';
import type { RecipeExecutor } from './index.js';
import { DomainError } from '../../../../packages/contracts/src/commands.js';

export function recipeExecutor(store: Store, broker: BrokerClient): RecipeExecutor {
  return async (recipe, root, context) => {
    if (!context) throw new DomainError('recipe_scope_denied', 403);
    const run = store.db.prepare('SELECT usage_json,command_id FROM runs WHERE id=? AND task_id=?').get(context.runId, context.taskId) as { usage_json: string; command_id: string } | undefined;
    if (!run) throw new DomainError('recipe_scope_denied', 403);
    const request = store.db.prepare('SELECT payload_json FROM commands WHERE id=?').get(run.command_id) as { payload_json: string };
    if ((JSON.parse(request.payload_json) as { root: string }).root !== root) throw new DomainError('recipe_scope_denied', 403);
    const metadata = JSON.parse(run.usage_json) as { providerRunId?: string };
    if (!metadata.providerRunId) throw new DomainError('reconciliation_required');
    return broker.recipe(metadata.providerRunId, recipe.id);
  };
}
