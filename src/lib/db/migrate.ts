import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import path from 'path';

function runMigrations() {
  const dbPath = process.env.DB_LOCAL_PATH || './local.db';
  const sqlite = new Database(dbPath);
  const db = drizzle(sqlite);

  console.log('Running local migrations...');
  try {
    migrate(db, {
      migrationsFolder: path.join(process.cwd(), './drizzle/migrations'),
    });
    console.log('Migrations completed successfully.');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    sqlite.close();
  }
}

runMigrations();
