import { execFile } from 'node:child_process';
import { appendFileSync, closeSync, existsSync, openSync, readFileSync, readSync, rmSync, writeFileSync } from 'node:fs';
import { open, opendir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { within } from '../../../packages/contracts/src/paths.js';
import { childEnvironment } from './policy/index.js';

const run = promisify(execFile);
type Json = Record<string, unknown>;
const threadPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

// A process that has a Codex thread lock file open. startedAt is the Windows FILETIME of its start, so a reused ID is not mistaken for it.
export type LockHolder = { pid: number; startedAt: string; name: string; commandLine: string; parentName: string };
export interface CodexLocks {
  holders(lockFiles: string[]): Promise<Record<string, LockHolder[]>>;
  end(holder: LockHolder, lockFile: string): Promise<boolean>;
}
export type TakeoverPlan = { action: 'send' } | { action: 'wait'; reason: string } | { action: 'end'; holder: LockHolder; threads: string[] };

const sameProcess = (a: LockHolder, b: LockHolder) => a.pid === b.pid && a.startedAt === b.startedAt;

// Codex lets one process write a thread. When that process is a VS Code window's Codex app-server and none of
// the chats it holds is mid-turn, ending it is the only way to free the chat; otherwise the reply waits.
export function planCodexTakeover(target: string, holders: Record<string, LockHolder[]>, turnOpen: Record<string, boolean | undefined>, owners: string[]): TakeoverPlan {
  const held = holders[target] ?? [];
  if (!held.length) return { action: 'send' };
  if (held.length !== 1) return { action: 'wait', reason: 'several_holders' };
  const holder = held[0]!;
  const editor = holder.name.toLowerCase() === 'codex.exe' && /\sapp-server(?:\s|$)/.test(holder.commandLine) && owners.includes(holder.parentName.toLowerCase());
  if (!editor) return { action: 'wait', reason: 'holder_not_editor' };
  const threads = Object.entries(holders).filter(([, list]) => list.some(other => sameProcess(other, holder))).map(([id]) => id).sort();
  if (threads.some(id => turnOpen[id] !== false)) return { action: 'wait', reason: 'turn_in_progress' };
  return { action: 'end', holder, threads };
}

// true: a turn is running or awaiting approval. undefined: no turn marker was read, so the state is unknown.
// Unknown holds the reply, so markers renamed by a Codex update never make a busy window look idle.
export function codexTurnOpen(rows: Json[]): boolean | undefined {
  let open: boolean | undefined;
  let turn: unknown;
  for (const row of rows) {
    if (row.type !== 'event_msg') continue;
    const payload = (row.payload ?? {}) as Json;
    if (payload.type === 'task_started') { open = true; turn = payload.turn_id; }
    else if (payload.type === 'task_complete' || payload.type === 'turn_aborted') {
      if (open && turn && payload.turn_id && payload.turn_id !== turn) continue;
      open = false; turn = undefined;
    }
  }
  return open;
}

async function findRollout(home: string, id: string, folder = join(home, 'sessions'), depth = 0): Promise<string | undefined> {
  let directory;
  try { directory = await opendir(folder); } catch { return undefined; }
  for await (const entry of directory) {
    const path = join(folder, entry.name);
    if (entry.isFile() && entry.name.startsWith('rollout-') && entry.name.endsWith(`-${id}.jsonl`)) return path;
    if (entry.isDirectory() && depth < 4) { const found = await findRollout(home, id, path, depth + 1); if (found) return found; }
  }
  return undefined;
}

export async function codexThreadTurnOpen(home: string, id: string): Promise<boolean | undefined> {
  const file = await findRollout(home, id);
  if (!file) return undefined;
  const handle = await open(file, 'r');
  try {
    const { size } = await handle.stat();
    const length = Math.min(size, 1024 * 1024);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    let text = buffer.toString('utf8');
    if (length < size) text = text.slice(text.indexOf('\n') + 1);
    const rows = text.split(/\r?\n/).flatMap(line => { try { return line.trim() ? [JSON.parse(line) as Json] : []; } catch { return []; } });
    return codexTurnOpen(rows);
  } finally { await handle.close(); }
}

export function codexLockFolder(home: string) { return join(home, 'thread-writer-locks'); }
export function codexThreadOf(lockFile: string) {
  const id = basename(lockFile, '.lock');
  return threadPattern.test(id) && lockFile.endsWith('.lock') ? id : undefined;
}

// Asks Windows which process has each lock file open (Restart Manager), describes processes by ID, and ends one verified process.
const script = String.raw`
$ErrorActionPreference = 'Stop'
$request = $env:CESTON_PROCESS_REQUEST | ConvertFrom-Json
if ($request.action -eq 'end') {
  $p = Get-Process -Id ([int]$request.pid) -ErrorAction SilentlyContinue
  $outcome = 'gone'
  if ($p) {
    if ($p.ProcessName -ne [string]$request.processName -or $p.StartTime.ToFileTimeUtc().ToString() -ne [string]$request.startedAt) { $outcome = 'mismatch' }
    else { $p.Kill(); if ($p.WaitForExit(15000)) { $outcome = 'ended' } else { $outcome = 'timeout' } }
  }
  [Console]::Out.Write((@{ outcome = $outcome } | ConvertTo-Json -Compress))
  exit 0
}
if ($request.action -eq 'describe') {
  $found = @()
  foreach ($id in @($request.pids)) {
    $p = Get-CimInstance Win32_Process -Filter ("ProcessId=" + [int]$id)
    $running = Get-Process -Id ([int]$id) -ErrorAction SilentlyContinue
    if (-not $p -or -not $running) { continue }
    $parentName = ''
    $parent = Get-CimInstance Win32_Process -Filter ("ProcessId=" + [int]$p.ParentProcessId)
    if ($parent -and $parent.CreationDate -le $p.CreationDate) { $parentName = [string]$parent.Name }
    $found += [pscustomobject]@{ pid = [int]$id; startedAt = $running.StartTime.ToFileTimeUtc().ToString(); name = [string]$p.Name; commandLine = [string]$p.CommandLine; parentName = $parentName }
  }
  [Console]::Out.Write((@{ processes = @($found) } | ConvertTo-Json -Depth 4 -Compress))
  exit 0
}
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class CestonLockHolders {
  [StructLayout(LayoutKind.Sequential)] struct RmUniqueProcess { public int ProcessId; public uint StartLow; public uint StartHigh; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct RmProcessInfo {
    public RmUniqueProcess Process;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string AppName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string ServiceShortName;
    public int ApplicationType; public uint AppStatus; public uint TSSessionId; [MarshalAs(UnmanagedType.Bool)] public bool Restartable;
  }
  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)] static extern int RmStartSession(out uint handle, int flags, System.Text.StringBuilder key);
  [DllImport("rstrtmgr.dll")] static extern int RmEndSession(uint handle);
  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)] static extern int RmRegisterResources(uint handle, uint files, string[] names, uint apps, IntPtr unique, uint services, string[] serviceNames);
  [DllImport("rstrtmgr.dll")] static extern int RmGetList(uint handle, out uint needed, ref uint count, [In, Out] RmProcessInfo[] info, ref uint reasons);
  public static string[] Holders(string path) {
    uint handle; var key = new System.Text.StringBuilder(64);
    if (RmStartSession(out handle, 0, key) != 0) throw new Exception("restart manager unavailable");
    try {
      if (RmRegisterResources(handle, 1, new[] { path }, 0, IntPtr.Zero, 0, null) != 0) throw new Exception("lock file not registered");
      uint needed = 0, count = 0, reasons = 0;
      int first = RmGetList(handle, out needed, ref count, null, ref reasons);
      if (first == 0 || needed == 0) return new string[0];
      var info = new RmProcessInfo[needed]; count = needed;
      if (RmGetList(handle, out needed, ref count, info, ref reasons) != 0) throw new Exception("holder list unavailable");
      var result = new List<string>();
      for (int i = 0; i < count; i++) result.Add(info[i].Process.ProcessId + ":" + (((ulong)info[i].Process.StartHigh << 32) | info[i].Process.StartLow));
      return result.ToArray();
    } finally { RmEndSession(handle); }
  }
}
'@
$results = @()
for ($i = 0; $i -lt $request.files.Count; $i++) {
  $holders = @()
  foreach ($entry in [CestonLockHolders]::Holders([string]$request.files[$i])) {
    $parts = $entry.Split(':')
    $p = Get-CimInstance Win32_Process -Filter ("ProcessId=" + [int]$parts[0])
    $parentName = ''
    if ($p) {
      $parent = Get-CimInstance Win32_Process -Filter ("ProcessId=" + [int]$p.ParentProcessId)
      if ($parent -and $parent.CreationDate -le $p.CreationDate) { $parentName = [string]$parent.Name }
    }
    $holders += [pscustomobject]@{ pid = [int]$parts[0]; startedAt = $parts[1]; name = [string]$p.Name; commandLine = [string]$p.CommandLine; parentName = $parentName }
  }
  $results += [pscustomobject]@{ index = $i; holders = @($holders) }
}
[Console]::Out.Write((@{ results = @($results) } | ConvertTo-Json -Depth 5 -Compress))
`;

export async function windowsProcessCall(request: Json) {
  const shell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const { stdout } = await run(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
    env: { ...childEnvironment(process.env), CESTON_PROCESS_REQUEST: JSON.stringify(request) }, windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024,
  });
  return JSON.parse(stdout) as Json;
}

