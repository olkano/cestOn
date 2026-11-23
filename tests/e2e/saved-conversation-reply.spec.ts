import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { readFileSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { pair, localStore } from './helpers.js';

test('restores titles and continues saved Codex and Claude conversations from a phone layout', async ({ page }) => {
  test.setTimeout(75000);
  await pair(page);
  await page.setViewportSize({ width:390,height:844 });
  await page.getByLabel('Appearance').selectOption('dark');
  await page.getByRole('link',{name:'Chats'}).click();
  const openChat = async (title: string) => {
    await page.getByRole('searchbox',{name:'Search chats'}).fill(title);
    await page.getByRole('button',{name:new RegExp(title)}).click({timeout:12000});
  };
  for (const [provider,title,home,id] of [
    ['Codex','Indexed Codex fixture title','history-fixture','01234567-89ab-4def-8123-000000000001'],
    ['Claude','Claude fixture title','claude-history-fixture','01234567-89ab-4def-8123-000000000002'],
  ] as const) {
    await openChat(title);
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
  }
  const store = localStore();
  const root = store.dataRoot;
  store.close();
  for (const [provider,title,home,id] of [
    ['Codex','Indexed Codex fixture title','history-fixture','01234567-89ab-4def-8123-000000000001'],
    ['Claude','Claude fixture title','claude-history-fixture','01234567-89ab-4def-8123-000000000002'],
  ] as const) {
    const marker = join(root,home,'open');
    const requests = () => readFileSync(join(root,home,'requests.jsonl'),'utf8').trim().split('\n').map(line => JSON.parse(line));
    const send = async (text: string) => {
      await page.getByRole('textbox',{name:'Your reply'}).fill(text);
      await page.getByRole('button',{name:'Send',exact:true}).click();
      await expect(page.getByRole('status').filter({hasText:'Reply saved. Waiting for '+provider})).toBeVisible();
      expect(requests()).toHaveLength(1);
    };
    await openChat(title);
    writeFileSync(marker,'synthetic');
    try {
      await send('Cancel this waiting '+provider+' reply');
      await page.getByRole('button',{name:'Cancel queued reply'}).click();
      const text = 'Deliver once after '+provider+' releases the conversation';
      await send(text);
      await page.reload();
      await openChat(title);
      await expect(page.getByRole('status').filter({hasText:'Reply saved. Waiting for '+provider})).toBeVisible();
      unlinkSync(marker);
      await expect.poll(requests,{timeout:20000}).toMatchObject([{}, {id,text}]);
      await expect(page.getByRole('log').getByText(provider+' continued the selected fixture.',{exact:true})).toHaveCount(2);
    } finally {rmSync(marker,{force:true});}
  }
});
