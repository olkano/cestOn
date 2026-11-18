import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const codex = Boolean(process.env.CODEX_HOME);
const home = process.env.CODEX_HOME ?? process.env.CLAUDE_CONFIG_DIR;
const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
if (args.includes('--version')) console.log(codex ? 'codex-cli 0.160.0' : '2.1.325 (Claude Code)');
else if (args[0] === 'login') console.log('Logged in using ChatGPT');
else if (args[0] === 'auth') emit({ loggedIn:true, authMethod:'claude.ai', subscriptionType:'max' });
else if (args[0] === 'agents') {
  const roster = join(home,'activity-fixture.json');
  if (existsSync(roster)) emit(JSON.parse(readFileSync(roster,'utf8')));
  else emit(existsSync(join(home,'open')) ? [{ sessionId:'01234567-89ab-4def-8123-000000000002' }] : []);
}
else {
  const id = args[args.indexOf(codex ? '--json' : '--resume')+1];
  if (!args.includes('resume') && !args.includes('--resume')) throw new Error('Expected exact resume');
  let text = '';
  process.stdin.setEncoding('utf8').on('data', chunk => { text += chunk; });
  await new Promise(resolve => process.stdin.once('end',resolve));
  appendFileSync(join(home,'requests.jsonl'),JSON.stringify({ id, text, cwd:process.cwd() })+'\n');
  if (codex) {
    emit({type:'thread.started',thread_id:id});
    emit({type:'turn.started'});
    emit({type:'item.completed',item:{type:'agent_message',text:'Codex continued the selected fixture.'}});
    emit({type:'turn.completed'});
  } else {
    emit({type:'system',subtype:'init',session_id:id,tools:[]});
    emit({type:'result',subtype:'success',session_id:id,result:'Claude continued the selected fixture.'});
  }
}
