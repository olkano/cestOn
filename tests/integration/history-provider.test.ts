import { it, expect } from 'vitest';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createTestRoot, cleanupTestRoot } from '../../packages/test-support/src/index.js';
import { HistoryProvider } from '../../apps/broker/src/history-provider.js';

const id = '01234567-89ab-4def-8123-000000000002';
type Provider = 'Claude' | 'Codex';

// A synthetic provider home with a saved chat whose latest turn used a known model, effort and permissions.
function setup(t: { root: string }, provider: Provider) {
  const fixture = join(t.root, 'provider.mjs');
  copyFileSync(resolve('tests/integration/fixtures/history-provider.mjs'), fixture);
  const home = join(t.root, 'home');
  const cwd = join(t.root, 'project');
  mkdirSync(home); mkdirSync(cwd);
  const file = join(home, 'chat.jsonl');
  writeFileSync(file, (provider === 'Codex'
    ? [{ type: 'turn_context', payload: { model: 'gpt-6.2-sol', effort: 'high', approval_policy: 'never', sandbox_policy: { type: 'danger-full-access' } } }]
    : [{ type: 'user', permissionMode: 'bypassPermissions', message: {} }, { type: 'assistant', requestedModel: 'claude-opus-5-5', effort: 'xhigh', message: { model: 'claude-opus-5-5' } }]
  ).map(row => JSON.stringify(row)).join('\n') + '\n');
  const bridge = new HistoryProvider(provider === 'Codex' ? { codexExecutable: fixture, codexHome: home } : { claudeExecutable: fixture, claudeHome: home }, t.root,
    { logonEnvironment: async () => ({ ...process.env, CESTON_LOGON_MARKER: 'owner logon' }) });
  const target = { provider, home, cwd, nativeId: id, file };
  const requests = () => readFileSync(join(home, 'requests.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line) as { args: string[]; logonMarker: string | null });
  return { home, bridge, target, requests };
}

for (const provider of ['Claude', 'Codex'] as const) {
  it(`continues a ${provider} chat with its own model and permissions and stops a start in another chat before it answers`, async () => {
    const t = createTestRoot();
    try {
      const { home, bridge, target, requests } = setup(t, provider);
      const send = await bridge.prepare(target);
      await expect(send('Continue the synthetic chat', AbortSignal.timeout(20000))).resolves.toBe(`${provider} continued the selected fixture.`);
      const [first] = requests();
      expect(first!.args).toEqual(expect.arrayContaining(provider === 'Codex'
        ? ['-m', 'gpt-6.2-sol', 'model_reasoning_effort="high"', 'sandbox_mode="danger-full-access"']
        : ['--model', 'claude-opus-5-5', '--effort', 'xhigh', '--permission-mode', 'bypassPermissions']));
      expect(first!.logonMarker).toBe('owner logon');

      writeFileSync(join(home, 'unsafe-start'), 'synthetic');
      const unsafe = await bridge.prepare(target);
      await expect(unsafe('This must not be answered', AbortSignal.timeout(20000))).rejects.toMatchObject({ code: 'history_reply_stopped' });
      await delay(2500);
      expect(existsSync(join(home, 'answered'))).toBe(false);
      expect(requests()).toHaveLength(2);
    } finally { cleanupTestRoot(t.root, t.runId); }
  });

  it(`reports a ${provider} reply that ended without an answer, keeps only the answer of a long turn, and stops a running reply with its commands`, async () => {
    const t = createTestRoot();
    try {
      const { home, bridge, target } = setup(t, provider);
      writeFileSync(join(home, 'fail-reply'), 'synthetic');
      await expect((await bridge.prepare(target))('Fail after starting', AbortSignal.timeout(20000))).rejects.toMatchObject({ code: 'history_reply_failed' });
      rmSync(join(home, 'fail-reply'));

      writeFileSync(join(home, 'large-output'), 'synthetic');
      await expect((await bridge.prepare(target))('Produce more than 8 MiB of tool output', AbortSignal.timeout(30000))).resolves.toBe(`${provider} continued the selected fixture.`);
      rmSync(join(home, 'large-output'));

      writeFileSync(join(home, 'slow-reply'), 'synthetic');
      const stop = new AbortController();
      const running = (await bridge.prepare(target))('Keep working', stop.signal);
      await expect.poll(() => existsSync(join(home, 'command.pid')), { timeout: 15000 }).toBe(true);
      const command = Number(readFileSync(join(home, 'command.pid'), 'utf8'));
      stop.abort();
      await expect(running).rejects.toMatchObject({ code: 'history_reply_interrupted' });
      const alive = () => { try { process.kill(command, 0); return true; } catch { return false; } };
      await expect.poll(alive, { timeout: 10000 }).toBe(false);
    } finally { cleanupTestRoot(t.root, t.runId); }
  }, 60000);
}

it('ends the idle VS Code panel that has a Claude chat open before replying, and waits when a terminal has it open', async () => {
  const t = createTestRoot();
  try {
    const { home, bridge, target, requests } = setup(t, 'Claude');
    const startedAt = '134398989960000000';
    const startedMs = Date.UTC(2026, 10, 23, 9, 16, 36);
    const panel = { pid: 4242, startedAt, name: 'claude.exe', parentName: 'Code.exe', commandLine: 'claude.exe --output-format stream-json --verbose --input-format stream-json' };
    const hold = (holder: typeof panel) => {
      writeFileSync(join(home, 'activity-fixture.json'), JSON.stringify([{ pid: holder.pid, startedAt: startedMs + 800, kind: 'interactive', sessionId: id, status: 'idle' }]));
      writeFileSync(join(home, 'process-fixture.json'), JSON.stringify({ [holder.pid]: holder }));
    };

    hold(panel);
    const send = await bridge.prepare(target);
    expect(send.endedEditorProcess).toMatchObject({ pid: 4242, startedAt });
    expect(readFileSync(join(home, 'ended.jsonl'), 'utf8')).toContain('"pid":4242');
    await expect(send('Reply after the panel let go', AbortSignal.timeout(20000))).resolves.toBe('Claude continued the selected fixture.');

    hold({ ...panel, pid: 77, parentName: 'pwsh.exe' });
    await expect(bridge.prepare(target)).rejects.toMatchObject({ code: 'history_session_open' });
    expect(readFileSync(join(home, 'ended.jsonl'), 'utf8').trim().split('\n')).toHaveLength(1);
    expect(requests()).toHaveLength(1);
  } finally { cleanupTestRoot(t.root, t.runId); }
});
