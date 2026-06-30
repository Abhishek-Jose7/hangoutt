const { execSync } = require('child_process');
const Database = require('better-sqlite3');
const path = require('path');

function fetchRemoteTable(tableName) {
  console.log(`Fetching remote table: ${tableName}...`);
  try {
    const raw = execSync(`npx wrangler d1 execute hangout-dev --remote --command="SELECT * FROM ${tableName};" --json`, { maxBuffer: 10 * 1024 * 1024, encoding: 'utf8' });
    // Parse wrangler json output
    const data = JSON.parse(raw);
    return data[0]?.results || [];
  } catch (err) {
    console.error(`Error fetching table ${tableName}:`, err.message);
    return [];
  }
}

function run() {
  const dbPath = path.resolve(__dirname, '../local.db');
  console.log(`Connecting to local database: ${dbPath}`);
  const localDb = new Database(dbPath);
  
  // Disable foreign keys temporarily during sync to avoid cascade issues
  localDb.pragma('foreign_keys = OFF');
  
  const tables = ['places', 'place_categories', 'place_costs', 'place_scores', 'zones'];
  
  for (const table of tables) {
    const rows = fetchRemoteTable(table);
    if (rows.length === 0) {
      console.log(`No rows fetched for ${table}, skipping sync.`);
      continue;
    }
    
    console.log(`Writing ${rows.length} rows to local table ${table}...`);
    localDb.prepare(`DELETE FROM ${table}`).run();
    
    const cols = Object.keys(rows[0]);
    const placeholders = cols.map(() => '?').join(', ');
    const insertStmt = localDb.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`);
    
    localDb.transaction(() => {
      for (const row of rows) {
        const vals = cols.map(c => row[c]);
        insertStmt.run(...vals);
      }
    })();
    console.log(`Completed sync of table ${table}.`);
  }
  
  localDb.pragma('foreign_keys = ON');
  localDb.close();
  console.log('Database sync complete!');
}

run();
