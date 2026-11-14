import Database from 'better-sqlite3';
import { statfsSync } from 'node:fs';
import { parseConfig } from '../packages/contracts/src/config.js';

const db = new Database(':memory:');
try {
  const checks = [
    { capability: 'node', status: Number(process.versions.node.split('.')[0]) === 24 ? 'ready' : 'blocked', version: process.versions.node },
    { capability: 'sqlite', status: db.pragma('integrity_check', { simple: true }) === 'ok' ? 'ready' : 'blocked', version: (db.prepare('select sqlite_version() as version').get() as { version: string }).version },
    { capability: 'disk', status: statfsSync('.').bavail > 0 ? 'ready' : 'blocked' },
    { capability: 'configuration', status: parseConfig({}) ? 'ready' : 'blocked' },
    { capability: 'managed_execution', status: 'blocked', reason: 'No certified provider profile configured' },
  ];
  console.log(JSON.stringify({ checks }, null, 2));
} finally { db.close(); }
