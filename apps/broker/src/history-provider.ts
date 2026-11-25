import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import type { Config } from '../../../packages/contracts/src/config.js';
import { DomainError } from '../../../packages/contracts/src/commands.js';
import { redactText } from '../../../packages/contracts/src/logging.js';
import { within } from '../../../packages/contracts/src/paths.js';
import { observedBilling } from '../../../packages/adapters/src/claude/index.js';
import { savedConversationId, type HistoryTarget, type LiveStatus } from '../../server/src/projects/history.js';
import { childEnvironment } from './policy/index.js';
import { codexLockFolder, codexThreadOf, codexThreadTurnOpen, FixtureCodexLocks, planCodexTakeover, WindowsCodexLocks, type CodexLocks, type LockHolder } from './codex-takeover.js';
import { FixtureClaudeProcesses, planClaudeTakeover, WindowsClaudeProcesses, type ClaudeProcesses } from './claude-takeover.js';
import { editorExecutable } from './editor-executables.js';
import { replyEnvironment, windowsLogonEnvironment } from './logon-environment.js';

const run = promisify(execFile);
type Json = Record<string, unknown>;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const object = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
export type HistorySend = ((text: string, signal: AbortSignal) => Promise<string>) & { endedEditorProcess?: LockHolder };

// A reply continues the chat as the owner left it: same model, effort and permissions, read from the chat's latest turn.
export type ChatSettings = { model?: string; effort?: string; sandbox?: string; networkAccess?: boolean; permissionMode?: string };
// A value that could be read as an option or break out of a config value is dropped, and the provider's own default applies.
const safe = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,99}$/.test(value) ? value : undefined;
const settings = (values: { [K in keyof ChatSettings]: ChatSettings[K] | undefined }) => Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as ChatSettings;

export function codexChatSettings(rows: Json[]): ChatSettings {
  const payload = object(rows.findLast(row => row.type === 'turn_context')?.payload);
  const mode = object(object(payload.collaboration_mode).settings);
  const sandbox = object(payload.sandbox_policy);
  return settings({ model: safe(payload.model) ?? safe(mode.model), effort: safe(payload.effort) ?? safe(mode.reasoning_effort), sandbox: safe(sandbox.type),
    networkAccess: typeof sandbox.network_access === 'boolean' ? sandbox.network_access : undefined });
}

export function claudeChatSettings(rows: Json[]): ChatSettings {
  const main = rows.filter(row => row.isSidechain !== true);
  const answer = main.findLast(row => row.type === 'assistant' && (safe(row.requestedModel) ?? safe(object(row.message).model)));
  const prompt = main.findLast(row => row.type === 'user' && safe(row.permissionMode));
  return settings({ model: answer && (safe(answer.requestedModel) ?? safe(object(answer.message).model)), effort: answer && safe(answer.effort),
    permissionMode: prompt && safe(prompt.permissionMode) });
}

// Streams the transcript and keeps only the records that carry turn settings, so a long chat stays cheap to read.
export async function readChatSettings(provider: HistoryTarget['provider'], file: string): Promise<ChatSettings> {
  const rows: Json[] = [];
  const relevant = provider === 'Codex' ? (line: string) => line.includes('"turn_context"')
    : (line: string) => line.includes('"permissionMode"') || line.includes('"type":"assistant"');
  try {
    const lines = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
    for await (const line of lines) {
      if (!relevant(line)) continue;
      try { rows.push(object(JSON.parse(line))); } catch { continue; }
      if (rows.length > 400) rows.splice(0, 200);
    }
  } catch { return {}; }
  return provider === 'Codex' ? codexChatSettings(rows) : claudeChatSettings(rows);
}

export function codexReplyArgs(nativeId: string, chat: ChatSettings = {}) {
  const config = (key: string, value: string | boolean) => ['-c', `${key}=${typeof value === 'string' ? JSON.stringify(value) : String(value)}`];
  return ['exec','resume','--json','--skip-git-repo-check',
    ...(chat.model ? ['-m', chat.model] : []),
    ...(chat.effort ? config('model_reasoning_effort', chat.effort) : []),
    ...(chat.sandbox ? config('sandbox_mode', chat.sandbox) : []),
    ...(chat.sandbox === 'workspace-write' && chat.networkAccess !== undefined ? config('sandbox_workspace_write.network_access', chat.networkAccess) : []),
    // Nobody is at the PC to answer an approval prompt, so the chat's own sandbox decides what runs.
    ...config('approval_policy', 'never'),
    nativeId, '-'];
}

