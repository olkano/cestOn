import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertTestRoot } from '../packages/test-support/src/index.js';
import { parseConfig } from '../packages/contracts/src/config.js';
export function fixtureConfig(root: string) {
  assertTestRoot(root); mkdirSync(join(root, 'project'), { recursive: true }); mkdirSync(join(root, 'state'), { recursive: true });
  const config = parseConfig({ projects: [{ id: randomUUID(), displayName: 'Synthetic workspace', root: join(root, 'project'), kind: 'documents', providerId: 'fixture', operations: ['read', 'edit', 'test'], recipes: [{ id: 'artifact-check', executable: 'fixture:assert-artifact', args: ['result.txt'], operation: 'test' }] }], providers: [{ id: 'fixture', kind: 'fixture', executable: '', version: '1', profile: 'constrained' }] }, { testMode: true });
  writeFileSync(join(root, 'state', 'config.json'), JSON.stringify(config), { flag: 'wx' });
  return config;
}
