const Database = require('better-sqlite3');
const { drizzle } = require('drizzle-orm/better-sqlite3');
const sqlite = new Database('local.db');
const db = drizzle(sqlite);
const fs = require('fs');

const config = { migrationsFolder: './drizzle/migrations' };
const migrations = require('drizzle-orm/migrator').readMigrationFiles(config);

const dbMigrations = db.session.values(
  require('drizzle-orm').sql`SELECT id, hash, created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1`
);
const lastDbMigration = dbMigrations[0] ?? undefined;
console.log('lastDbMigration in driver:', lastDbMigration);

for (const migration of migrations) {
  const needsRunning = !lastDbMigration || Number(lastDbMigration[2]) < migration.folderMillis;
  console.log(`Migration ${migration.hash.slice(0,8)} (millis: ${migration.folderMillis}): needsRunning = ${needsRunning}`);
}

sqlite.close();
