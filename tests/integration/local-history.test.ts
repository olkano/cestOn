import { expect, it } from 'vitest';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
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
    expect(await reader.read(id)).toMatchObject({ messages: [{ role: 'user', text: 'Read the report.' }], older: null });
    const different = { ...codex[0]!, payload: { id: 'other', cwd } };
    writeFileSync(join(codexHome, 'sessions', 'fixture.jsonl'), jsonl([different]));
    await expect(reader.read(id)).rejects.toThrow('conversation_not_available');
    expect(() => new LocalHistory({ codexHome: join(t.root, '..', 'outside') }, t.root)).toThrow('history_root_denied');
  } finally { cleanupTestRoot(t.root, t.runId); }
});

it('observes exact saved turn boundaries and keeps stable positions through live writes', async () => {
  const t = createTestRoot();
  try {
    const home = join(t.root, 'codex');
    const sessions = join(home, 'sessions');
    mkdirSync(sessions, { recursive: true });
    const folder = join(t.root, 'project');
    const file = join(sessions, 'turn.jsonl');
    const now = Date.now();
    const at = (seconds: number) => new Date(now + seconds * 1000).toISOString();
    const header = (id: string, title: string) => ({ type: 'session_meta', payload: { id, cwd: folder, title } });
    const lifecycle = (type: string, seconds: number, turnId: string) => ({
      type: 'event_msg', timestamp: at(seconds), payload: { type, turn_id: turnId },
    });
    const message = (text: string, seconds: number) => ({
      type: 'response_item', timestamp: at(seconds), payload: { type: 'message', role: 'assistant', content: text },
    });
    const rows = (...records: unknown[]) => records.map(record => JSON.stringify(record) + '\n').join('');
    writeFileSync(file, rows(header('active-codex', 'Current thread'), lifecycle('task_complete', -100, 'prior'), lifecycle('task_started', -10, 'current'), message('First progress', -9)));
    writeFileSync(join(sessions, 'old.jsonl'), rows(header('old-codex', 'Older topic'), lifecycle('task_started', -400, 'older'), message('Last older message', -390)));
    const history = new LocalHistory({ codexHome: home }, t.root);
    const initial = await history.list('', undefined, 0);
    const [current, older] = initial.conversations;
    expect(current).toMatchObject({ title: 'Current thread', status: 'likely_working', endedAt: at(-100) });
    expect(older).toMatchObject({ title: 'Older topic', status: 'unknown' });
    const first = await history.read(current!.id);
    expect(first.messages[0]).toMatchObject({ position: expect.any(Number), text: 'First progress' });

    const partial = JSON.stringify(message('Second progress', -8));
    appendFileSync(file, partial.slice(0,-1));
    expect((await history.read(current!.id)).messages).toHaveLength(1);
    appendFileSync(file, partial.slice(-1) + '\n' + rows(lifecycle('task_complete', -7, 'prior')));
    expect((await history.read(current!.id)).conversation.status).toBe('likely_working');
    appendFileSync(file, rows(lifecycle('task_complete', -6, 'current')));
    const complete = await history.read(current!.id);
    expect(complete.conversation).toMatchObject({ status: 'idle', endedAt: at(-6) });
    expect(complete.messages).toEqual([first.messages[0], { position: expect.any(Number), role: 'assistant', text: 'Second progress', recordedAt: at(-8) }]);
    const filtered = await history.list('Older topic', undefined, 0);
    expect(filtered.folders[0]).toMatchObject({ activityAt: at(-6), count: 1 });
    appendFileSync(file, rows(lifecycle('task_started', -5, 'next'), lifecycle('turn_aborted', -4, 'next')));
    expect((await history.read(current!.id)).conversation).toMatchObject({ status:'idle', endedAt:at(-4) });
    appendFileSync(file,JSON.stringify(message('Complete record without a final newline', -3)));
    expect((await history.read(current!.id)).messages.at(-1)?.text).toBe('Complete record without a final newline');
  } finally { cleanupTestRoot(t.root, t.runId); }
});

it('uses Claude turn evidence and ignores another session or a sidechain', async () => {
  const t = createTestRoot();
  try {
    const home = join(t.root,'claude');
    const directory = join(home,'projects','folder');
    mkdirSync(directory,{recursive:true});
    const sessionId = '01234567-89ab-4def-8123-000000000002';
    const cwd = join(t.root,'project');
    const timestamp = new Date().toISOString();
    const file = join(directory,'fixture.jsonl');
    const assistant = (id: string, stop_reason: string, text: string, isSidechain = false) => ({
      type:'assistant', sessionId:id, cwd, isSidechain, timestamp, message:{ stop_reason, content:[{ type:'text', text }] },
    });
    const rows = (...records: unknown[]) => records.map(record => JSON.stringify(record) + '\n').join('');
    writeFileSync(file, rows(
      { type:'user', sessionId, cwd, timestamp, message:{content:'Start this task'} },
      assistant(sessionId,'tool_use','Visible progress'),
      assistant('unrelated','end_turn','Other chat'),
      assistant(sessionId,'end_turn','Sidechain chat',true),
    ));
    const history = new LocalHistory({ claudeHome:home }, t.root);
    const id = (await history.list('',undefined,0)).conversations[0]!.id;
    const active = await history.read(id);
    expect(active.conversation).toMatchObject({ status:'likely_working', endedAt:null });
    expect(active.messages.map(message=>message.text)).toEqual(['Start this task','Visible progress']);
    appendFileSync(file,rows(assistant(sessionId,'end_turn','Visible final')));
    expect((await history.read(id)).conversation).toMatchObject({ status:'idle',endedAt:timestamp });
  } finally { cleanupTestRoot(t.root,t.runId); }
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
