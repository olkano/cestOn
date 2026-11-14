import { it, expect } from 'vitest';
import type { Query, Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { ClaudeAdapter } from './index.js';

it('T09/T27 Claude uses exact sessions and a fail-closed hook before effective tool permissions', async () => {
  let options: Options | undefined; let starts = 0;
  const adapter = new ClaudeAdapter({ executable: 'synthetic', version: '2.1.317', workspace: 'fixture', env: {}, certified: true, billingMode: 'subscription', check: name => ({ allowed: name === 'Read', reason: 'fixture boundary' }), queryFactory: params => {
    options = params.options; starts++;
    const generator = (async function* () {
      yield { type: 'system', subtype: 'init', session_id: 'exact-session' } as unknown as SDKMessage;
      yield { type: 'result', subtype: 'success', session_id: 'exact-session', is_error: false, result: 'synthetic', usage: {}, total_cost_usd: 0 } as unknown as SDKMessage;
    })();
    return Object.assign(generator, { close() {}, async interrupt() {} }) as unknown as Query;
  } });
  try {
    const request = { commandId: 'one', taskId: 'task', prompt: 'fixture', workspace: 'fixture' };
    const [a, b] = await Promise.all([adapter.start(request), adapter.start(request)]);
    expect(a).toEqual(b); expect(starts).toBe(1); expect(a.sessionId).toBe('exact-session');
    for await (const event of adapter.events(a.runId)) void event;
    expect((await adapter.reconcile(a.runId)).state).toBe('succeeded');
    expect(options?.settingSources).toEqual([]); expect(options?.disallowedTools).toContain('Bash');
    const matcher = options!.hooks!.PreToolUse![0]!;
    expect(matcher.onFailure).toBe('block');
    const blocked = await matcher.hooks[0]!({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'unsafe' }, session_id: 'exact-session', transcript_path: 'fixture', cwd: 'fixture', tool_use_id: 'one' }, 'one', { signal: new AbortController().signal });
    expect(blocked).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });
    await expect(adapter.resume('other-session', { ...request, commandId: 'two' })).rejects.toThrow('unmanaged_or_active_session');
  } finally { await adapter.close(); }
});
