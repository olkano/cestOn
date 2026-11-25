import { describe, expect, it } from 'vitest';
import { fileTimeToMs, planClaudeTakeover } from './claude-takeover.js';
import type { LockHolder } from './codex-takeover.js';

const target = '01234567-89ab-4def-8123-000000000002';
const other = '01234567-89ab-4def-8123-000000000005';
// 2026-11-23T09:16:36.000Z as a Windows FILETIME.
const started = '134398989960000000';
const startedMs = fileTimeToMs(started);
const panel: LockHolder = {
  pid: 55400, startedAt: started, name: 'claude.exe', parentName: 'Code.exe',
  commandLine: 'c:\\ext\\anthropic.claude-code-2.1.330-win32-x64\\resources\\native-binary\\claude.exe --output-format stream-json --verbose --input-format stream-json --permission-prompt-tool=stdio',
};
const row = (sessionId: string, status = 'idle', extra: Record<string, unknown> = {}) => ({ pid: panel.pid, startedAt: startedMs + 900, kind: 'interactive', sessionId, status, ...extra });
const owners = ['code.exe'];

describe('Ending the VS Code Claude panel process that has a chat open', () => {
  it('converts the Windows start time', () => {
    expect(new Date(startedMs).toISOString()).toBe('2026-11-23T09:16:36.000Z');
  });

  it('sends at once when no process has the chat open, or the listed process has exited', () => {
    expect(planClaudeTakeover(target, [row(other)], { [panel.pid]: panel }, owners)).toEqual({ action: 'send' });
    expect(planClaudeTakeover(target, [row(target)], {}, owners)).toEqual({ action: 'send' });
  });

  it('ends an idle VS Code panel so its next message reloads the chat from the saved file', () => {
    expect(planClaudeTakeover(target, [row(target), row(other, 'busy', { pid: 1 })], { [panel.pid]: panel }, owners))
      .toEqual({ action: 'end', holder: panel, threads: [target] });
  });

  it('waits while any chat in that process is mid-turn or in an unknown state', () => {
    expect(planClaudeTakeover(target, [row(target, 'busy')], { [panel.pid]: panel }, owners)).toMatchObject({ action: 'wait', reason: 'turn_in_progress' });
    expect(planClaudeTakeover(target, [row(target), row(other, 'waiting')], { [panel.pid]: panel }, owners)).toMatchObject({ action: 'wait', reason: 'turn_in_progress' });
    expect(planClaudeTakeover(target, [row(target), row(other, 'unfamiliar')], { [panel.pid]: panel }, owners)).toMatchObject({ action: 'wait', reason: 'turn_in_progress' });
  });

  it('waits instead of ending a terminal, the Claude app, or any process it cannot identify as a VS Code panel', () => {
    const holders: LockHolder[] = [
      { ...panel, parentName: 'pwsh.exe', commandLine: 'claude.exe --dangerously-skip-permissions' },
      { ...panel, parentName: 'pwsh.exe' },
      { ...panel, commandLine: '"C:\\Program Files\\WindowsApps\\Claude\\app\\claude.exe"' },
      { ...panel, name: 'node.exe' },
      { ...panel, commandLine: panel.commandLine.replace('--input-format stream-json', '') },
    ];
    for (const holder of holders) {
      expect(planClaudeTakeover(target, [row(target)], { [panel.pid]: holder }, owners)).toMatchObject({ action: 'wait', reason: 'holder_not_editor' });
    }
  });

  it('waits when the roster cannot name a single holder or its process ID was reused', () => {
    expect(planClaudeTakeover(target, [row(target, 'idle', { pid: undefined })], { [panel.pid]: panel }, owners)).toMatchObject({ action: 'wait', reason: 'unknown_holder' });
    expect(planClaudeTakeover(target, [row(target), row(target, 'idle', { pid: 9 })], { [panel.pid]: panel, 9: { ...panel, pid: 9 } }, owners)).toMatchObject({ action: 'wait', reason: 'several_holders' });
    expect(planClaudeTakeover(target, [row(target, 'idle', { startedAt: startedMs + 3600000 })], { [panel.pid]: panel }, owners)).toMatchObject({ action: 'wait', reason: 'holder_changed' });
    expect(planClaudeTakeover(target, [row(target, 'idle', { startedAt: undefined })], { [panel.pid]: panel }, owners)).toMatchObject({ action: 'wait', reason: 'holder_changed' });
  });
});
