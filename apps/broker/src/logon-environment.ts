import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { windowsHelperEnvironment } from './windows-environment.js';

const run = promisify(execFile);

// cestOn's own processes run with a minimal environment. A chat reply runs the provider as the owner would in
// VS Code, so it gets the environment Windows builds for the owner's logon (CreateEnvironmentBlock), with the
// provider home set on top.
// Windows names are case-insensitive and a child sees only one of two spellings, so the last value given for a name wins.
export function replyEnvironment(logon: NodeJS.ProcessEnv | undefined, fallback: NodeJS.ProcessEnv, overrides: Record<string, string>, windows = process.platform === 'win32'): NodeJS.ProcessEnv {
  const result = new Map<string, [string, string]>();
  for (const [name, value] of [...Object.entries(logon ?? fallback), ...Object.entries(overrides)]) {
    if (value === undefined) continue;
    const key = windows ? name.toUpperCase() : name;
    result.delete(key);
    result.set(key, [name, value]);
  }
  return Object.fromEntries(result.values());
}

const script = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class CestonLogonEnvironment {
  [DllImport("userenv.dll", SetLastError = true)] static extern bool CreateEnvironmentBlock(out IntPtr block, IntPtr token, bool inherit);
  [DllImport("userenv.dll", SetLastError = true)] static extern bool DestroyEnvironmentBlock(IntPtr block);
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  public static Dictionary<string, string> Read() {
    IntPtr token;
    if (!OpenProcessToken(GetCurrentProcess(), 0x000E, out token)) throw new Exception("token unavailable");
    IntPtr block;
    try { if (!CreateEnvironmentBlock(out block, token, false)) throw new Exception("environment unavailable"); }
    finally { CloseHandle(token); }
    var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    try {
      var at = block;
      while (true) {
        var entry = Marshal.PtrToStringUni(at);
        if (string.IsNullOrEmpty(entry)) break;
        var split = entry.IndexOf('=', 1);
        if (split > 0) result[entry.Substring(0, split)] = entry.Substring(split + 1);
        at = IntPtr.Add(at, (entry.Length + 1) * 2);
      }
    } finally { DestroyEnvironmentBlock(block); }
    return result;
  }
}
'@
[Console]::Out.Write((@{ environment = [CestonLogonEnvironment]::Read() } | ConvertTo-Json -Compress))
`;

export async function windowsLogonEnvironment(): Promise<NodeJS.ProcessEnv> {
  const shell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const { stdout } = await run(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
    env: windowsHelperEnvironment(), windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024,
  });
  const environment = (JSON.parse(stdout) as { environment?: Record<string, unknown> }).environment ?? {};
  const result = Object.fromEntries(Object.entries(environment).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  if (!Object.keys(result).some(name => name.toUpperCase() === 'PATH')) throw new Error('logon_environment_incomplete');
  return result;
}