export function claudeReplyArgs(nativeId: string, chat: ChatSettings = {}) {
  return ['--print','--output-format','stream-json','--verbose',
    ...(chat.model ? ['--model', chat.model] : []),
    ...(chat.effort ? ['--effort', chat.effort] : []),
    ...(chat.permissionMode ? ['--permission-mode', chat.permissionMode] : []),
    // Nobody is at the PC to answer a permission prompt; the chat's permission mode decides what runs.
    '--permission-prompts','none',
    '--resume', nativeId];
}

export class HistoryProvider {
  private codexLocks: CodexLocks | undefined;
  private claudeProcesses: ClaudeProcesses | undefined;
  private editorOwners: string[];
  private readLogonEnvironment: (() => Promise<NodeJS.ProcessEnv>) | undefined;
  private logon: { at: number; value: Promise<NodeJS.ProcessEnv | undefined> } | undefined;
  private findEditorExecutable: ((provider: HistoryTarget['provider']) => Promise<string | undefined>) | undefined;
  constructor(private config: Config['history'], private testRoot?: string, options: { codexLocks?: CodexLocks; claudeProcesses?: ClaudeProcesses; editorOwners?: string[];
    logonEnvironment?: () => Promise<NodeJS.ProcessEnv>; editorExecutable?: (provider: HistoryTarget['provider']) => Promise<string | undefined> } = {}) {
    this.codexLocks = options.codexLocks ?? (testRoot ? new FixtureCodexLocks(testRoot) : process.platform === 'win32' ? new WindowsCodexLocks() : undefined);
    this.claudeProcesses = options.claudeProcesses ?? (testRoot ? new FixtureClaudeProcesses(testRoot) : process.platform === 'win32' ? new WindowsClaudeProcesses() : undefined);
    this.editorOwners = (options.editorOwners ?? ['code.exe', 'code - insiders.exe']).map(name => name.toLowerCase());
    this.readLogonEnvironment = options.logonEnvironment ?? (!testRoot && process.platform === 'win32' ? windowsLogonEnvironment : undefined);
    this.findEditorExecutable = options.editorExecutable ?? (!testRoot && process.platform === 'win32' ? provider => editorExecutable(provider) : undefined);
  }

  // The configured executable turns a provider on. Replies run the binary bundled with the newest VS Code extension
  // when one is installed, so they use the version, and the models, that the chat has in VS Code.
  private async executable(provider: HistoryTarget['provider']) {
    const configured = provider === 'Codex' ? this.config.codexExecutable : this.config.claudeExecutable;
    if (!configured) return undefined;
    return (await this.findEditorExecutable?.(provider).catch(() => undefined)) ?? configured;
  }

  // Read again after ten minutes so a changed PATH or new tool reaches later replies. A failed read falls back to
  // cestOn's environment for that reply and is tried again on the next one.
  private logonEnvironment() {
    if (!this.readLogonEnvironment) return Promise.resolve(undefined);
    if (!this.logon || Date.now() - this.logon.at > 600000) {
      const logon = { at: Date.now(), value: this.readLogonEnvironment().catch(() => { if (this.logon === logon) this.logon = undefined; return undefined; }) };
      this.logon = logon;
    }
    return this.logon.value;
  }

  // Ends the idle VS Code panel process that has a Claude chat open, so the panel resumes it from the saved file
  // instead of forking it. Any other holder makes the reply wait.
  private async takeOverClaude(target: HistoryTarget, roster: Json[], readRoster: () => Promise<Json[]>): Promise<LockHolder | undefined> {
    const processes = this.claudeProcesses;
    if (!processes) return undefined;
    const pids = [...new Set(roster.filter(row => row.sessionId === target.nativeId && Number.isInteger(row.pid)).map(row => row.pid as number))];
    const plan = planClaudeTakeover(target.nativeId, roster, await processes.describe(target.home, pids), this.editorOwners);
    if (plan.action === 'send') return undefined;
    if (plan.action === 'wait' || !(await processes.end(target.home, plan.holder))) throw new DomainError('history_session_open', 409);
    for (let waited = 0; waited < 15000; waited += 500) {
      if (!(await readRoster()).some(row => row.pid === plan.holder.pid)) return plan.holder;
      await sleep(500);
    }
    throw new DomainError('history_session_open', 409);
  }

