const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.resolve(__dirname, '../.scar/db.sqlite');
console.log('Opening DB at:', dbPath);
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
