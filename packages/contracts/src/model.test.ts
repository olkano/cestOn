import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { validatePlan, validateIntent } from './model.js';

it('T12/T15 validates plans against existing authority and rejects invented recipes and cycles', () => {
  const project = { recipes: [{ id: 'tests', operation: 'test' }], operations: ['read', 'edit', 'test'], maxPhases: 8, completionBoundary: 'user_review' };
  const plan = { goal: 'A result', completionBoundary: 'user_review', phases: [{ id: 'one', ordinal: 1, goal: 'Write an artifact', dependsOn: [], allowedRecipeIds: [], expectedArtifacts: [{ path: 'result.txt' }], verificationRecipeIds: ['tests'], decisionBoundary: false }] };
  expect(validatePlan(plan, project).phases).toHaveLength(1);
  expect(() => validatePlan({ ...plan, phases: [{ ...plan.phases[0], verificationRecipeIds: ['publish'] }] }, project)).toThrow();
  expect(() => validatePlan({ ...plan, phases: [{ ...plan.phases[0], dependsOn: ['one'] }] }, project)).toThrow();
  expect(() => validatePlan({ ...plan, phases: [{ ...plan.phases[0], expectedArtifacts: [{ path: '../escape' }] }] }, project)).toThrow();
  expect(() => validatePlan({ ...plan, completionBoundary: 'automatic' }, project)).toThrow();
});

it('T14/T15 model output cannot invent task IDs, evidence or executable instructions', () => {
  const taskId = randomUUID();
  expect(() => validateIntent({ kind: 'answer', text: 'Done', evidenceIds: ['invented'] }, { taskIds: [taskId], evidenceIds: [] })).toThrow();
  expect(() => validateIntent({ kind: 'propose_command', interpretation: 'Pause', command: { type: 'task.pause', taskId: randomUUID(), expectedRevision: 1, scopeRevisionId: randomUUID(), payload: {} } }, { taskIds: [taskId], evidenceIds: [] })).toThrow();
  expect(() => validateIntent({ kind: 'propose_command', interpretation: 'Execute', command: { type: 'shell', payload: { command: 'publish' } } }, { taskIds: [taskId], evidenceIds: [] })).toThrow();
});
