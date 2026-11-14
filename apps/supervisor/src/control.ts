import { randomUUID } from 'node:crypto';
import { ipcRequest } from '../../broker/src/ipc.js';
import { readOwner } from '../../broker/src/registry.js';
import { DomainError } from '../../../packages/contracts/src/commands.js';
export async function coordinatorControl<T>(root: string, installationId: string, key: string, method: 'status' | 'freeze' | 'shutdown', payload: unknown = {}): Promise<T> {
  const owner = await readOwner(root, 'coordinator', installationId, key); if (!owner) throw new DomainError('coordinator_not_running', 503);
  const requestId = randomUUID(); const response = await ipcRequest(owner.endpoint, { protocol: 1, requestId, installationId, token: key, method, payload }); if (response.error || response.requestId !== requestId) throw new DomainError(response.error?.code ?? 'wrong_control_response', 503); return response.data as T;
}
