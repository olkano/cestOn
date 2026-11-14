import Database from 'better-sqlite3';
const database = new Database(':memory:');
try { const version = database.prepare('SELECT sqlite_version() AS version').get().version; console.log(JSON.stringify({ sqlite: version, platform: process.platform, architecture: process.arch, runtime: process.version, result: 'native_binding_loaded', installScriptsExecuted: false })); }
finally { database.close(); }
