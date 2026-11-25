import type { ChildProcess } from 'node:child_process';
import { DomainError } from '../../../packages/contracts/src/commands.js';

type Channel = { connected: boolean; send?: (message: unknown) => unknown };

// The starter (the CLI or the Windows sign-in task) waits a limited time for this message. A slower start outlives it,
// and a send on the closed channel raises an unhandled error that would end the supervisor just as it became ready.
export function reportReady(message: { ready: true; recovery?: true }, channel: Channel = process) {
  if (channel.connected) channel.send?.(message);
}

// Waits for a forked supervisor to report ready. Whatever the outcome, the starter lets go of it, so a start slower than
// the wait leaves the supervisor running and the starter exits instead of holding the channel open.
export async function awaitReady(child: ChildProcess, timeout = 60000) {
  try {
    await new Promise<void>((done, reject) => {
      const timer = setTimeout(() => reject(new DomainError('supervisor_start_pending', 503)), timeout);
      const fail = () => { clearTimeout(timer); reject(new DomainError('supervisor_start_failed', 503)); };
      child.once('error', fail);
      child.once('exit', fail);
      child.once('message', message => { clearTimeout(timer); if ((message as { ready?: boolean }).ready) done(); else fail(); });
    });
  } finally {
    if (child.connected) child.disconnect();
    child.unref();
  }
}
