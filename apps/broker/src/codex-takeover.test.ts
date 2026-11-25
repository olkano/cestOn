import { describe, expect, it } from 'vitest';
import { codexTurnOpen, planCodexTakeover, type LockHolder } from './codex-takeover.js';

const target = '01234567-89ab-4def-8123-000000000001';
const other = '01234567-89ab-4def-8123-000000000005';
const event = (type: string, turn = 't1') => ({ type: 'event_msg', payload: { type, turn_id: turn } });
const editor: LockHolder = { pid: 70608, startedAt: '134000000000000000', name: 'codex.exe', commandLine: 'codex.exe -c features.x=true app-server --analytics-default-enabled', parentName: 'Code.exe' };
const owners = ['code.exe'];

describe('Codex turn state from a saved transcript', () => {
  it('reads a finished or aborted last turn as idle', () => {
    expect(codexTurnOpen([event('task_started'), event('task_complete')])).toBe(false);
    expect(codexTurnOpen([event('task_started'), event('turn_aborted')])).toBe(false);
    expect(codexTurnOpen([event('task_complete')])).toBe(false);
  });

  it('reads a started turn without an end as running, including one awaiting approval', () => {
    expect(codexTurnOpen([event('task_started', 't1'), event('task_complete', 't1'), event('task_started', 't2')])).toBe(true);
    expect(codexTurnOpen([event('task_started', 't2'), event('task_complete', 'other-turn')])).toBe(true);
  });

  it('reports an unknown state without a turn marker, so renamed markers in a Codex update never look idle', () => {
    expect(codexTurnOpen([{ type: 'response_item', payload: {} }])).toBeUndefined();
    expect(codexTurnOpen([{ type: 'session_meta', payload: {} }])).toBeUndefined();
    expect(codexTurnOpen([{ type: 'event_msg', payload: { type: 'turn_begun', turn_id: 't1' } }])).toBeUndefined();
  });
});

describe('Ending the Codex process that holds a chat', () => {
  it('sends at once when nothing holds the chat', () => {
    expect(planCodexTakeover(target, { [target]: [] }, {}, owners)).toEqual({ action: 'send' });
    expect(planCodexTakeover(target, {}, {}, owners)).toEqual({ action: 'send' });
  });

  it('ends a VS Code Codex process when every chat it holds is idle', () => {
    const plan = planCodexTakeover(target, { [target]: [editor], [other]: [editor] }, { [target]: false, [other]: false }, owners);
    expect(plan).toEqual({ action: 'end', holder: editor, threads: [target, other].sort() });
  });

  it('waits while any chat held by that process is running or in an unknown state', () => {
    expect(planCodexTakeover(target, { [target]: [editor], [other]: [editor] }, { [target]: false, [other]: true }, owners)).toMatchObject({ action: 'wait', reason: 'turn_in_progress' });
    expect(planCodexTakeover(target, { [target]: [editor], [other]: [editor] }, { [target]: false }, owners)).toMatchObject({ action: 'wait', reason: 'turn_in_progress' });
    expect(planCodexTakeover(target, { [target]: [editor] }, { [target]: true }, owners)).toMatchObject({ action: 'wait' });
  });

  it('ignores chats that a different process holds', () => {
    const desktop = { ...editor, pid: 89724, parentName: 'ChatGPT.exe' };
    expect(planCodexTakeover(target, { [target]: [editor], [other]: [desktop] }, { [target]: false, [other]: true }, owners)).toMatchObject({ action: 'end', threads: [target] });
  });

  it('never ends a process it cannot identify as one VS Code Codex app-server', () => {
    const cases: Record<string, LockHolder[]> = {
      desktopApp: [{ ...editor, parentName: 'ChatGPT.exe' }],
      notAppServer: [{ ...editor, commandLine: 'codex.exe exec resume' }],
      otherProgram: [{ ...editor, name: 'node.exe' }],
      unknownParent: [{ ...editor, parentName: '' }],
      twoHolders: [editor, { ...editor, pid: 71460 }],
    };
    for (const holders of Object.values(cases)) {
      expect(planCodexTakeover(target, { [target]: holders }, { [target]: false }, owners).action).toBe('wait');
    }
  });

  it('treats the same process ID with a different start time as a different process', () => {
    const reused = { ...editor, startedAt: '134000000000000999' };
    expect(planCodexTakeover(target, { [target]: [editor], [other]: [reused] }, { [target]: false, [other]: true }, owners)).toMatchObject({ action: 'end', threads: [target] });
  });
});
