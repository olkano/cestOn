import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertTestRoot } from '../packages/test-support/src/index.js';
import { parseConfig } from '../packages/contracts/src/config.js';
export function fixtureConfig(root: string) {
  assertTestRoot(root); mkdirSync(join(root, 'project'), { recursive: true }); mkdirSync(join(root, 'project-two')); mkdirSync(join(root, 'provider-home')); mkdirSync(join(root, 'state'), { recursive: true });
  const config = parseConfig({ projects: [{ id: randomUUID(), displayName: 'Synthetic workspace', root: join(root, 'project'), kind: 'documents', providerId: 'fixture', operations: ['read', 'edit', 'test', 'external.write'], recipes: [{ id: 'artifact-check', executable: 'fixture:assert-artifact', args: ['result.txt'], operation: 'test' }] }, { id: randomUUID(), displayName: 'Synthetic second workspace', root: join(root, 'project-two'), kind: 'documents', providerId: 'fixture', operations: ['read', 'edit', 'test'], recipes: [{ id: 'artifact-check', executable: 'fixture:assert-artifact', args: ['result.txt'], operation: 'test' }] }], providers: [{ id: 'fixture', kind: 'fixture', executable: '', version: '1', home: join(root, 'provider-home'), profile: 'constrained' }] }, { testMode: true });
  writeFileSync(join(root, 'provider-home/unowned.jsonl'), JSON.stringify({ type: 'session_meta', payload: { id: 'synthetic-unowned-session', cwd: join(root, 'project'), title: 'Synthetic unowned brief' } }) + '\n' + JSON.stringify({ text: 'A synthetic read-only history excerpt.' }) + '\n');
  config.voice.enabled = true;
  writeFileSync(join(root, 'state', 'config.json'), JSON.stringify(config), { flag: 'wx' });
  return config;
}
