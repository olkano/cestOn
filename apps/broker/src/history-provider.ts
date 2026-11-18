import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { promisify } from 'node:util';
import type { Config } from '../../../packages/contracts/src/config.js';
import { DomainError } from '../../../packages/contracts/src/commands.js';
import { redactText } from '../../../packages/contracts/src/logging.js';
import { within } from '../../../packages/contracts/src/paths.js';
import { observedBilling } from '../../../packages/adapters/src/claude/index.js';
import type { HistoryTarget } from '../../server/src/projects/history.js';
import { childEnvironment } from './policy/index.js';

const run = promisify(execFile);
type Json = Record<string, unknown>;

export class HistoryProvider {
  constructor(private config: Config['history'], private testRoot?: string) {}

  configured(provider: HistoryTarget['provider']) {
    return Boolean(provider === 'Codex' ? this.config.codexExecutable : this.config.claudeExecutable);
  }

  async prepare(target: HistoryTarget) {
    const executable = target.provider === 'Codex' ? this.config.codexExecutable : this.config.claudeExecutable;
    if (!executable || !isAbsolute(executable) || !isAbsolute(target.cwd) || !isAbsolute(target.home)) throw new DomainError('history_provider_unavailable', 409);
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(target.nativeId)) throw new DomainError('history_target_invalid', 409);
    if (this.testRoot && [executable,target.cwd,target.home].some(path => !within(this.testRoot!,path))) throw new DomainError('test_workspace_denied', 403);
    if (process.platform === 'win32' && !this.testRoot && !executable.endsWith('.exe')) throw new DomainError('history_provider_unavailable', 409);
    try {
      if (!(await stat(executable)).isFile() || !(await stat(target.cwd)).isDirectory()) throw new Error();
    } catch { throw new DomainError('history_provider_unavailable', 409); }
    const options = { cwd: target.cwd, env: {
      ...childEnvironment(process.env),
      ...(target.provider === 'Codex' ? { CODEX_HOME: target.home } : { CLAUDE_CONFIG_DIR: target.home, DISABLE_AUTOUPDATER: '1', ENABLE_CLAUDEAI_MCP_SERVERS: 'false' }),
    }, windowsHide: true, maxBuffer: 8 * 1024 * 1024, timeout: 8000 };
    const command = this.testRoot ? process.execPath : executable;
    const prefix = this.testRoot ? [executable] : [];
    try {
      const version = (await run(command,[...prefix,'--version'],options)).stdout.trim();
      if (target.provider === 'Codex') {
        if (!/^codex-cli 0\.160\.0$/.test(version)) throw new Error('version');
        const auth = await run(command,[...prefix,'login','status'],options);
        if (!/Logged in using ChatGPT/i.test(auth.stdout+' '+auth.stderr)) throw new Error('sign-in');
      } else {
        if (!/^2\.1\.325(?:\s|$)/.test(version)) throw new Error('version');
        const auth = await run(command,[...prefix,'auth','status','--json'],options);
        if (observedBilling(JSON.parse(auth.stdout)) !== 'subscription') throw new Error('sign-in');
        const agents = JSON.parse((await run(command,[...prefix,'agents','--json'],options)).stdout) as unknown;
        if (!Array.isArray(agents)) throw new Error('unavailable roster');
        if (agents.some(agent => agent?.sessionId === target.nativeId)) throw new DomainError('history_session_open', 409);
      }
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError('history_provider_unavailable', 409);
    }
    return async (text: string, signal: AbortSignal) => {
      const args = target.provider === 'Codex'
        ? ['--sandbox','read-only','--ask-for-approval','never','-c','mcp_servers={}', '--disable','apps','--disable','plugins',
          'exec','resume','--ignore-user-config','--skip-git-repo-check','--json',target.nativeId,'-']
        : ['--print','--restricted','--tools','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}',
          '--disable-slash-commands','--max-turns','1','--output-format','stream-json','--verbose','--resume',target.nativeId];
      const execution = run(command,[...prefix,...args],{...options,timeout:300000,signal});
      execution.child.stdin?.on('error', () => {});
      execution.child.stdin?.end(text);
      try { return readHistoryReply(target,(await execution).stdout); }
      catch (error) {
        const detail = error as { stdout?: string; stderr?: string };
        if (target.provider === 'Codex' && !detail.stdout?.includes('"turn.started"') &&
          /already has an active writer|thread is already open in another/i.test((detail.stdout ?? '')+' '+(detail.stderr ?? ''))) {
          throw new DomainError('history_session_open',409);
        }
        throw error;
      }
    };
  }
}

export function readHistoryReply(target: HistoryTarget, output: string) {
  const items: Json[] = output.trim().split(/\r?\n/).map(line => JSON.parse(line) as Json);
  if (target.provider === 'Codex') {
    const threads = items.filter(item => item.type === 'thread.started');
    if (threads.length !== 1 || threads[0]?.thread_id !== target.nativeId || !items.some(item => item.type === 'turn.completed') || items.some(item => item.type === 'turn.failed')) throw new Error('same-thread completion required');
    const replies = items.filter(item => item.type === 'item.completed')
      .map(item => item.item as Json | undefined).filter(item => item?.type === 'agent_message');
    const text = replies.at(-1)?.text;
    if (typeof text === 'string' && text.trim()) return redactText(text).slice(0,12000);
  } else {
    const init = items.find(item => item.type === 'system' && item.subtype === 'init');
    const result = items.findLast(item => item.type === 'result');
    if (init?.session_id === target.nativeId && Array.isArray(init.tools) && init.tools.length === 0 &&
      result?.session_id === target.nativeId && result.subtype === 'success' && result.is_error !== true &&
      typeof result.result === 'string' && result.result.trim()) return redactText(result.result).slice(0,12000);
  }
  throw new Error('same-thread completion required');
}
