import { expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
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

it('uses Codex indexed names and Claude title records even after more messages arrive', async () => {
  const t = createTestRoot();
  try {
    const codexHome = join(t.root,'codex');
    const claudeHome = join(t.root,'claude');
    const codex = join(codexHome,'sessions');
    const claude = join(claudeHome,'projects','folder');
    const cwd = join(t.root,'project');
    for (const directory of [codex,claude]) mkdirSync(directory,{recursive:true});
    const jsonl = (rows: unknown[]) => rows.map(row => JSON.stringify(row)).join('\n')+'\n';
    writeFileSync(join(codexHome,'session_index.jsonl'),jsonl([
      {id:'synthetic-codex',thread_name:'Original name',updated_at:'2026-11-16T09:00:00Z'},
      {id:'synthetic-codex',thread_name:'Latest Codex title',updated_at:'2026-11-18T09:00:00Z'},
      {id:'synthetic-codex',thread_name:'Older copy',updated_at:'2026-11-17T09:00:00Z'},
      {id:'other',thread_name:'Unrelated name'},
    ]));
    writeFileSync(join(codex,'sample.jsonl'),jsonl([
      {type:'session_meta',payload:{id:'synthetic-codex',cwd}},
      {type:'response_item',timestamp:'2026-11-15T10:00:00Z',payload:{type:'message',role:'user',content:'Old prompt'}},
    ]));
    const db = new Database(join(codexHome,'state_5.sqlite'));
    db.exec("CREATE TABLE threads (id TEXT PRIMARY KEY,name TEXT,title TEXT,updated_at INTEGER)");
    db.prepare("INSERT INTO threads VALUES (?,?,?,?)").run('db-codex','Codex name from SQLite','Older generated title',1);
    db.close();
    writeFileSync(join(codex,'db-title.jsonl'),jsonl([
      {type:'session_meta',payload:{id:'db-codex',cwd}},
      {type:'response_item',timestamp:'2026-11-14T10:00:00Z',payload:{type:'message',role:'user',content:'Old prompt'}},
    ]));
    writeFileSync(join(claude,'sample.jsonl'),jsonl([
      {type:'user',sessionId:'synthetic-claude',cwd,timestamp:'2026-11-17T12:00:00Z',message:{content:'Synthetic Claude prompt'}},
      {type:'ai-title',sessionId:'synthetic-claude',aiTitle:'Claude title from early in the session'},
      {type:'thinking',body:'x'.repeat(140000)},
      {type:'custom-title',sessionId:'somewhere-else',customTitle:'Other chat'},
      {type:'summary',summary:'Recent compaction'},
      {type:'assistant',sessionId:'synthetic-claude',cwd,timestamp:'2026-11-17T13:00:00Z',message:{content:'Synthetic response'}},
    ]));
    const history = new LocalHistory({codexHome,claudeHome},t.root);
    const page = await history.list('',undefined,0);
    expect(page.conversations.map(row => row.title)).toEqual(['Claude title from early in the session','Latest Codex title','Codex name from SQLite']);
    expect((await history.list('latest codex title',undefined,0)).conversations).toHaveLength(1);
    expect(JSON.stringify(page)).not.toContain('synthetic-codex');
  } finally { cleanupTestRoot(t.root,t.runId); }
});
