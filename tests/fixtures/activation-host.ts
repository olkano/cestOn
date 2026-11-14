import type { SupervisorHost, Validation } from '../../apps/supervisor/src/activation.js';
export class SyntheticActivationHost implements SupervisorHost {
  async validate(): Promise<Validation> { return { certifiedHost: false, checks: (['verify', 'security', 'updates', 'canary'] as const).map(name => ({ name, result: 'pass', evidenceHash: 'a'.repeat(64) })) }; }
  async freeze() {} async activeRuns() { return 0; } async backup() {} async capture() { return 'synthetic unchanged commands'; } async stopCoordinator() {} async startCoordinator() {} async healthy() { return true; } async preserved(value: string) { return value === 'synthetic unchanged commands'; } async canary() { return true; } async observe() { return true; }
}
