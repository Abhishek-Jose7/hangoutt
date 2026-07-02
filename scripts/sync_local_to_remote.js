const { execSync } = require('child_process');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

function sqlString(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function run() {
  const dbPath = path.resolve(__dirname, '../local.db');
  console.log(`Connecting to local database: ${dbPath}`);
  const localDb = new Database(dbPath);

  // Tables to sync
  const tables = ['places', 'place_categories', 'place_costs', 'place_scores'];
  const sqlLines = [];

  for (const table of tables) {
    console.log(`Reading rows from local table: ${table}...`);
    try {
      const rows = localDb.prepare(`SELECT * FROM ${table}`).all();
      if (rows.length === 0) {
        console.log(`No rows in local table ${table}, skipping.`);
        continue;
      }

      console.log(`Formatting ${rows.length} rows from table ${table}...`);
      const cols = Object.keys(rows[0]);

      for (const row of rows) {
        if (table === 'places') {
          row.image_data = null;
        }
        const vals = cols.map(c => sqlString(row[c]));
        // Use INSERT OR IGNORE for categories/places, and INSERT OR REPLACE for costs/scores
        const verb = ['place_costs', 'place_scores'].includes(table) ? 'INSERT OR REPLACE' : 'INSERT OR IGNORE';
        sqlLines.push(`${verb} INTO ${table} (${cols.join(', ')}) VALUES (${vals.join(', ')});`);
      }
    } catch (err) {
      console.error(`Error reading local table ${table}:`, err.message);
    }
  }

  localDb.close();

  if (sqlLines.length === 0) {
    console.log('No SQL statements to execute.');
    return;
  }

  console.log(`Total SQL statements generated: ${sqlLines.length}`);

  const BATCH_SIZE = 1000;
  const totalBatches = Math.ceil(sqlLines.length / BATCH_SIZE);
  console.log(`Starting sync in ${totalBatches} batches (batch size: ${BATCH_SIZE})...`);

  for (let i = 0; i < sqlLines.length; i += BATCH_SIZE) {
    const batchIndex = Math.floor(i / BATCH_SIZE);
    const chunk = sqlLines.slice(i, i + BATCH_SIZE);
    const sqlPath = path.resolve(__dirname, `sync_local_batch_${batchIndex}_${Date.now()}.sql`);

    console.log(`[Batch ${batchIndex + 1}/${totalBatches}] Writing ${chunk.length} statements...`);
    fs.writeFileSync(sqlPath, chunk.join('\n'));

    try {
      // Use --yes to skip interactive prompts
      execSync(`npx wrangler d1 execute hangout-dev --remote --file="${sqlPath}" --yes`, { stdio: 'inherit' });
      console.log(`[Batch ${batchIndex + 1}/${totalBatches}] Executed successfully.`);
    } catch (err) {
      console.error(`[Batch ${batchIndex + 1}/${totalBatches}] Execution failed:`, err.message);
      throw err; // Abort on error
    } finally {
      try {
        fs.unlinkSync(sqlPath);
      } catch {}
    }
  }

  console.log('\nRemote D1 database sync complete!');
}

run();
