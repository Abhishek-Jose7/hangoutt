import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  try {
    const dbPath = process.env.DB_LOCAL_PATH || './local.db';
    console.log(`Opening SQLite database at: ${dbPath}`);
    const sqlite = new Database(dbPath);

    const sqlPath = path.join(__dirname, 'curated_seed.sql');
    console.log(`Reading SQL seed file from: ${sqlPath}`);
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log('Executing SQL seed...');
    sqlite.exec(sql);
    console.log('Seed applied successfully to local database.');
  } catch (err) {
    console.error('Error applying seed:', err);
    process.exit(1);
  }
}

main();
