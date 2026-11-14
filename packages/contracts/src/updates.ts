import { z } from 'zod';
export const updateStateSchema = z.enum(['requested', 'clarifying', 'reproducing', 'implementing', 'verifying', 'staged', 'waiting_for_safe_point', 'activating', 'checking', 'applied', 'rolling_back', 'rolled_back', 'failed', 'needs_authority']);
export type UpdateState = z.infer<typeof updateStateSchema>;
const transitions: Record<UpdateState, readonly UpdateState[]> = {
  requested: ['clarifying', 'reproducing', 'failed'], clarifying: ['requested', 'failed'], reproducing: ['implementing', 'failed', 'needs_authority'], implementing: ['verifying', 'failed', 'needs_authority'], verifying: ['staged', 'failed', 'needs_authority'], staged: ['waiting_for_safe_point', 'activating', 'failed', 'needs_authority'], waiting_for_safe_point: ['activating', 'failed', 'needs_authority'], activating: ['waiting_for_safe_point', 'checking', 'applied', 'rolling_back', 'rolled_back', 'failed'], checking: ['applied', 'rolling_back', 'rolled_back', 'failed'], applied: ['rolling_back'], rolling_back: ['rolled_back', 'failed'], rolled_back: [], failed: [], needs_authority: [],
};
export function updateTransition(from: UpdateState, to: UpdateState) { if (!transitions[from]?.includes(to)) throw new Error(`invalid_update_transition:${from}:${to}`); return to; }
export type ImprovementView = { id: string; taskId: string; state: UpdateState; description: string; acceptanceCriteria: string[]; applyLocally: boolean; baseRelease: string; candidateRelease: string | null; errorCode: string | null; revision: number; verification: Record<string, unknown>; updatedAt: string };
