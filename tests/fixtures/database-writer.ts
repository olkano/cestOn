import Database from 'better-sqlite3';
import { join } from 'node:path';
import { assertTestRoot } from '../../packages/test-support/src/index.js';
const root = process.argv[2]!; assertTestRoot(root); const db = new Database(join(root, 'state/ceston.sqlite')); db.exec('BEGIN IMMEDIATE'); db.prepare('UPDATE installations SET revision=revision+1').run(); process.send?.({ locked: true }); setTimeout(() => { db.exec('COMMIT'); db.close(); if (process.connected) process.disconnect(); }, 500);
