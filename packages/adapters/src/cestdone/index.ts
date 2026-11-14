import { CapabilityError, type Adapter, type Capabilities } from '../types.js';

export class CestDoneAdapter implements Adapter {
  readonly reason = 'No certified isolated configuration and versioned result manifest is available. Operational jobs are never used as smoke tests.';
  constructor(readonly executable: string) {}
  async probe() { return { version: 'unverified', transport: 'batch-unavailable', authenticated: false, verifiedAt: new Date().toISOString(), capabilities: { discover: false, readHistory: false, start: false, resumeExact: false, steerActive: false, interruptOwned: false, toolApproval: false, usage: false, structuredResult: false, sandbox: false, reattachOwned: false, billingMode: 'unknown' } satisfies Capabilities }; }
  private denied(): never { throw new CapabilityError('batch_isolation_uncertified'); }
  listSessions: Adapter['listSessions'] = async () => this.denied();
  readHistory: Adapter['readHistory'] = async () => this.denied();
  start: Adapter['start'] = async () => this.denied();
  resume: Adapter['resume'] = async () => this.denied();
  enqueue: Adapter['enqueue'] = async () => this.denied();
  interrupt: Adapter['interrupt'] = async () => this.denied();
  reconcile: Adapter['reconcile'] = async () => this.denied();
  events: Adapter['events'] = () => this.denied();
}
