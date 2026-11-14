import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';
let thread = 0; let turn = 0; const turns = new Map();
function send(value) { process.stdout.write(`${JSON.stringify(value)}\n`); }
const input = createInterface({ input: process.stdin });
input.on('line', line => {
  const m = JSON.parse(line);
  if (!m.method) return;
  appendFileSync(process.argv[2], `${JSON.stringify({ method: m.method, params: m.params })}\n`);
  if (m.id === undefined) return;
  let result = {};
  if (m.method === 'initialize') result = { userAgent: 'fixture' };
  if (m.method === 'account/read') result = { account: { type: 'chatgpt' } };
  if (m.method === 'thread/start') result = { thread: { id: `thread-${++thread}` } };
  if (m.method === 'thread/resume') result = { thread: { id: m.params.threadId } };
  if (m.method === 'thread/list') result = { data: [] };
  if (m.method === 'thread/turns/list') result = { data: [] };
  if (m.method === 'turn/start') { const id = `turn-${++turn}`; turns.set(m.params.threadId, id); result = { turn: { id } }; }
  send({ id: m.id, result });
  if (m.method === 'turn/start' && m.params.input[0].text.includes('malformed')) { process.stdout.write('{broken\n'); return; }
  if (m.method === 'turn/start' && !m.params.input[0].text.includes('slow')) {
    send({ method: 'item/agentMessage/delta', params: { threadId: 'wrong-thread', turnId: 'wrong-turn', delta: 'wrong target' } });
    send({ method: 'item/agentMessage/delta', params: { threadId: m.params.threadId, turnId: result.turn.id, delta: 'fixture response' } });
    send({ method: 'turn/completed', params: { threadId: m.params.threadId, turn: { id: result.turn.id, status: 'completed' } } });
  }
  if (m.method === 'turn/interrupt') send({ method: 'turn/completed', params: { threadId: m.params.threadId, turn: { id: m.params.turnId, status: 'interrupted' } } });
});
