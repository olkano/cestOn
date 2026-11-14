import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parseConfig } from '../packages/contracts/src/config.js';
import { DomainError } from '../packages/contracts/src/commands.js';
import { createTestRoot, cleanupTestRoot } from '../packages/test-support/src/index.js';
import { probeConfinement } from '../apps/broker/src/confinement.js';
const executable = process.env.CESTON_HOST_EXECUTABLE; if (!executable) throw new Error('Set CESTON_HOST_EXECUTABLE to the pinned Codex executable. This probe makes zero model requests.');
const t = createTestRoot(); let result: unknown;
try { const config = parseConfig({ executionHost: { codexExecutable: resolve(executable), version: '0.160.0' } }); result = await probeConfinement(t.root, config); }
catch (error) { result = { state: 'blocked', gate: error instanceof DomainError ? error.code : 'confinement_not_proved', modelTurns: 0 }; process.exitCode = 2; }
finally { cleanupTestRoot(t.root, t.runId); }
const directory = resolve('zz_Specifications/evidence-private'); mkdirSync(directory, { recursive: true }); const path = join(directory, `execution-host-${Date.now()}.json`); writeFileSync(path, JSON.stringify({ result, cleanup: 'pass', platform: process.platform, runtime: process.version }, null, 2), { flag: 'wx' }); console.log(JSON.stringify({ result, evidence: path }));
