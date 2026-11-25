import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const codex = Boolean(process.env.CODEX_HOME);
const home = process.env.CODEX_HOME ?? process.env.CLAUDE_CONFIG_DIR;
const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
// cestOn checks behaviour, not version numbers, so asking for the version is a failure here.
if (args.includes('--version')) { console.error('cestOn should not need the provider version'); process.exit(2); }
else if (args[0] === 'login') console.log('Logged in using ChatGPT');
else if (args[0] === 'auth') emit({ loggedIn:true, authMethod:'claude.ai', subscriptionType:'max' });
else if (args[0] === 'agents') {
  const roster = join(home,'activity-fixture.json');
  if (existsSync(roster)) emit(JSON.parse(readFileSync(roster,'utf8')));
  else emit(existsSync(join(home,'open')) ? [{ sessionId:'01234567-89ab-4def-8123-000000000002', status:'busy' }] : []);
}
else {
  if (!args.includes('resume') && !args.includes('--resume')) throw new Error('Expected exact resume');
  const id = codex ? args.at(-2) : args[args.indexOf('--resume')+1];
  if (codex && existsSync(join(home,'open'))) {
    console.error('thread already has an active writer');
    process.exit(1);
  }
  let text = '';
  process.stdin.setEncoding('utf8').on('data', chunk => { text += chunk; });
  await new Promise(resolve => process.stdin.once('end',resolve));
  appendFileSync(join(home,'requests.jsonl'),JSON.stringify({ id, text, cwd:process.cwd(), args, logonMarker:process.env.CESTON_LOGON_MARKER ?? null })+'\n');
  // unsafe-start: the provider names another chat, then answers a moment later.
  if (existsSync(join(home,'unsafe-start'))) {
    emit(codex ? {type:'thread.started',thread_id:'01234567-89ab-4def-8123-00000000dead'} : {type:'system',subtype:'init',session_id:'01234567-89ab-4def-8123-00000000dead',tools:['Bash']});
    await new Promise(resolve => setTimeout(resolve,1500));
    appendFileSync(join(home,'answered'),'synthetic\n');
    emit(codex ? {type:'turn.completed'} : {type:'result',subtype:'success',session_id:id,result:'Unsafe fixture answer.'});
    process.exit(0);
  }
  emit(codex ? {type:'thread.started',thread_id:id} : {type:'system',subtype:'init',session_id:id,tools:['Bash','Edit','Read','Write']});
  if (codex) emit({type:'turn.started'});
  // fail-reply: the provider starts the chat, then exits with an error.
  if (existsSync(join(home,'fail-reply'))) { console.error('synthetic provider failure'); process.exit(3); }
  // slow-reply: the provider starts a command of its own and keeps working until it is stopped.
  if (existsSync(join(home,'slow-reply'))) {
    const command = spawn(process.execPath,['-e','setInterval(() => {}, 1000)'],{ stdio:'ignore' });
    writeFileSync(join(home,'command.pid'),String(command.pid));
    await new Promise(resolve => setTimeout(resolve,120000));
  }
  // large-output: a long turn whose tool output is far larger than the answer.
  if (existsSync(join(home,'large-output'))) {
    const output = 'x'.repeat(64 * 1024);
    for (let index = 0; index < 160; index++) {
      emit(codex ? {type:'item.completed',item:{type:'command_execution',aggregated_output:output}} : {type:'user',message:{content:[{type:'tool_result',content:output}]}});
    }
  }
  if (codex) {
    emit({type:'item.completed',item:{type:'agent_message',text:'Working on it.'}});
    emit({type:'item.completed',item:{type:'agent_message',text:'Codex continued the selected fixture.'}});
    emit({type:'turn.completed'});
  } else {
    emit({type:'result',subtype:'success',session_id:id,result:'Claude continued the selected fixture.'});
  }
}
