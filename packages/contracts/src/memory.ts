import { z } from 'zod';

export const memoryNote = z.strictObject({
  text: z.string().trim().min(1).max(4000),
  projectId: z.uuid().nullable(),
  relatedProjectId: z.uuid().nullable(),
  importance: z.enum(['high', 'normal', 'low']).nullable(),
  dueAt: z.iso.datetime({ offset: true }).nullable(),
  reviewAt: z.iso.datetime({ offset: true }).nullable(),
});
export const memoryWrite = memoryNote.extend({ id: z.uuid(), revision: z.number().int().min(0) });
export const memoryQuery = z.strictObject({
  search: z.string().trim().max(200).default(''),
  projectId: z.uuid().optional(),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
  focus: z.enum(['all', 'attention']).default('all'),
});
export type MemoryNote = z.infer<typeof memoryNote>;
export type MemoryWrite = z.infer<typeof memoryWrite>;
export type MemoryEntry = MemoryNote & {
  id: string;
  revision: number;
  recordedAt: string;
  updatedAt: string;
  source: 'you' | 'observation' | 'inference';
  sourceTaskId: string | null;
  needsReview: boolean;
  urgency: 'overdue' | 'soon' | 'later' | null;
};
