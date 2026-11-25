import { describe, expect, it } from 'vitest';
import { claudeActivities, claudeChatSettings, claudeReplyArgs, claudeRosterReadable, claudeTurnInProgress, codexChatSettings, codexReplyArgs, replyStartCheck } from './history-provider.js';
import { editorFolders } from './editor-executables.js';
import { replyEnvironment } from './logon-environment.js';

const id = '01234567-89ab-4def-8123-000000000002';
const claude = { provider: 'Claude' as const, nativeId: id };
const codex = { provider: 'Codex' as const, nativeId: id };

describe('Start of a reply, checked on any provider version', () => {
  it('confirms Claude for the same chat whatever tools the chat has', () => {
    expect(replyStartCheck(claude, { type: 'system', subtype: 'hook_started' })).toBe('continue');
    expect(replyStartCheck(claude, { type: 'system', subtype: 'init', session_id: id, tools: ['Bash', 'Edit', 'Read', 'mcp__server__tool'] })).toBe('confirmed');
    expect(replyStartCheck(claude, { type: 'system', subtype: 'init', session_id: id, tools: [] })).toBe('confirmed');
  });

  it('stops Claude when the chat differs or output starts before the chat is named', () => {
    for (const item of [
      { type: 'system', subtype: 'init', session_id: id.replace(/2$/, '9'), tools: ['Read'] },
      { type: 'system', subtype: 'init' },
      { type: 'assistant', message: {} },
      { type: 'result', subtype: 'success' },
    ]) expect(replyStartCheck(claude, item)).toBe('stop');
  });

  it('confirms Codex only for the same thread and stops a turn that starts before it', () => {
    expect(replyStartCheck(codex, { type: 'thread.started', thread_id: id })).toBe('confirmed');
    expect(replyStartCheck(codex, { type: 'error', message: 'notice' })).toBe('continue');
    expect(replyStartCheck(codex, { type: 'thread.started', thread_id: id.replace(/2$/, '9') })).toBe('stop');
    expect(replyStartCheck(codex, { type: 'turn.started' })).toBe('stop');
    expect(replyStartCheck(codex, { type: 'item.completed', item: {} })).toBe('stop');
  });
});

const codexTurn = (model: string, effort: string | null, sandbox: object, fromSettings = false) => ({
  type: 'turn_context',
  payload: { model, ...(fromSettings ? {} : { effort }), approval_policy: 'never', sandbox_policy: sandbox,
    collaboration_mode: { mode: 'default', settings: { model, reasoning_effort: effort } } },
});

describe('Settings of the chat being continued', () => {
  it('uses the model, effort and permissions of the latest Codex turn', () => {
    const rows = [codexTurn('gpt-6.2-astra', 'medium', { type: 'read-only' }), { type: 'event_msg', payload: {} },
      codexTurn('gpt-6.2-sol', 'high', { type: 'danger-full-access' })];
    expect(codexChatSettings(rows)).toEqual({ model: 'gpt-6.2-sol', effort: 'high', sandbox: 'danger-full-access' });
    expect(codexChatSettings([codexTurn('gpt-6.2-sol', 'xhigh', { type: 'workspace-write', network_access: true }, true)]))
      .toEqual({ model: 'gpt-6.2-sol', effort: 'xhigh', sandbox: 'workspace-write', networkAccess: true });
    expect(codexChatSettings([])).toEqual({});
  });

  it('uses the model, effort and permission mode of the latest Claude turn, ignoring side tasks', () => {
    const rows = [
      { type: 'user', permissionMode: 'default', message: {} },
      { type: 'assistant', requestedModel: 'claude-fable-5-2', effort: 'medium', message: { model: 'claude-fable-5-2' } },
      { type: 'user', permissionMode: 'bypassPermissions', message: {} },
      { type: 'assistant', requestedModel: 'claude-opus-5-5', effort: 'xhigh', message: { model: 'claude-opus-5-5' } },
      { type: 'assistant', isSidechain: true, requestedModel: 'claude-haiku-5-5', effort: 'low', message: { model: 'claude-haiku-5-5' } },
      { type: 'assistant', message: { model: '<synthetic>' } },
    ];
    expect(claudeChatSettings(rows)).toEqual({ model: 'claude-opus-5-5', effort: 'xhigh', permissionMode: 'bypassPermissions' });
  });

  it('drops a value that could be read as another option', () => {
    expect(codexChatSettings([codexTurn('gpt" -c x="y', 'high', { type: 'danger-full-access' })])).toEqual({ effort: 'high', sandbox: 'danger-full-access' });
    expect(claudeChatSettings([{ type: 'assistant', requestedModel: '--dangerous', message: {} }])).toEqual({});
  });
});

