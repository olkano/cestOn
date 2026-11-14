import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { childEnvironment } from './policy/index.js';

export type ProcessIdentity = { pid: number; startedAt: string };
export async function processIdentity(pid: number): Promise<ProcessIdentity | null> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  try {
    if (process.platform === 'win32') {
      const result = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '$targetProcess = Get-Process -Id ([int]$env:CESTON_PROCESS_ID) -ErrorAction Stop; [Console]::Write($targetProcess.StartTime.ToUniversalTime().Ticks.ToString())'], { env: { ...childEnvironment(process.env), CESTON_PROCESS_ID: String(pid) }, timeout: 5000, windowsHide: true });
      return { pid, startedAt: result.stdout.trim() };
    }
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return { pid, startedAt: stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]! };
  } catch { return null; }
}
export async function sameProcess(expected: ProcessIdentity) { const actual = await processIdentity(expected.pid); return actual?.startedAt === expected.startedAt; }
