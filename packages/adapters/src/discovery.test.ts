import { it, expect } from 'vitest';
import { mkdirSync, writeFileSync, symlinkSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createTestRoot, cleanupTestRoot } from '../../test-support/src/index.js';
import { SessionDiscovery } from './discovery.js';

it('T08 discovery is bounded, exact, observe-only and never follows provider-home links', () => {
  const t = createTestRoot(); const outside = createTestRoot(); const projectId = randomUUID();
  try {
    const home = join(t.root, 'home'); const project = join(t.root, 'project'); mkdirSync(home); mkdirSync(project);
    const text = JSON.stringify({ type: 'session_meta', payload: { id: 'exact-id', cwd: project } }) + '\n';
    writeFileSync(join(home, 'one.jsonl'), text); writeFileSync(join(home, 'bad.jsonl'), '{broken');
    symlinkSync(outside.root, join(home, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    const discovery = new SessionDiscovery('codex', home, [{ id: projectId, root: project }]);
    try {
      let result = discovery.scan(); const all = [...result.sessions];
      while (result.cursor) { result = discovery.scan(result.cursor); all.push(...result.sessions); }
      expect(all).toHaveLength(1); expect(all[0]).toMatchObject({ providerSessionId: 'exact-id', projectId, ownership: 'observe_only', state: 'unknown' });
      expect(JSON.stringify(all)).not.toContain(home); expect(readFileSync(join(home, 'one.jsonl'), 'utf8')).toBe(text);
      expect(() => discovery.history('not-a-registered-session')).toThrow();
      expect(discovery.history(all[0]!.id).text).toContain('session_meta');
    } finally { discovery.close(); }
  } finally { cleanupTestRoot(t.root, t.runId); cleanupTestRoot(outside.root, outside.runId); }
});
