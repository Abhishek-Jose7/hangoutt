const Database = require('better-sqlite3');
const db = new Database('local.db');
const fs = require('fs');

const journal = JSON.parse(fs.readFileSync('drizzle/migrations/meta/_journal.json').toString());
const lastDbMigration = db.prepare('SELECT id, hash, created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1').get();

console.log('lastDbMigration:', lastDbMigration);

for (const entry of journal.entries) {
  const folderMillis = entry.when;
  const isApplied = lastDbMigration && Number(lastDbMigration.created_at) >= folderMillis;
  console.log(`Migration ${entry.tag}: when=${folderMillis}, isApplied=${isApplied}`);
}

db.close();
