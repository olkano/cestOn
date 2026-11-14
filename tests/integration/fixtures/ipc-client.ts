import { ipcRequest } from '../../../apps/broker/src/ipc.js';
const reply = await ipcRequest(process.argv[2]!, JSON.parse(process.argv[3]!));
console.log(JSON.stringify({ code: reply.error?.code ?? 'unexpected_success' }));
