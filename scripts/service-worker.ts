import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
export function generateServiceWorker() {
  const root = 'apps/web/dist'; const assets: string[] = [];
  function scan(dir: string, prefix: string) { for (const entry of readdirSync(dir, { withFileTypes: true })) { if (entry.isSymbolicLink()) throw new Error('Static assets cannot contain symlinks'); const path = `${prefix}/${entry.name}`; if (entry.isDirectory()) scan(join(dir, entry.name), path); else if (entry.isFile() && !['sw.js', 'release.json'].includes(entry.name)) assets.push(path); } }
  scan(root, ''); assets.sort(); const hash = createHash('sha256'); for (const path of assets) hash.update(path).update(readFileSync(join(root, path))); const version = hash.digest('hex');
  writeFileSync(join(root, 'sw.js'), readFileSync('apps/web/service-worker.js', 'utf8').replace('__VERSION__', version).replace('[]; // CESTON_ASSET_LIST', `${JSON.stringify(assets)};`));
  writeFileSync(join(root, 'release.json'), JSON.stringify({ protocol: 1, staticBundle: version }));
}
