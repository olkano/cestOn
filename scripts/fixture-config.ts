import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertTestRoot } from '../packages/test-support/src/index.js';
import { parseConfig } from '../packages/contracts/src/config.js';
export function fixtureConfig(root: string) {
  assertTestRoot(root); mkdirSync(join(root, 'project'), { recursive: true }); mkdirSync(join(root, 'project-two')); mkdirSync(join(root, 'provider-home')); mkdirSync(join(root, 'state'), { recursive: true });
  const config = parseConfig({ projects: [{ id: randomUUID(), displayName: 'Synthetic workspace', root: join(root, 'project'), kind: 'documents', providerId: 'fixture', operations: ['read', 'edit', 'test', 'external.write'], recipes: [{ id: 'artifact-check', executable: 'fixture:assert-artifact', args: ['result.txt'], operation: 'test' }] }, { id: randomUUID(), displayName: 'Synthetic second workspace', root: join(root, 'project-two'), kind: 'documents', providerId: 'fixture', operations: ['read', 'edit', 'test'], recipes: [{ id: 'artifact-check', executable: 'fixture:assert-artifact', args: ['result.txt'], operation: 'test' }] }], providers: [{ id: 'fixture', kind: 'fixture', executable: '', version: '1', home: join(root, 'provider-home'), profile: 'constrained' }] }, { testMode: true });
  writeFileSync(join(root, 'provider-home/unowned.jsonl'), JSON.stringify({ type: 'session_meta', payload: { id: 'synthetic-unowned-session', cwd: join(root, 'project'), title: 'Synthetic unowned brief' } }) + '\n' + JSON.stringify({ text: 'A synthetic read-only history excerpt.' }) + '\n');
  config.voice.enabled = true;
  config.history.codexHome = join(root, 'history-fixture');
  mkdirSync(join(config.history.codexHome, 'sessions'), { recursive: true });
  const record = [
    { type: 'session_meta', payload: { id: 'fixture-chat', cwd: join(root, 'project'), title: 'Fixture conversation' } },
    { type: 'response_item', timestamp: '2026-11-17T12:00:00Z', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Check the synthetic report.' }] } },
    { type: 'response_item', timestamp: '2026-11-17T12:01:00Z', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'The synthetic report is ready.' }] } },
  ];
  writeFileSync(join(config.history.codexHome, 'sessions', 'fixture.jsonl'), record.map(row => JSON.stringify(row)).join('\n') + '\n');
  const fixture = join(root,'history-provider.mjs');
  copyFileSync('tests/integration/fixtures/history-provider.mjs',fixture);
  config.history.codexExecutable = fixture;
  config.history.claudeExecutable = fixture;
  config.history.claudeHome = join(root,'claude-history-fixture');
  const claudeProject = join(config.history.claudeHome,'projects','fixture');
  mkdirSync(claudeProject,{recursive:true});
  const codexId = '01234567-89ab-4def-8123-000000000001';
  const claudeId = '01234567-89ab-4def-8123-000000000002';
  const rows = (value: unknown[]) => value.map(row => JSON.stringify(row)).join('\n')+'\n';
  writeFileSync(join(config.history.codexHome,'session_index.jsonl'),rows([{id:codexId,thread_name:'Indexed Codex fixture title',updated_at:'2026-11-17T11:00:00Z'}]));
  writeFileSync(join(config.history.codexHome,'sessions','reply.jsonl'),rows([
    {type:'session_meta',payload:{id:codexId,cwd:join(root,'project')}},
    {type:'response_item',timestamp:'2026-11-16T11:00:00Z',payload:{type:'message',role:'user',content:'Saved Codex question.'}},
  ]));
  writeFileSync(join(claudeProject,claudeId+'.jsonl'),rows([
    {type:'user',sessionId:claudeId,cwd:join(root,'project-two'),timestamp:'2026-11-16T12:00:00Z',message:{content:'Saved Claude question.'}},
    {type:'ai-title',sessionId:claudeId,aiTitle:'Claude fixture title'},
  ]));
  writeFileSync(join(root, 'state', 'config.json'), JSON.stringify(config), { flag: 'wx' });
  return config;
}
