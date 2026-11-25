import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

type Provider = 'Codex' | 'Claude';
// VS Code runs each provider from the binary bundled with its extension, in a folder named after the extension version.
const layouts: Record<Provider, { prefix: string; file: string[] }> = {
  Codex: { prefix: 'openai.chatgpt-', file: ['bin', 'windows-x86_64', 'codex.exe'] },
  Claude: { prefix: 'anthropic.claude-code-', file: ['resources', 'native-binary', 'claude.exe'] },
};

function version(provider: Provider, folder: string) {
  const { prefix } = layouts[provider];
  if (!folder.toLowerCase().startsWith(prefix)) return undefined;
  const match = /^(\d+(?:\.\d+)*)(?:-win32-x64)?$/i.exec(folder.slice(prefix.length));
  return match ? match[1]!.split('.').map(Number) : undefined;
}
const newer = (a: number[], b: number[]) => {
  for (let index = 0; index < Math.max(a.length, b.length); index++) if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) - (b[index] ?? 0);
  return 0;
};

// Extension folders for the provider, newest version first. VS Code keeps older versions until it cleans up, and a
// reloaded window runs the newest one.
export function editorFolders(provider: Provider, folders: string[]) {
  return folders.flatMap(folder => { const parsed = version(provider, folder); return parsed ? [{ folder, parsed }] : []; })
    .sort((a, b) => newer(b.parsed, a.parsed)).map(entry => entry.folder);
}

// The provider binary the owner's VS Code uses, so a reply runs the same version, with the same models, as the chat.
export async function editorExecutable(provider: Provider, home = homedir()): Promise<string | undefined> {
  for (const root of [join(home, '.vscode', 'extensions'), join(home, '.vscode-insiders', 'extensions')]) {
    let folders: string[];
    try { folders = await readdir(root); } catch { continue; }
    for (const folder of editorFolders(provider, folders)) {
      const file = join(root, folder, ...layouts[provider].file);
      if (existsSync(file)) return file;
    }
  }
  return undefined;
}