  // Frees a Codex chat held by a VS Code window when every chat that window's Codex process holds is idle.
  private async takeOverCodex(target: HistoryTarget): Promise<LockHolder | undefined> {
    const locks = this.codexLocks;
    const folder = codexLockFolder(target.home);
    const lock = join(folder, target.nativeId + '.lock');
    if (!locks || !existsSync(lock)) return undefined;
    const files = (await readdir(folder)).map(name => join(folder, name)).filter(file => codexThreadOf(file)).slice(0, 500);
    const found = await locks.holders(files);
    const holders = Object.fromEntries(files.map(file => [codexThreadOf(file)!, found[file] ?? []]));
    const held = Object.entries(holders).filter(([, list]) => list.length).map(([id]) => id);
    const turns = Object.fromEntries(await Promise.all(held.map(async id => [id, await codexThreadTurnOpen(target.home, id)] as const)));
    const plan = planCodexTakeover(target.nativeId, holders, turns, this.editorOwners);
    if (plan.action === 'send') return undefined;
    if (plan.action === 'wait' || !(await locks.end(plan.holder, lock))) throw new DomainError('history_session_open', 409);
    for (let waited = 0; waited < 15000; waited += 500) {
      if (!(await locks.holders([lock]))[lock]?.length) return plan.holder;
      await sleep(500);
    }
    throw new DomainError('history_session_open', 409);
  }

  configured(provider: HistoryTarget['provider']) {
    return Boolean(provider === 'Codex' ? this.config.codexExecutable : this.config.claudeExecutable);
  }

  async activities() {
    const executable = await this.executable('Claude');
    const home = this.config.claudeHome;
    if (!executable || !home || !isAbsolute(executable) || !isAbsolute(home)) return [];
    if (this.testRoot && [executable,home].some(path => !within(this.testRoot!,path))) return [];
    if (process.platform === 'win32' && !this.testRoot && !executable.endsWith('.exe')) return [];
    const command = this.testRoot ? process.execPath : executable;
    const args = [...(this.testRoot ? [executable] : []), 'agents', '--json', '--all'];
    const {stdout} = await run(command,args,{
      cwd: home, env: { ...childEnvironment(process.env), CLAUDE_CONFIG_DIR:home, DISABLE_AUTOUPDATER:'1', ENABLE_CLAUDEAI_MCP_SERVERS:'false' },
      windowsHide:true, maxBuffer:1024 * 1024, timeout:3500,
    });
    return claudeActivities(JSON.parse(stdout));
  }

