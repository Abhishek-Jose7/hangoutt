const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const d1Dir = path.resolve(__dirname, '../.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
const files = fs.readdirSync(d1Dir);
const sqliteFile = files.find(f => f.endsWith('.sqlite') && f !== 'metadata.sqlite');

if (!sqliteFile) {
  console.log('No D1 SQLite database file found.');
  process.exit(0);
}

const dbPath = path.join(d1Dir, sqliteFile);
console.log('Opening D1 database at:', dbPath);
const db = new Database(dbPath);

try {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  console.log('Tables and row counts:');
  for (const t of tables) {
    const count = db.prepare(`SELECT COUNT(*) as cnt FROM "${t.name}"`).get();
    console.log(`- ${t.name}: ${count.cnt} rows`);
  }
} catch (err) {
  console.error(err);
} finally {
  db.close();
}
