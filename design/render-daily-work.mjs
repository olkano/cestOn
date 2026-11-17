// Render an existing private discovery snapshot without accessing provider homes.
// node design/render-daily-work.mjs <discovery.json>
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
export function renderSnapshot(data, output) {
  if (data.private !== true || !Array.isArray(data.projects)) throw new Error('Expected a private discovery snapshot.');
  const template = readFileSync(join(root, 'design', 'cestOn-session-first.html'), 'utf8');
  const marker = /<script id="discovery-data" type="application\/json">[\s\S]*?<\/script>/;
  if (!marker.test(template)) throw new Error('Discovery template marker is missing.');
  const json = JSON.stringify(data).replaceAll('<', '\\u003c').replaceAll('&', '\\u0026');
  const localLinks = html => html.replaceAll('href="../zz_Specifications/', 'href="../../zz_Specifications/');
  writeFileSync(join(output, 'cestOn-your-daily-work.html'), localLinks(template.replace(marker, () => '<script id="discovery-data" type="application/json">'+json+'</script>')));
  const guide = readFileSync(join(root, 'design', 'cestOn-how-it-works.html'), 'utf8');
  writeFileSync(join(output, 'cestOn-how-it-works.html'), localLinks(guide.replaceAll('href="cestOn-session-first.html"', 'href="cestOn-your-daily-work.html"')));
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (!process.argv[2]) throw new Error('Provide an existing discovery.json. This command does not scan your PC.');
  const data = JSON.parse(readFileSync(resolve(process.argv[2]), 'utf8'));
  mkdirSync(join(root, 'artifacts'), { recursive: true });
  const output = mkdtempSync(join(root, 'artifacts', 'daily-work-view-'));
  renderSnapshot(data, output);
  console.log(JSON.stringify({ output, capturedAt: data.capturedAt, projects: data.projects.length }));
}
