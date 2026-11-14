import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const checkpoint = JSON.parse(readFileSync('zz_Specifications/implementation-progress.json', 'utf8')) as Record<string, unknown>;
console.log(JSON.stringify({ ...checkpoint, head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), workingTree: execFileSync('git', ['status', '--short'], { encoding: 'utf8' }).trim(), instructions: 'Read implementation-run.md and implementation-status.md before resuming. Never infer acceptance from file presence.' }, null, 2));
