import { createServer } from 'node:net';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Config } from '../../../packages/contracts/src/config.js';
import { assertTestRoot } from '../../../packages/test-support/src/index.js';
import { DomainError } from '../../../packages/contracts/src/commands.js';
import { executeSandboxedRecipe } from './recipes.js';
export async function probeConfinement(root: string, config: Config) {
  assertTestRoot(root); const workspace = join(root, `confinement-${randomUUID()}`); mkdirSync(workspace); const outside = join(root, `${randomUUID()}.txt`); const nonce = randomUUID(); writeFileSync(outside, nonce, { flag: 'wx' }); let connections = 0; const server = createServer(socket => { connections++; socket.end(); });
  try {
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done)); const address = server.address(); if (!address || typeof address === 'string') throw new DomainError('probe_port_unavailable');
    const code = `const fs=require('node:fs'),net=require('node:net');let read=false,write=false;try{fs.readFileSync(${JSON.stringify(outside)})}catch(e){read=['EACCES','EPERM'].includes(e.code)}try{fs.writeFileSync(${JSON.stringify(outside)},'forbidden')}catch(e){write=['EACCES','EPERM'].includes(e.code)}fs.writeFileSync('positive.txt','synthetic positive control');const socket=net.connect({host:'127.0.0.1',port:${address.port}});const timer=setTimeout(()=>process.exit(9),3000);socket.on('connect',()=>process.exit(8));socket.on('error',e=>{clearTimeout(timer);process.exit(read&&write&&['EACCES','EPERM'].includes(e.code)?0:7)});`;
    const checked = await executeSandboxedRecipe(root, { ...config, executionHost: { ...config.executionHost, home: join(root, 'confinement-home') } }, { id: 'native-confinement', executable: process.execPath, args: ['-e', code], operation: 'test', network: false, timeoutSeconds: 10 }, workspace);
    if (checked.exitCode !== 0 || connections !== 0 || readFileSync(outside, 'utf8') !== nonce || readFileSync(join(workspace, 'positive.txt'), 'utf8') !== 'synthetic positive control') throw new DomainError('native_confinement_not_proved');
    return { result: 'pass' as const, checks: ['outside-read-denial', 'outside-write-denial', 'network-denial', 'positive-control'], evidenceHash: checked.outputHash, modelTurns: 0 };
  } finally { if (server.listening) await new Promise<void>(done => server.close(() => done())); }
}