  async prepare(target: HistoryTarget) {
    const executable = await this.executable(target.provider);
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
    let ended: LockHolder | undefined;
    // No version check: each provider updates on its own schedule. Sign-in, the open-chat roster and the start
    // of every reply are checked instead, and anything unfamiliar holds or stops the reply.
    try {
      if (target.provider === 'Codex') {
        const auth = await run(command,[...prefix,'login','status'],options);
        if (!/Logged in using ChatGPT/i.test(auth.stdout+' '+auth.stderr)) throw new Error('sign-in');
        // A failed lookup leaves the reply waiting, as it did before cestOn could free the chat.
        ended = await this.takeOverCodex(target).catch(error => {
          throw error instanceof DomainError ? error : new DomainError('history_session_open', 409);
        });
      } else {
        const auth = await run(command,[...prefix,'auth','status','--json'],options);
        if (observedBilling(JSON.parse(auth.stdout)) !== 'subscription') throw new Error('sign-in');
        const readRoster = async () => {
          const agents = JSON.parse((await run(command,[...prefix,'agents','--json'],options)).stdout) as unknown;
          if (!claudeRosterReadable(agents)) throw new Error('unavailable roster');
          return agents;
        };
        const agents = await readRoster();
        if (claudeTurnInProgress(agents, target.nativeId)) throw new DomainError('history_session_open', 409);
        // A failed lookup leaves the reply waiting rather than risking a fork of the chat.
        ended = await this.takeOverClaude(target, agents, readRoster).catch(error => {
          throw error instanceof DomainError ? error : new DomainError('history_session_open', 409);
        });
      }
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError('history_provider_unavailable', 409);
    }
    // The reply itself runs as the chat would in VS Code: the owner's configuration, tools and environment, and the
    // chat's own model, effort and permissions. Only the checks above, and the start check below, are cestOn's.
    const send: HistorySend = async (text: string, signal: AbortSignal) => {
      const chat = await readChatSettings(target.provider, target.file);
      const args = target.provider === 'Codex' ? codexReplyArgs(target.nativeId, chat) : claudeReplyArgs(target.nativeId, chat);
      const env = replyEnvironment(await this.logonEnvironment(), childEnvironment(process.env),
        target.provider === 'Codex' ? { CODEX_HOME: target.home } : { CLAUDE_CONFIG_DIR: target.home, DISABLE_AUTOUPDATER: '1' });
      let output: ReplyOutput;
      try { output = await runChecked(command,[...prefix,...args],{ cwd: target.cwd, env },text,signal,item => replyStartCheck(target,item)); }
      catch (error) {
        if (error instanceof DomainError) throw error;
        const detail = error as { code?: number; head?: string; stderr?: string };
        if (target.provider === 'Codex' && typeof detail.code === 'number' && !detail.head?.includes('"turn.started"') &&
          /already has an active writer|thread is already open in another/i.test((detail.head ?? '')+' '+(detail.stderr ?? ''))) {
          throw new DomainError('history_session_open',409);
        }
        // The provider ran and ended without finishing the turn. That outcome is known, so the chat stays free for the next reply.
        throw new DomainError('history_reply_failed',409);
      }
      try { return readHistoryReply(target, output.items); }
      catch { throw new DomainError('history_reply_failed',409); }
    };
    if (ended) send.endedEditorProcess = ended;
    return send;
  }
}

function rosterStatus(row: Json | null): LiveStatus | undefined {
  if (row?.status === 'waiting' || row?.state === 'blocked') return 'waiting';
  if (row?.status === 'busy' || row?.state === 'working') return 'working';
  if (row?.status === 'idle' || ['done','failed','stopped'].includes(String(row?.state))) return 'idle';
  return undefined;
}

// The first identifying line of a reply must name the same chat. Output that starts a turn before that line,
// or a line that names another chat, stops the provider before it answers.
export function replyStartCheck(target: Pick<HistoryTarget,'provider'|'nativeId'>, item: Json): 'confirmed' | 'continue' | 'stop' {
  if (target.provider === 'Codex') {
    if (item.type === 'thread.started') return item.thread_id === target.nativeId ? 'confirmed' : 'stop';
    return typeof item.type === 'string' && /^(?:turn|item)\./.test(item.type) ? 'stop' : 'continue';
  }
  if (item.type === 'system' && item.subtype === 'init') return item.session_id === target.nativeId ? 'confirmed' : 'stop';
  return item.type === 'system' ? 'continue' : 'stop';
}

// Keeps the lines that name the chat and carry its outcome. A long turn's tool output is read and dropped.
function keepReplyItem(items: Json[], item: Json) {
  if (item.type === 'item.completed' && object(item.item).type === 'agent_message') {
    const earlier = items.findIndex(row => row.type === 'item.completed');
    if (earlier >= 0) items.splice(earlier, 1);
    items.push(item);
  } else if (['thread.started','turn.completed','turn.failed','result'].includes(String(item.type)) || (item.type === 'system' && item.subtype === 'init')) items.push(item);
}

