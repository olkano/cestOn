import { spawn } from 'node:child_process';
export async function run(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): Promise<void> {
  const result = spawn(command, args, { stdio: 'inherit', shell: false, ...options });
  await new Promise<void>((resolve, reject) => { result.once('error', reject); result.once('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))); });
}
export async function npmScript(script: string) { await run(process.execPath, [process.env.npm_execpath ?? 'node_modules/npm/bin/npm-cli.js', 'run', script]); }
