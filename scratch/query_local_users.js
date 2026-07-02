const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.resolve(__dirname, '../local.db');
const db = new Database(dbPath);

console.log('Querying users from local.db...');
const rows = db.prepare('SELECT id, name, clerk_id FROM users').all();
console.log('Users:', rows);
