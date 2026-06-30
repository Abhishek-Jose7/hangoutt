const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

function run() {
  const dbPath = path.resolve(__dirname, '../local.db');
  console.log(`Connecting to local database: ${dbPath}`);
  const db = new Database(dbPath);
  
  // 1. Check schema & apply missing tables/columns
  const tableInfo = db.prepare("PRAGMA table_info(places)").all();
  const hasBusinessStatus = tableInfo.some(c => c.name === 'business_status');
  
  if (!hasBusinessStatus) {
    console.log('Applying 0015_self_healing.sql to local.db...');
    const migration15Path = path.resolve(__dirname, '../drizzle/migrations/0015_self_healing.sql');
    const sql15 = fs.readFileSync(migration15Path, 'utf8');
    const statements15 = sql15.split('--> statement-breakpoint');
    
    db.transaction(() => {
      for (const statement of statements15) {
        const cleaned = statement.replace(/--.*$/gm, '').trim();
        if (cleaned) {
          try {
            db.prepare(cleaned).run();
          } catch (err) {
            if (err.message.includes('already exists') || err.message.includes('duplicate column name')) {
              console.log(`  Skipping existing entity: ${err.message}`);
            } else {
              throw err;
            }
          }
        }
      }
    })();
    console.log('Successfully applied 0015 migration schema changes.');
  } else {
    console.log('0015 migration schema changes already exist in local.db.');
  }

  // Check unique index for 0016
  const indexes = db.prepare("PRAGMA index_list(place_categories)").all();
  const hasUniquePlaceCat = indexes.some(idx => idx.name === 'place_categories_place_cat_idx');
  
  if (!hasUniquePlaceCat) {
    console.log('Applying 0016_place_cat_unique.sql to local.db...');
    const migration16Path = path.resolve(__dirname, '../drizzle/migrations/0016_place_cat_unique.sql');
    const sql16 = fs.readFileSync(migration16Path, 'utf8');
    const statements16 = sql16.split('--> statement-breakpoint');
    
    db.transaction(() => {
      for (const statement of statements16) {
        const cleaned = statement.replace(/--.*$/gm, '').trim();
        if (cleaned) {
          try {
            db.prepare(cleaned).run();
          } catch (err) {
            if (err.message.includes('already exists') || err.message.includes('duplicate column name')) {
              console.log(`  Skipping existing entity: ${err.message}`);
            } else {
              throw err;
            }
          }
        }
      }
    })();
    console.log('Successfully applied 0016 migration schema changes.');
  } else {
    console.log('0016 migration schema changes already exist in local.db.');
  }

  // 2. Track migrations in __drizzle_migrations
  const appliedMigrations = db.prepare("SELECT hash FROM __drizzle_migrations").all().map(r => r.hash);
  
  const m15Content = fs.readFileSync(path.resolve(__dirname, '../drizzle/migrations/0015_self_healing.sql'), 'utf8');
  const hash15 = crypto.createHash('sha256').update(m15Content).digest('hex');
  
  const m16Content = fs.readFileSync(path.resolve(__dirname, '../drizzle/migrations/0016_place_cat_unique.sql'), 'utf8');
  const hash16 = crypto.createHash('sha256').update(m16Content).digest('hex');
  
  if (!appliedMigrations.includes(hash15)) {
    console.log('Inserting 0015_self_healing migration tracker into __drizzle_migrations...');
    db.prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)").run(hash15, Date.now());
  }
  
  if (!appliedMigrations.includes(hash16)) {
    console.log('Inserting 0016_place_cat_unique migration tracker into __drizzle_migrations...');
    db.prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)").run(hash16, Date.now());
  }
  
  db.close();
  
  // 3. Update drizzle/migrations/meta/_journal.json
  const journalPath = path.resolve(__dirname, '../drizzle/migrations/meta/_journal.json');
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
  
  const hasJournal15 = journal.entries.some(e => e.tag === '0015_self_healing');
  const hasJournal16 = journal.entries.some(e => e.tag === '0016_place_cat_unique');
  
  let journalUpdated = false;
  if (!hasJournal15) {
    journal.entries.push({
      idx: 15,
      version: "6",
      when: Date.now(),
      tag: "0015_self_healing",
      breakpoints: true
    });
    journalUpdated = true;
    console.log('Added 0015_self_healing to migration journal.');
  }
  
  if (!hasJournal16) {
    journal.entries.push({
      idx: 16,
      version: "6",
      when: Date.now(),
      tag: "0016_place_cat_unique",
      breakpoints: true
    });
    journalUpdated = true;
    console.log('Added 0016_place_cat_unique to migration journal.');
  }
  
  if (journalUpdated) {
    fs.writeFileSync(journalPath, JSON.stringify(journal, null, 2));
    console.log('Successfully updated migration journal _journal.json.');
  } else {
    console.log('Migration journal _journal.json is already up to date.');
  }
  
  console.log('Sync complete!');
}

run();
