import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { within } from '../../../packages/contracts/src/paths.js';
import { windowsProcessCall, type LockHolder, type TakeoverPlan } from './codex-takeover.js';

type Json = Record<string, unknown>;

export interface ClaudeProcesses {
  describe(home: string, pids: number[]): Promise<Record<number, LockHolder | undefined>>;
  end(home: string, holder: LockHolder): Promise<boolean>;
}

// Windows FILETIME (100 ns since 1601) to Unix milliseconds.
export function fileTimeToMs(fileTime: string) {
  return /^\d+$/.test(fileTime) ? Number(BigInt(fileTime) / 10000n - 11644473600000n) : NaN;
}

const idle = (row: Json) => row.status === 'idle';
// The roster's startedAt is written by the process shortly after Windows starts it.
const startTolerance = 30000;

// A VS Code Claude panel keeps the chat in memory and never rereads the saved file, so its next message would
// fork the chat and hide a phone reply. Ending its process while every chat it has open is idle makes the
// panel resume the chat from the saved file. Anything other than a verified idle VS Code panel waits.
export function planClaudeTakeover(target: string, roster: Json[], processes: Record<number, LockHolder | undefined>, owners: string[]): TakeoverPlan {
  const rows = roster.filter(row => row.sessionId === target);
  if (!rows.length) return { action: 'send' };
  if (rows.some(row => !Number.isInteger(row.pid))) return { action: 'wait', reason: 'unknown_holder' };
  const pids = [...new Set(rows.map(row => row.pid as number))];
  if (pids.length !== 1) return { action: 'wait', reason: 'several_holders' };
  const holder = processes[pids[0]!];
  if (!holder) return { action: 'send' };
  if (rows.some(row => typeof row.startedAt !== 'number' || Math.abs(row.startedAt - fileTimeToMs(holder.startedAt)) > startTolerance)) {
    return { action: 'wait', reason: 'holder_changed' };
  }
  const editor = holder.name.toLowerCase() === 'claude.exe' && owners.includes(holder.parentName.toLowerCase()) &&
    /\s--input-format[= ]stream-json(?:\s|$)/.test(holder.commandLine) && /\s--output-format[= ]stream-json(?:\s|$)/.test(holder.commandLine);
  if (!editor) return { action: 'wait', reason: 'holder_not_editor' };
  const sessions = roster.filter(row => row.pid === holder.pid);
  if (!sessions.every(idle)) return { action: 'wait', reason: 'turn_in_progress' };
  return { action: 'end', holder, threads: [...new Set(sessions.map(row => String(row.sessionId)))].sort() };
}

export class WindowsClaudeProcesses implements ClaudeProcesses {
  async describe(_home: string, pids: number[]) {
    if (!pids.length) return {};
    const output = await windowsProcessCall({ action: 'describe', pids });
    const found = ([] as LockHolder[]).concat((output.processes ?? []) as LockHolder[]);
    return Object.fromEntries(found.map(holder => [holder.pid, { ...holder, startedAt: String(holder.startedAt) }]));
  }
  async end(_home: string, holder: LockHolder) {
    const output = await windowsProcessCall({ action: 'end', processName: 'claude', pid: holder.pid, startedAt: holder.startedAt });
    return output.outcome === 'ended' || output.outcome === 'gone';
  }
}

// Test double: process-fixture.json in the provider home maps process IDs to processes; ending one records it
// and removes its rows from the fixture roster.
export class FixtureClaudeProcesses implements ClaudeProcesses {
  constructor(private testRoot: string) {}
  private path(home: string, name: string) {
    const path = join(home, name);
    if (!within(this.testRoot, path)) throw new Error('test_workspace_denied');
    return path;
  }
  async describe(home: string, pids: number[]) {
    const path = this.path(home, 'process-fixture.json');
    const data = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as Record<string, LockHolder> : {};
    return Object.fromEntries(pids.filter(pid => data[pid]).map(pid => [pid, data[pid]!]));
  }
  async end(home: string, holder: LockHolder) {
    const processes = this.path(home, 'process-fixture.json');
    const roster = this.path(home, 'activity-fixture.json');
    if (existsSync(processes)) {
      const data = JSON.parse(readFileSync(processes, 'utf8')) as Record<string, LockHolder>;
      delete data[holder.pid];
      writeFileSync(processes, JSON.stringify(data));
    }
    if (existsSync(roster)) writeFileSync(roster, JSON.stringify((JSON.parse(readFileSync(roster, 'utf8')) as Json[]).filter(row => row.pid !== holder.pid)));
    appendFileSync(this.path(home, 'ended.jsonl'), JSON.stringify(holder) + '\n');
    rmSync(this.path(home, 'open'), { force: true });
    return true;
  }
}