export class WindowsCodexLocks implements CodexLocks {
  private call(request: Json) { return windowsProcessCall(request); }

  // A held lock cannot be read, so only those files need the slower Windows lookup.
  async holders(lockFiles: string[]) {
    const held = lockFiles.filter(file => {
      let fd: number | undefined;
      try { fd = openSync(file, 'r'); readSync(fd, Buffer.alloc(1), 0, 1, 0); return false; }
      catch { return existsSync(file); }
      finally { if (fd !== undefined) closeSync(fd); }
    });
    const result: Record<string, LockHolder[]> = Object.fromEntries(lockFiles.map(file => [file, []]));
    if (!held.length) return result;
    const output = await this.call({ action: 'holders', files: held });
    for (const row of ([] as Json[]).concat((output.results ?? []) as Json[])) {
      const file = held[Number(row.index)];
      if (file) result[file] = ([] as LockHolder[]).concat((row.holders ?? []) as LockHolder[]).map(holder => ({ ...holder, startedAt: String(holder.startedAt) }));
    }
    return result;
  }

  async end(holder: LockHolder) {
    const output = await this.call({ action: 'end', processName: 'codex', pid: holder.pid, startedAt: holder.startedAt });
    return output.outcome === 'ended' || output.outcome === 'gone';
  }
}

// Test double: lock-fixture.json in the provider home maps thread IDs to holders; ending one records it and frees its chats.
export class FixtureCodexLocks implements CodexLocks {
  constructor(private testRoot: string) {}
  private state(file: string) {
    const path = join(dirname(dirname(file)), 'lock-fixture.json');
    if (!within(this.testRoot, path)) throw new Error('test_workspace_denied');
    return { path, data: existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as Record<string, LockHolder[]> : {} };
  }
  async holders(lockFiles: string[]) {
    return Object.fromEntries(lockFiles.map(file => [file, this.state(file).data[basename(file, '.lock')] ?? []]));
  }
  async end(holder: LockHolder, lockFile: string) {
    const { path, data } = this.state(lockFile);
    const home = dirname(path);
    for (const id of Object.keys(data)) data[id] = data[id]!.filter(other => !sameProcess(other, holder));
    writeFileSync(path, JSON.stringify(data));
    appendFileSync(join(home, 'ended.jsonl'), JSON.stringify(holder) + '\n');
    rmSync(join(home, 'open'), { force: true });
    return true;
  }
}
