import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { pair, localStore } from './helpers.js';

test('restores titles and continues saved Codex and Claude conversations from a phone layout', async ({ page }) => {
  test.setTimeout(150000);
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
  // An idle VS Code panel has the Claude chat open: cestOn ends that panel's process, so the panel resumes the chat
  // from the saved file instead of forking it, and then sends.
  const claudeHome = join(root,'claude-history-fixture');
  const roster = join(claudeHome,'activity-fixture.json');
  const processes = join(claudeHome,'process-fixture.json');
  const claudeEnded = join(claudeHome,'ended.jsonl');
  const claudeId = '01234567-89ab-4def-8123-000000000002';
  const panel = {pid:5151,startedAt:'134398989960000000',name:'claude.exe',parentName:'Code.exe',commandLine:'claude.exe --output-format stream-json --verbose --input-format stream-json'};
  writeFileSync(roster,JSON.stringify([{pid:panel.pid,startedAt:Date.UTC(2026,10,23,9,16,37),kind:'interactive',sessionId:claudeId,status:'idle'}]));
  writeFileSync(processes,JSON.stringify({[panel.pid]:panel}));
  try {
    const text = 'Continue the Claude chat that is open but idle';
    await openChat('Claude fixture title');
    await page.getByRole('textbox',{name:'Your reply'}).fill(text);
    await page.getByRole('button',{name:'Send',exact:true}).click();
    await expect.poll(() => readFileSync(join(claudeHome,'requests.jsonl'),'utf8').trim().split('\n').map(line => JSON.parse(line)),{timeout:20000})
      .toMatchObject([{}, {}, {id:claudeId,text}]);
    expect(readFileSync(claudeEnded,'utf8').trim().split('\n').map(line => JSON.parse(line))).toEqual([panel]);
    await expect(page.getByRole('log').getByText('Claude continued the selected fixture.',{exact:true})).toHaveCount(3);
    await expect(page.getByRole('status').filter({hasText:'Reply saved. Waiting for Claude'})).toHaveCount(0);
  } finally {for (const path of [roster,processes,claudeEnded]) rmSync(path,{force:true});}
  // A VS Code window's Codex process holds the chat: cestOn waits while it is mid-turn, then ends that process and sends.
  const codexHome = join(root,'history-fixture');
  const codexId = '01234567-89ab-4def-8123-000000000001';
  const transcript = join(codexHome,'sessions',`rollout-2026-11-16T11-00-00-${codexId}.jsonl`);
  const saved = readFileSync(transcript);
  const locks = join(codexHome,'thread-writer-locks');
  const holders = join(codexHome,'lock-fixture.json');
  const ended = join(codexHome,'ended.jsonl');
  const editor = {pid:4242,startedAt:'134000000000000000',name:'codex.exe',commandLine:'codex.exe -c features.x=true app-server --analytics-default-enabled',parentName:'Code.exe'};
  const turn = (type: string) => JSON.stringify({type:'event_msg',timestamp:new Date().toISOString(),payload:{type,turn_id:'pc-turn'}})+'\n';
  mkdirSync(locks,{recursive:true});
  writeFileSync(join(locks,codexId+'.lock'),'');
  writeFileSync(holders,JSON.stringify({[codexId]:[editor]}));
  writeFileSync(join(codexHome,'open'),'synthetic');
  appendFileSync(transcript,turn('task_started'));
  try {
    const text = 'Take over the Codex chat once the PC turn ends';
    await openChat('Indexed Codex fixture title');
    await page.getByRole('textbox',{name:'Your reply'}).fill(text);
    await page.getByRole('button',{name:'Send',exact:true}).click();
    await expect(page.getByRole('status').filter({hasText:'Reply saved. Waiting for Codex on your PC to finish'})).toBeVisible();
    expect(existsSync(ended)).toBe(false);
    appendFileSync(transcript,turn('task_complete'));
    await expect.poll(() => readFileSync(join(codexHome,'requests.jsonl'),'utf8').trim().split('\n').map(line => JSON.parse(line)),{timeout:30000})
      .toMatchObject([{}, {}, {id:codexId,text}]);
    expect(readFileSync(ended,'utf8').trim().split('\n').map(line => JSON.parse(line))).toEqual([editor]);
    await expect(page.getByRole('log').getByText('Codex continued the selected fixture.',{exact:true})).toHaveCount(3);
  } finally {
    writeFileSync(transcript,saved);
    for (const path of [locks,holders,ended,join(codexHome,'open')]) rmSync(path,{recursive:true,force:true});
  }
  // A provider that starts in another chat is stopped before it answers, and the page says why.
  const unsafe = join(claudeHome,'unsafe-start');
  writeFileSync(unsafe,'synthetic');
  try {
    await openChat('Claude fixture title');
    await page.getByRole('textbox',{name:'Your reply'}).fill('Stop this reply if it starts in another chat');
    await page.getByRole('button',{name:'Send',exact:true}).click();
    await expect(page.getByText('cestOn stopped this reply before Claude answered',{exact:false})).toBeVisible({timeout:20000});
    await page.waitForTimeout(2500);
    expect(existsSync(join(claudeHome,'answered'))).toBe(false);
    await expect(page.getByRole('log').getByText('Unsafe fixture answer.')).toHaveCount(0);
  } finally { rmSync(unsafe,{force:true}); rmSync(join(claudeHome,'answered'),{force:true}); }
  // A long reply can be stopped from the phone: the provider and the commands it started end. The text reaches the
  // provider exactly as typed, paths included.
  const slow = join(codexHome,'slow-reply');
  const commandPid = join(codexHome,'command.pid');
  writeFileSync(slow,'synthetic');
  try {
    const text = String.raw`Work on C:\Users\Public\Code\project until stopped`;
    await openChat('Indexed Codex fixture title');
    await expect(page.getByText('Use Work to request file changes.')).toHaveCount(0);
    await page.getByRole('textbox',{name:'Your reply'}).fill(text);
    await page.getByRole('button',{name:'Send',exact:true}).click();
    await expect.poll(() => existsSync(commandPid),{timeout:20000}).toBe(true);
    expect(JSON.parse(readFileSync(join(codexHome,'requests.jsonl'),'utf8').trim().split('\n').at(-1)!)).toMatchObject({id:codexId,text});
    await page.getByRole('button',{name:'Stop reply'}).click();
    await expect(page.getByText('This reply was stopped before Codex finished',{exact:false})).toBeVisible({timeout:20000});
    const command = Number(readFileSync(commandPid,'utf8'));
    await expect.poll(() => { try { process.kill(command,0); return true; } catch { return false; } },{timeout:10000}).toBe(false);
  } finally { rmSync(slow,{force:true}); rmSync(commandPid,{force:true}); }
  // A provider that ends without an answer is reported, and the chat takes the next reply.
  const fail = join(codexHome,'fail-reply');
  writeFileSync(fail,'synthetic');
  try {
    await page.getByRole('textbox',{name:'Your reply'}).fill('Fail after starting');
    await page.getByRole('button',{name:'Send',exact:true}).click();
    await expect(page.getByText('Codex ended without a reply cestOn could read',{exact:false})).toBeVisible({timeout:20000});
  } finally { rmSync(fail,{force:true}); }
  await page.getByRole('textbox',{name:'Your reply'}).fill('Continue after the failure');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await expect(page.getByRole('log').getByText('Codex continued the selected fixture.',{exact:true})).toHaveCount(4,{timeout:20000});
});
