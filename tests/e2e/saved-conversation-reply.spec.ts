import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { pair, localStore } from './helpers.js';

test('restores titles and continues saved Codex and Claude conversations from a phone layout', async ({ page }) => {
  await pair(page);
  await page.setViewportSize({ width:390,height:844 });
  await page.getByLabel('Appearance').selectOption('dark');
  await page.getByRole('link',{name:'Chats'}).click();
  for (const [provider,title,home,id] of [
    ['Codex','Indexed Codex fixture title','history-fixture','01234567-89ab-4def-8123-000000000001'],
    ['Claude','Claude fixture title','claude-history-fixture','01234567-89ab-4def-8123-000000000002'],
  ] as const) {
    await page.getByRole('button',{name:new RegExp(title)}).click();
    await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
    const prompt = page.getByRole('textbox',{name:'Your reply'});
    await prompt.fill('Resume the selected '+provider+' test');
    await page.getByRole('button',{name:'Send',exact:true}).click();
    await expect(page.getByText(provider+' continued the selected fixture.',{exact:true})).toBeVisible();
    const store = localStore();
    try {
      const calls = readFileSync(join(store.dataRoot,home,'requests.jsonl'),'utf8').trim().split('\n');
      expect(calls).toHaveLength(1);
      expect(JSON.parse(calls[0]!)).toMatchObject({id,text:'Resume the selected '+provider+' test'});
    } finally {store.close();}
    await page.getByRole('button',{name:'Back to conversations'}).click();
  }
  const store = localStore();
  const marker = join(store.dataRoot,'claude-history-fixture','open');
  store.close();
  writeFileSync(marker,'synthetic');
  try {
    await page.getByRole('button',{name:/Claude fixture title/}).click();
    await page.getByRole('textbox',{name:'Your reply'}).fill('Busy sessions should stay under their current owner');
    await page.getByRole('button',{name:'Send',exact:true}).click();
    await expect(page.getByText('This conversation is open in the provider app.',{exact:false})).toBeVisible();
    expect(readFileSync(join(marker,'..','requests.jsonl'),'utf8').trim().split('\n')).toHaveLength(1);
  } finally {unlinkSync(marker);}
});
