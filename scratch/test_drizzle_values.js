const Database = require('better-sqlite3');
const { drizzle } = require('drizzle-orm/better-sqlite3');
const sqlite = new Database('local.db');
const db = drizzle(sqlite);

try {
  const dbMigrations = db.session.values(
    require('drizzle-orm').sql`SELECT id, hash, created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1`
  );
  console.log('dbMigrations:', dbMigrations);
} catch (err) {
  console.error(err);
} finally {
  sqlite.close();
}
