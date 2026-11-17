// Browser verification only. Does not inspect provider homes.
// node design/check-daily-work.mjs <private-html>
import { chromium, expect } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const target = resolve(process.argv[2] || 'design/cestOn-session-first.html');
const out = resolve('artifacts', 'daily-work-browser-' + Date.now());
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const errors = [], requests = [];
try {
 const context = await browser.newContext();
 const page = await context.newPage();
 page.on('pageerror', e => errors.push(e.message));
 page.on('request', r => { if (!/^(file|data):/.test(r.url())) requests.push(r.url()); });
 const url = pathToFileURL(target).href;
 for (const width of [1440, 390, 320]) for (const colorScheme of ['light', 'dark']) {
  await page.setViewportSize({ width, height: 950 }); await page.emulateMedia({ colorScheme }); await page.goto(url);
  await expect(page.locator('#projects .item').first()).toBeVisible();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Overflow '+width+' '+colorScheme);
  await page.screenshot({ path: join(out, width+'-'+colorScheme+'.png'), fullPage: true });
 }
 await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto(url);
 const data = await page.locator('#discovery-data').textContent().then(JSON.parse);
 const ordered = [...data.projects].sort((a,b) => b.last-a.last);
 assert.deepEqual(await page.locator('[data-project]').evaluateAll(nodes => nodes.map(n=>n.dataset.project)), ordered.map(p=>p.id));
 for (const p of ordered) {
  await page.locator('[data-project="'+p.id+'"]').click();
  await expect(page.locator('#conversation .path')).toHaveText(p.path);
  const sorted = [...p.sessions].sort((a,b)=>b.last-a.last);
  assert.deepEqual(await page.locator('[data-session]').evaluateAll(nodes=>nodes.map(n=>n.dataset.session)), sorted.map(s=>s.id));
  for (const provider of ['Codex','Claude']) {
   await page.locator('#provider').selectOption(provider);
   await expect(page.locator('[data-session]')).toHaveCount(sorted.filter(s=>s.provider===provider).length);
  }
 }
 await page.locator('#search').fill('no-such-folder-xyz');
 await expect(page.locator('#projects')).toContainText('No matching folder');
 await page.locator('#search').fill('');
 await page.locator('[data-project]').first().click();
 const before = await page.locator('[data-project]').evaluateAll(nodes=>nodes.map(n=>n.dataset.project));
 await page.locator('[data-project]').last().click();
 assert.deepEqual(await page.locator('[data-project]').evaluateAll(nodes=>nodes.map(n=>n.dataset.project)), before);
 await page.locator('#try-demo').focus(); await page.keyboard.press('Enter');
 await expect(page.locator('#reply-demo')).toBeVisible();
 await expect(page.locator('#close-demo')).toBeFocused();
 await page.locator('#reply').fill('<img src=x onerror=alert(1)>');
 await page.locator('#send').click();
 await expect(page.locator('#demo-messages img')).toHaveCount(0);
 await expect(page.locator('#demo-feedback')).toContainText('No prompt was sent');
 for (const mode of ['unavailable','offline']) {
  await page.locator('#connection').selectOption(mode);
  await expect(page.locator('#send')).toBeDisabled(); await expect(page.locator('#reply')).toBeDisabled();
 }
 await page.locator('#connection').selectOption('ready'); await expect(page.locator('#send')).toBeEnabled();
 await page.screenshot({ path: join(out,'reply-example.png') });
 await page.keyboard.press('Escape'); await expect(page.locator('#reply-demo')).not.toBeVisible();
 await expect(page.locator('#try-demo')).toBeFocused();
 await page.locator('#theme').click(); assert(['dark','light'].includes(await page.locator('html').getAttribute('data-theme')));
 await page.setViewportSize({ width:390,height:844 }); await page.goto(url);
 await expect(page.locator('#folders-pane')).toBeVisible(); await expect(page.locator('#sessions-pane')).not.toBeVisible();
 await page.locator('[data-project]').first().click();
 await expect(page.locator('#sessions-pane')).toBeVisible(); await expect(page.locator('#folders-pane')).not.toBeVisible();
 await page.screenshot({path:join(out,'phone-conversations.png')});
 await page.locator('[data-session]').first().click();
 await expect(page.locator('#conversation-pane')).toBeVisible(); await expect(page.locator('#sessions-pane')).not.toBeVisible();
 await page.screenshot({path:join(out,'phone-conversation.png')});
 await page.locator('#back-sessions').click(); await page.locator('#back-folders').click(); await expect(page.locator('#folders-pane')).toBeVisible();
 await context.setOffline(true); await page.reload(); await expect(page.locator('[data-project]').first()).toBeVisible(); await context.setOffline(false);
 for(const href of await page.locator('a[href]').evaluateAll(nodes=>nodes.map(n=>n.href))) if(href.startsWith('file:')) assert(existsSync(fileURLToPath(href)),'Broken link '+href);
 await page.goto(pathToFileURL(resolve('design/cestOn-session-first.html')).href);
 await expect(page.locator('#snapshot-note')).toContainText('Shareable layout example');
 await expect(page.locator('[data-project]')).toHaveCount(2);
 const html=readFileSync(target,'utf8');
 const malicious={private:false,capturedAt:new Date().toISOString(),coverage:{},projects:[{id:'safe',name:'<img src=x onerror=alert(1)>',path:'<script>bad</script>',kind:'Example',last:1,sessions:[{id:'s1',title:'<b>text</b>',provider:'Codex',last:1,timeSource:'Example'}]}]};
 const marker=/<script id="discovery-data" type="application\/json">[\s\S]*?<\/script>/;
 const synthetic=join(out,'escaped-fixture.html');
 writeFileSync(synthetic,html.replace(marker,()=>'<script id="discovery-data" type="application/json">'+JSON.stringify(malicious).replaceAll('<','\\u003c')+'</script>'));
 await page.goto(pathToFileURL(synthetic).href); await expect(page.locator('#projects img')).toHaveCount(0); await expect(page.locator('#projects')).toContainText('<img');
 assert.deepEqual(errors,[]); assert.deepEqual(requests,[]);
 writeFileSync(join(out,'result.json'),JSON.stringify({status:'passed',target,projects:ordered.length,sessions:ordered.reduce((n,p)=>n+p.sessions.length,0),viewports:[1440,390,320],themes:['light','dark'],checks:['all folder counts and session ordering','provider filtering','search and empty results','stable order after selection','phone navigation and back','keyboard dialog and Escape','reply gating','escaped display input','offline static reload','local links','no external requests'],errors,requests},null,2));
 console.log(JSON.stringify({status:'passed',out,projects:ordered.length,sessions:ordered.reduce((n,p)=>n+p.sessions.length,0)}));
} finally { await browser.close(); }
