import { test, expect, devices } from '@playwright/test';
import { appendFileSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { localStore, pair } from './helpers.js';

const rows = (...values: unknown[]) => values.map(value => JSON.stringify(value) + '\n').join('');
const timestamp = (minutes: number) => new Date(Date.now() - minutes * 60000).toISOString();
const codexId = '01234567-89ab-4def-8123-000000000001';
const claudeId = '01234567-89ab-4def-8123-000000000002';

test('finds conversations by folder and keeps a Markdown transcript independently scrollable', async ({page}) => {
  const store = localStore();
  const root = store.dataRoot;
  store.close();
  const file = join(root,'history-fixture','sessions','rollout-2026-11-16T11-00-00-01234567-89ab-4def-8123-000000000001.jsonl');
  const old = readFileSync(file);
  const markdown = '## Verification summary\n\n**Done**\n\n- First check\n- Second check\n\n| Check | Result |\n| --- | --- |\n| Build | Passed |\n\n```text\nsynthetic output\n```\n\n[Report](https://example.com) [Invalid](invalid:ignored)\n\n![Private image](https://example.com/ignored.png)\n\n<aside>Raw HTML marker</aside>';
  const message = (text: string) => ({type:'response_item',timestamp:timestamp(0),payload:{type:'message',role:'assistant',content:text}});
  appendFileSync(file,rows(message(markdown),...Array.from({length:20},(_,index) => message('Scrollable message ' + index))));
  try {
    await page.setViewportSize({width:390,height:844});
    await pair(page);
    await page.getByRole('link',{name:'Chats'}).click();
    const folders = page.getByRole('combobox',{name:'Folder'});
    await expect(folders).toHaveValue('');
    const [folder] = await folders.selectOption({label:(await folders.getByRole('option',{name:/^project \(/}).textContent())!});
    const search = page.getByRole('searchbox',{name:'Search chats'});
    await search.fill('No chat matches this synthetic query');
    await expect(page.getByText('No matching conversations.')).toBeVisible();
    await expect(folders).toHaveValue(folder!);
    await search.fill('Indexed Codex');
    await page.getByRole('button',{name:/Indexed Codex fixture title/}).click();
    const log = page.getByRole('log',{name:'Conversation messages'});
    await expect(log.getByText('Scrollable message 19')).toBeVisible();
    await expect.poll(() => log.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(24);
    const before = await page.evaluate(() => window.scrollY);
    await log.evaluate(element => { element.scrollTop = 0; });
    await expect(page.getByRole('button',{name:'Jump to latest'})).toBeVisible();
    expect(await page.evaluate(() => window.scrollY)).toBe(before);
    await expect(log.getByRole('heading',{name:'Verification summary'})).toHaveCount(1);
    await expect(log.getByRole('listitem')).toHaveCount(2);
    await expect(log.getByRole('cell',{name:'Passed'})).toHaveCount(1);
    await expect(log.locator('pre code')).toHaveText('synthetic output\n');
    await expect(log.getByRole('link',{name:'Report'})).toHaveAttribute('href','https://example.com');
    await expect(log.getByRole('link',{name:'Invalid'})).toHaveCount(0);
    await expect(log.getByRole('img')).toHaveCount(0);
    await expect(log.getByText('Raw HTML marker')).toHaveCount(0);
    await expect(page.getByRole('textbox',{name:'Your reply'})).toBeVisible();
    appendFileSync(file,rows(message('Arrived while reading earlier messages')));
    await expect(log.getByText('Arrived while reading earlier messages')).toHaveCount(1);
    await expect.poll(() => log.evaluate(element => element.scrollTop)).toBe(0);
    await page.getByRole('button',{name:'Jump to latest'}).click();
    await expect(log).toBeFocused();
  } finally {writeFileSync(file,old);}
});

test('reaches the reply box with thumb swipes on a portrait phone, even over the transcript', async ({browser},info) => {
  const store = localStore();
  const root = store.dataRoot;
  store.close();
  const file = join(root,'history-fixture','sessions','rollout-2026-11-16T11-00-00-01234567-89ab-4def-8123-000000000001.jsonl');
  const old = readFileSync(file);
  const message = (text: string) => ({type:'response_item',timestamp:timestamp(0),payload:{type:'message',role:'assistant',content:text}});
  appendFileSync(file,rows(...Array.from({length:30},(_,index) => message('Long phone message ' + index + ' with enough words to wrap across several lines on a narrow screen.'))));
  const context = await browser.newContext({...devices['Pixel 7']});
  const page = await context.newPage();
  try {
    await pair(page);
    await page.getByRole('link',{name:'Chats'}).click();
    await page.getByRole('searchbox',{name:'Search chats'}).fill('Indexed Codex');
    await page.getByRole('button',{name:/Indexed Codex fixture title/}).click();
    const log = page.getByRole('log',{name:'Conversation messages'});
    await expect(log.getByText('Long phone message 29')).toBeVisible();
    await expect.poll(() => log.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(24);
    const touch = await context.newCDPSession(page);
    const swipeUp = async (y: number) => {
      const x = await page.evaluate(() => Math.round(innerWidth / 2));
      await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
      for (let moved = 10; moved <= 120; moved += 10) await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y - moved}]});
      await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      await page.waitForTimeout(250);
    };
    // The thumb rests on the transcript, which already shows its newest message, while the page can still scroll.
    await page.evaluate(() => scrollTo(0,0));
    const before = await page.evaluate(() => scrollY);
    expect(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBeGreaterThan(before + 100);
    const start = await log.evaluate(element => Math.round(Math.min(element.getBoundingClientRect().top + 60,document.querySelector('.workspace nav')!.getBoundingClientRect().top - 20)));
    expect(await page.evaluate(([x,y]) => Boolean(document.elementFromPoint(x!,y!)?.closest('.chat-transcript')),[200,start])).toBe(true);
    await swipeUp(start);
    expect(await page.evaluate(() => scrollY)).toBeGreaterThan(before);
    const reply = page.getByRole('textbox',{name:'Your reply'});
    const reachable = () => page.evaluate(() => {
      const box = document.querySelector('.chat-composer textarea')!.getBoundingClientRect();
      return box.top >= 0 && box.bottom <= document.querySelector('.workspace nav')!.getBoundingClientRect().top;
    });
    for (let swipe = 0; swipe < 4 && !(await reachable()); swipe++) await swipeUp(start);
    expect(await reachable()).toBe(true);
    await page.screenshot({path:info.outputPath('chat-reply-reachable-phone.png')});
    // Playwright checks that the box itself receives the press, not the transcript or the bottom bar.
    await reply.click();
    await page.keyboard.type('Typed after swiping');
    await expect(reply).toHaveValue('Typed after swiping');
  } finally {
    await context.close();
    writeFileSync(file,old);
  }
});

test('shows a saved Codex turn live and retains earlier pages across changes and reconnect', async ({page,context},info) => {
  test.setTimeout(60000);
  const store = localStore();
  const root = store.dataRoot;
  store.close();
  const file = join(root,'history-fixture','sessions','rollout-2026-11-16T11-00-00-01234567-89ab-4def-8123-000000000001.jsonl');
  const old = readFileSync(file);
  const earlier = 'Earlier words in the selected thread.';
  const comment = (text: string, time: string, role = 'assistant') =>
    ({type:'response_item',timestamp:time,payload:{type:'message',role,content:text}});
  const event = (type: string, time: string) =>
    ({type:'event_msg',timestamp:time,payload:{type,turn_id:'activity-browser-test'}});
  writeFileSync(file,rows(
    {type:'session_meta',payload:{id:codexId,cwd:join(root,'project')}},
    comment(earlier,timestamp(8),'user'),
    ...Array.from({length:4},()=>({type:'reasoning',text:'x'.repeat(50000)})),
    // The chat opens with about 30 recent messages, so the earlier words are one page back.
    ...Array.from({length:31},(_,index)=>comment(`Recent step ${index + 1}.`,timestamp(4))),
    event('task_started',timestamp(3)),
    comment('First saved progress.',timestamp(2)),
  ));
  try {
    await page.setViewportSize({width:1440,height:900});
    await pair(page);
    await page.getByLabel('Appearance').selectOption('light');
    await page.getByRole('link',{name:'Chats'}).click();
    const listRow = page.getByRole('button',{name:/Indexed Codex fixture title/});
    await expect(listRow.getByText('Likely working',{exact:true})).toBeVisible({timeout:12000});
    await expect(listRow.locator('time')).toHaveAttribute('data-age','recent');
    const folder = page.getByRole('combobox',{name:'Folder'});
    await expect(folder.getByRole('option',{name:/^project \(.*[23] min ago/})).toHaveCount(1);
    await listRow.focus();
    await page.keyboard.press('Enter');
    const conversation = page.getByRole('log',{name:'Conversation messages'});
    await expect(conversation.getByText('First saved progress.')).toBeVisible();
    await expect(page.locator('.chat-thread-meta')).toContainText('Likely working');
    await page.getByRole('button',{name:'Earlier messages'}).click();
    await expect(conversation.getByText(earlier)).toBeVisible();
    await page.screenshot({path:info.outputPath('chat-activity-light-desktop.png')});
    await page.getByLabel('Appearance').selectOption('dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
    await page.screenshot({path:info.outputPath('chat-activity-dark-desktop.png')});

    appendFileSync(file,rows(
      comment('Progress before a burst of tool output.',timestamp(1)),
      ...Array.from({length:4},()=>({type:'reasoning',text:'x'.repeat(50000)})),
      comment('Second saved progress.',timestamp(1)),
    ));
    await expect(conversation.getByText('Second saved progress.')).toBeVisible({timeout:8000});
    await expect(conversation.getByText('Progress before a burst of tool output.')).toBeVisible();
    await expect(conversation.getByText(earlier)).toBeVisible();
    await context.setOffline(true);
    await page.evaluate(()=>window.dispatchEvent(new Event('offline')));
    await expect(conversation.getByText('First saved progress.')).toBeVisible();
    const ended = timestamp(0);
    appendFileSync(file,rows(comment('Saved final answer.',ended),event('task_complete',ended)));
    await context.setOffline(false);
    await page.evaluate(()=>window.dispatchEvent(new Event('online')));
    await expect(conversation.getByText('Saved final answer.')).toBeVisible({timeout:12000});
    await expect(conversation.getByText('Second saved progress.')).toHaveCount(1);
    await expect(conversation.getByText(earlier)).toHaveCount(1);
    await expect(page.locator('.chat-thread-meta time')).toHaveAttribute('datetime',ended);
    await expect(page.locator('.chat-thread-meta time')).toHaveText('Finished Just now');
    await expect(listRow.getByText('Likely working',{exact:true})).toHaveCount(0);
  } finally {
    await context.setOffline(false);
    writeFileSync(file,old);
  }
});

test('shows Claude working and waiting separately from an idle open session on a phone layout', async ({page},info) => {
  test.setTimeout(60000);
  const store = localStore();
  const root = store.dataRoot;
  store.close();
  const home = join(root,'claude-history-fixture');
  const file = join(home,'projects','fixture',claudeId+'.jsonl');
  const roster = join(home,'activity-fixture.json');
  const old = readFileSync(file);
  const at = timestamp(8 * 24 * 60);
  const cwd = join(root,'project-two');
  const assistant = (text: string, stop_reason: string, time: string) =>
    ({type:'assistant',sessionId:claudeId,cwd,timestamp:time,message:{stop_reason,content:[{type:'text',text}]}});
  const state = (status: string) => writeFileSync(roster,JSON.stringify([{sessionId:claudeId,status}]));
  writeFileSync(file,rows(
    {type:'user',sessionId:claudeId,cwd,timestamp:at,message:{content:'An old synthetic topic.'}},
    {type:'ai-title',sessionId:claudeId,aiTitle:'Claude fixture title'},
    assistant('Earlier completed response.','end_turn',at),
  ));
  state('idle');
  try {
    await page.setViewportSize({width:390,height:844});
    await pair(page);
    await page.getByLabel('Appearance').selectOption('dark');
    await page.getByRole('link',{name:'Chats'}).click();
    const row = page.getByRole('button',{name:/Claude fixture title/});
    await expect(row).toHaveAttribute('data-age','week');
    await expect(row.locator('time')).toHaveText('Finished 8 days ago');
    await expect(row.getByText('Working',{exact:true})).toHaveCount(0);
    state('busy');
    await expect(row.getByText('Working',{exact:true})).toBeVisible({timeout:12000});
    await row.click();
    const meta = page.locator('.chat-thread-meta');
    await expect(meta.getByText('Working',{exact:true})).toBeVisible();
    await page.screenshot({path:info.outputPath('chat-activity-dark-phone.png')});
    await page.getByLabel('Appearance').selectOption('light');
    await expect(page.locator('html')).toHaveAttribute('data-theme','light');
    await page.screenshot({path:info.outputPath('chat-activity-light-phone.png')});
    appendFileSync(file,rows(assistant('Claude saved a progress update.','tool_use',timestamp(0))));
    await expect(page.getByRole('log',{name:'Conversation messages'}).getByText('Claude saved a progress update.')).toBeVisible({timeout:8000});
    state('waiting');
    await expect(meta.getByText('Needs input',{exact:true})).toBeVisible({timeout:12000});
    state('idle');
    appendFileSync(file,rows(assistant('Claude finished the turn.','end_turn',timestamp(0))));
    await expect(meta.getByText('Needs input',{exact:true})).toHaveCount(0,{timeout:12000});
    await expect(meta.locator('time')).toHaveText('Finished Just now');
    await expect(page.getByRole('log',{name:'Conversation messages'}).getByText('Claude finished the turn.')).toBeVisible();
  } finally {
    unlinkSync(roster);
    writeFileSync(file,old);
  }
});