// Ends the provider with every command it started, so a stopped reply leaves nothing running on the PC.
function endTree(child: ChildProcess) {
  if (process.platform === 'win32' && child.pid) {
    const taskkill = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe');
    const killer = spawn(taskkill, ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    killer.once('error', () => child.kill());
    killer.once('close', code => { if (code !== 0) child.kill(); });
  } else child.kill();
}

type RunOptions = { cwd: string; env: NodeJS.ProcessEnv };
type ReplyOutput = { items: Json[]; head: string; stderr: string };
// Runs one reply without a time limit, reading output as it arrives so a start in another chat is ended before the model can act.
// Aborting the signal stops the reply.
function runChecked(command: string, args: string[], options: RunOptions, text: string, signal: AbortSignal,
  check: (item: Json) => 'confirmed' | 'continue' | 'stop') {
  return new Promise<ReplyOutput>((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, windowsHide: true, stdio: ['pipe','pipe','pipe'] });
    const items: Json[] = [];
    let head = ''; let stderr = ''; let pending = '';
    let confirmed = false; let stopped = false; let ending = false;
    const end = () => { if (child.exitCode === null && child.signalCode === null && !ending) { ending = true; endTree(child); } };
    if (signal.aborted) end(); else signal.addEventListener('abort', end, { once: true });
    const take = (line: string) => {
      let item: Json;
      try { item = JSON.parse(line) as Json; } catch { return; }
      if (!confirmed) {
        const result = check(item);
        if (result === 'stop') { stopped = true; end(); return; }
        if (result === 'confirmed') confirmed = true;
      }
      keepReplyItem(items, item);
    };
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      if (stopped) return;
      if (head.length < 65536) head += chunk.slice(0, 65536 - head.length);
      pending += chunk;
      for (let index = pending.indexOf('\n'); index >= 0 && !stopped; index = pending.indexOf('\n')) {
        const line = pending.slice(0, index).trim();
        pending = pending.slice(index + 1);
        if (line) take(line);
      }
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { if (stderr.length < 64 * 1024) stderr += chunk; });
    child.stdin.on('error', () => {});
    child.stdin.end(text);
    const finish = () => { signal.removeEventListener('abort', end); };
    child.once('error', error => { finish(); reject(error); });
    child.once('close', code => {
      finish();
      if (!stopped && pending.trim()) take(pending.trim());
      if (stopped) reject(new DomainError('history_reply_stopped', 409));
      else if (signal.aborted) reject(new DomainError('history_reply_interrupted', 409));
      else if (code === 0) resolve({ items, head, stderr });
      else reject(Object.assign(new Error('provider_exit'), { code, head, stderr }));
    });
  });
}

// A roster row without a session ID means the format changed, and a busy chat could pass as idle.
export function claudeRosterReadable(roster: unknown): roster is Json[] {
  return Array.isArray(roster) && roster.every(row => typeof row === 'object' && row !== null && typeof (row as Json).sessionId === 'string');
}

// Claude lets a second process continue a session that another process has open.
// Only a turn that is running, awaiting input, or in an unknown state holds a reply back.
export function claudeTurnInProgress(roster: unknown[], nativeId: string) {
  return (roster as (Json | null)[]).some(row => row?.sessionId === nativeId && rosterStatus(row) !== 'idle');
}

export function claudeActivities(input: unknown): { id: string; status: LiveStatus }[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0,1000).flatMap((row: Json | null) => {
    const id = row?.sessionId;
    if (typeof id !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) return [];
    const status = rosterStatus(row);
    return status ? [{id:savedConversationId('Claude',id),status}] : [];
  });
}

// Longest answer kept for the phone; the full answer stays in the chat on the PC.
export const replyAnswerLimit = 32000;

export function readHistoryReply(target: Pick<HistoryTarget,'provider'|'nativeId'>, items: Json[]) {
  if (target.provider === 'Codex') {
    const threads = items.filter(item => item.type === 'thread.started');
    if (threads.length !== 1 || threads[0]?.thread_id !== target.nativeId || !items.some(item => item.type === 'turn.completed') || items.some(item => item.type === 'turn.failed')) throw new Error('same-thread completion required');
    const replies = items.filter(item => item.type === 'item.completed')
      .map(item => item.item as Json | undefined).filter(item => item?.type === 'agent_message');
    const text = replies.at(-1)?.text;
    if (typeof text === 'string' && text.trim()) return redactText(text).slice(0,replyAnswerLimit);
  } else {
    const init = items.find(item => item.type === 'system' && item.subtype === 'init');
    const result = items.findLast(item => item.type === 'result');
    if (init?.session_id === target.nativeId &&
      result?.session_id === target.nativeId && result.subtype === 'success' && result.is_error !== true &&
      typeof result.result === 'string' && result.result.trim()) return redactText(result.result).slice(0,replyAnswerLimit);
  }
  throw new Error('same-thread completion required');
}
