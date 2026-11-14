import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from './create-app.js';
import { Store } from './db/store.js';
import { CommandService } from './commands/service.js';
import { ActionService } from './authority/actions.js';
import { Assistant } from './intents/assistant.js';
import { FixtureModel, ProviderModel, PlanningService } from './intents/model.js';
import { Scheduler } from './scheduler/index.js';
import { BrokerWorker } from './scheduler/broker-worker.js';
import { ArtifactVerifier } from './verification/index.js';
import { recipeExecutor } from './verification/recipes.js';
import { spawnBroker } from '../../broker/src/client.js';
import { parseConfig } from '../../../packages/contracts/src/config.js';

export async function coordinator(root: string, options: { testMode?: boolean; origin?: string } = {}) {
  const config = parseConfig(JSON.parse(readFileSync(join(root, 'state', 'config.json'), 'utf8')), options);
  const store = new Store(root, options); for (const project of config.projects) store.registerProject(project);
  const broker = await spawnBroker(root, store.installation().id, options.testMode);
  const commands = new CommandService(store, config); const actions = new ActionService(store, commands, new Map());
  const scheduler = new Scheduler(store, config, new BrokerWorker(store, broker.client, config), new ArtifactVerifier(store, recipeExecutor(store, broker.client)));
  const model = options.testMode ? new FixtureModel(root) : config.assistant.providerId ? new ProviderModel(broker.client, config.assistant.providerId) : null;
  const planner = new PlanningService(store, scheduler, model);
  const services = await createApp({ config, store, commands, actions, assistant: new Assistant(store, commands, model), broker: broker.client, ...(options.origin ? { origin: options.origin } : {}) });
  let planning = false; let closing = false; const active = new Set<Promise<void>>();
  const track = (work: Promise<void>) => { const job = work.catch(() => { console.error(JSON.stringify({ operation: 'coordinator.tick', result: 'failed', code: 'reconciliation_required' })); }).finally(() => active.delete(job)); active.add(job); };
  const pump = () => { if (closing) return; if (!planning) { planning = true; track(planner.tick().finally(() => { planning = false; })); } track(scheduler.tick()); track(actions.tick()); };
  track(scheduler.recover());
  const timer = setInterval(pump, 250);
  return { ...services, store, broker, scheduler, async close() { closing = true; clearInterval(timer); await services.app.close(); await broker.close(); await Promise.all(active); store.close(); } };
}
