import { expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LocalHistory } from '../../apps/server/src/projects/history.js';
import { createTestRoot, cleanupTestRoot } from '../../packages/test-support/src/index.js';

it('groups both providers without project registration, sorts by message activity and reads only the selected thread', async () => {
  const t = createTestRoot();
  try {
    const codexHome = join(t.root, 'codex');
    const claudeHome = join(t.root, 'claude');
    mkdirSync(join(codexHome, 'sessions'), { recursive: true });
    mkdirSync(join(claudeHome, 'projects', 'folder'), { recursive: true });
    const cwd = join(t.root, 'existing-folder');
    const codex = [
      { type: 'session_meta', payload: { id: 'codex-native-id', cwd, title: 'Run report' } },
      { type: 'response_item', timestamp: '2026-11-15T12:00:00Z', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Read the report.' }] } },
      { type: 'response_item', timestamp: '2026-11-17T12:00:00Z', payload: { type: 'reasoning', summary: 'Private reasoning' } },
    ];
    const claude = [{ type: 'assistant', timestamp: '2026-11-16T12:00:00Z', sessionId: 'claude-native-id', cwd, message: { content: [{ type: 'text', text: 'Synthetic Claude reply.' }, { type: 'thinking', thinking: 'Private thinking' }] } }];
    const jsonl = (records: unknown[]) => records.map(record => JSON.stringify(record)).join('\n') + '\n';
    writeFileSync(join(codexHome, 'sessions', 'fixture.jsonl'), jsonl(codex));
    writeFileSync(join(claudeHome, 'projects', 'folder', 'fixture.jsonl'), jsonl(claude));
    const reader = new LocalHistory({ codexHome, claudeHome }, t.root);
    const page = await reader.list('', undefined, 0);
    expect(page.folders).toHaveLength(1);
    expect(page.folders[0]).toMatchObject({ name: 'existing-folder', count: 2 });
    expect(page.conversations.map(row => row.provider)).toEqual(['Claude', 'Codex']);
    expect(JSON.stringify(page)).not.toContain(t.root);
    expect(JSON.stringify(page)).not.toContain('native-id');
    const chosen = await reader.list('Run report', page.folders[0]!.id, 0);
    expect(chosen.conversations).toHaveLength(1);
    const id = chosen.conversations[0]!.id;
    expect(await reader.read(id)).toEqual({ messages: [{ role: 'user', text: 'Read the report.' }], older: null });
    const different = { ...codex[0]!, payload: { id: 'other', cwd } };
    writeFileSync(join(codexHome, 'sessions', 'fixture.jsonl'), jsonl([different]));
    await expect(reader.read(id)).rejects.toThrow('conversation_not_available');
    expect(() => new LocalHistory({ codexHome: join(t.root, '..', 'outside') }, t.root)).toThrow('history_root_denied');
  } finally { cleanupTestRoot(t.root, t.runId); }
});