describe('Reply commands', () => {
  it('continue a Codex chat with its own model, effort and permissions and the owner configuration', () => {
    const args = codexReplyArgs(id, { model: 'gpt-6.2-sol', effort: 'high', sandbox: 'danger-full-access' });
    expect(args.slice(0, 2)).toEqual(['exec', 'resume']);
    expect(args[args.indexOf('-m') + 1]).toBe('gpt-6.2-sol');
    expect(args).toEqual(expect.arrayContaining(['model_reasoning_effort="high"', 'sandbox_mode="danger-full-access"', 'approval_policy="never"']));
    expect(args.slice(-2)).toEqual([id, '-']);
    expect(args.join(' ')).not.toMatch(/ignore-user-config|read-only|mcp_servers|--disable|--sandbox/);
    expect(codexReplyArgs(id, { sandbox: 'workspace-write', networkAccess: true })).toContain('sandbox_workspace_write.network_access=true');
    expect(codexReplyArgs(id, {}).join(' ')).not.toMatch(/-m |model_reasoning_effort|sandbox_mode/);
  });

  it('continue a Claude chat with its own model, effort and permission mode and every tool it has', () => {
    const args = claudeReplyArgs(id, { model: 'claude-opus-5-5', effort: 'xhigh', permissionMode: 'bypassPermissions' });
    const after = (flag: string) => args[args.indexOf(flag) + 1];
    expect(after('--model')).toBe('claude-opus-5-5');
    expect(after('--effort')).toBe('xhigh');
    expect(after('--permission-mode')).toBe('bypassPermissions');
    expect(after('--resume')).toBe(id);
    expect(args.join(' ')).not.toMatch(/--restricted|--tools|strict-mcp|--mcp-config|max-turns|disable-slash|dontAsk/);
    expect(claudeReplyArgs(id, {}).join(' ')).not.toMatch(/--model|--effort|--permission-mode/);
  });
});

describe('Environment of a reply', () => {
  it('uses the owner logon environment with the provider home on top', () => {
    const env = replyEnvironment({ Path: 'C:\\Tools', ProgramFiles: 'C:\\Program Files', codex_home: 'C:\\elsewhere' }, { PATH: 'C:\\minimal' }, { CODEX_HOME: 'C:\\Users\\Public\\owner\\.codex' }, true);
    expect(env).toEqual({ Path: 'C:\\Tools', ProgramFiles: 'C:\\Program Files', CODEX_HOME: 'C:\\Users\\Public\\owner\\.codex' });
    expect(replyEnvironment(undefined, { PATH: 'C:\\minimal' }, { CLAUDE_CONFIG_DIR: 'C:\\h' }, true)).toEqual({ PATH: 'C:\\minimal', CLAUDE_CONFIG_DIR: 'C:\\h' });
    expect(replyEnvironment({ PROGRAMFILES: 'old', ProgramFiles: 'new' }, {}, {}, true)).toEqual({ ProgramFiles: 'new' });
    expect(replyEnvironment({ path: 'a', PATH: 'b' }, {}, {}, false)).toEqual({ path: 'a', PATH: 'b' });
  });
});

describe('Claude active-session roster', () => {
  it('is readable when every row names its session', () => {
    expect(claudeRosterReadable([])).toBe(true);
    expect(claudeRosterReadable([{ sessionId: id, status: 'idle' }, { sessionId: id, status: 'busy', kind: 'interactive' }])).toBe(true);
  });

  it('is unreadable when the shape changed, so a busy chat cannot pass as idle', () => {
    for (const roster of [{}, null, [null], [{ session_id: id, status: 'busy' }], [{ sessionId: 7 }], [{ sessionId: id }, 'row']]) {
      expect(claudeRosterReadable(roster)).toBe(false);
    }
  });
});

describe('Claude session that another process has open', () => {
  it('lets a reply through when the open session is idle or not listed', () => {
    expect(claudeTurnInProgress([{ sessionId: id, status: 'idle', kind: 'interactive' }], id)).toBe(false);
    expect(claudeTurnInProgress([{ sessionId: id, state: 'done' }], id)).toBe(false);
    expect(claudeTurnInProgress([], id)).toBe(false);
  });

  it('holds a reply while a turn is running, awaiting input, or in an unknown state', () => {
    for (const row of [{ status: 'busy' }, { status: 'waiting' }, { state: 'working' }, { state: 'blocked' }, {}]) {
      expect(claudeTurnInProgress([{ sessionId: id, ...row }], id)).toBe(true);
    }
  });

  it('holds when any process on the session is mid-turn and ignores other sessions', () => {
    expect(claudeTurnInProgress([{ sessionId: id, status: 'idle' }, { sessionId: id, status: 'busy' }], id)).toBe(true);
    expect(claudeTurnInProgress([null, { sessionId: '01234567-89ab-4def-8123-000000000009', status: 'busy' }], id)).toBe(false);
  });

  it('keeps reporting the same activity for the chat list', () => {
    expect(claudeActivities([{ sessionId: id, status: 'busy' }, { sessionId: id.replace(/2$/, '3'), status: 'idle' }, { sessionId: id.replace(/2$/, '4') }])
      .map(row => row.status)).toEqual(['working', 'idle']);
  });
});

describe('Provider binary used by VS Code', () => {
  it('picks the newest installed extension for each provider', () => {
    const folders = ['anthropic.claude-code-2.1.331-win32-x64', 'anthropic.claude-code-2.1.332-win32-x64', 'anthropic.claude-code-2.1.40-win32-x64',
      'openai.chatgpt-26.51120.50957-win32-x64', 'openai.chatgpt-26.4.1-win32-x64', 'openai.codex-audio-26.1120.50957', 'anthropic.claude-code-latest'];
    expect(editorFolders('Claude', folders)).toEqual(['anthropic.claude-code-2.1.332-win32-x64', 'anthropic.claude-code-2.1.331-win32-x64', 'anthropic.claude-code-2.1.40-win32-x64']);
    expect(editorFolders('Codex', folders)).toEqual(['openai.chatgpt-26.51120.50957-win32-x64', 'openai.chatgpt-26.4.1-win32-x64']);
  });
});
