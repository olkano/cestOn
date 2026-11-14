import { ProcessHost } from '../../../apps/supervisor/src/host.js';
import type { Config } from '../../contracts/src/config.js';
import { assertTestRoot } from './index.js';
export class FailingCandidateHost extends ProcessHost {
  constructor(root: string, installationId: string, config: Config, private baseline: string) { assertTestRoot(root); super(root, installationId, config, true); }
  override async healthy(releaseId: string) { return releaseId === this.baseline && await super.healthy(releaseId); }
}
