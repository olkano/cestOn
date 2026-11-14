import type { Config } from '../../../packages/contracts/src/config.js';
import type { ImprovementRequest, ImprovementWorker } from './improvement.js';
import type { BrokerClient } from '../../broker/src/client.js';
import { grantUpdate } from '../../broker/src/update-grants.js';
export class NativeUpdateWorker implements ImprovementWorker {
  constructor(private root: string, _config: Config, private connect: () => Promise<BrokerClient>) {}
  async edit(workspace: string, request: ImprovementRequest, stage: 'regression' | 'implementation', regression: string) {
    const grantId = grantUpdate(this.root, workspace, request, stage, regression);
    await (await this.connect()).updateEdit(grantId);
  }
}
