const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const JUNK_KEYWORDS = [
  ' chs', 'chs ', 'c.h.s', 'society', 'apartment', 'apts', 'residency', 'residences',
  'tower', 'villa', 'bungalow', 'chawl', 'building', 'bldg', 'flat', 'house',
  'pvt ltd', 'pvt. ltd', 'limited', 'ltd.', 'corporate', 'office', 'knowledge park',
  'business park', 'refinery', 'station', 'bus stand', 'bus depot', 'bus terminal',
  'railway', 'metro', 'monorail', 'rickshaw', 'auto stand', 'parking', 'highway',
  'flyover', 'bridge', 'gate no', ' gate 1', ' gate 2', 'durga puja', 'canteen', 'mess',
  'rto', 'delivery only', 'cloud kitchen', 'takeaway only', 'goat farm', 'cisf',
  'monginis', 'ribbons & balloons', 'souffle cake', 'cake shop', 'cake counter', 'cake express',
  'al fresco', 'al sadah', 'argent silver', 'arthur road', '90ft balaji',
  'abcd', 'imagica', 'vastu park', 'abrol vastu', 'auditorium', 'selfie point', 'selfie',
  'sathrasta', 'transit', 'compound', 'estate', 'marriage hall', 'banquet hall', 'community hall'
];

function isJunk(name, address) {
  const n = name.toLowerCase();
  const a = (address || '').toLowerCase();
  
  if (JUNK_KEYWORDS.some(k => n.includes(k) || a.includes(k))) return true;
  
  // Plazas / markets whitelist
  if (n.includes('plaza') || n.includes('market')) {
    const whitelist = ['cinema', 'theatre', 'multiplex', 'phoenix marketcity', 'jio world plaza', 'palladium', 'mall', 'dosa plaza'];
    if (!whitelist.some(w => n.includes(w))) {
      return true;
    }
  }
  
  // Roads / Streets filter: if name is just a street/road name
  if ((n.endsWith(' road') || n.endsWith(' rd') || n.endsWith(' marg') || n.endsWith(' lane') || n.endsWith(' path')) && 
      !n.includes('cafe') && !n.includes('restaurant') && !n.includes('hotel') && !n.includes('diner') && !n.includes('bar') && !n.includes('eats')) {
    return true;
  }
  
  return false;
}

function run() {
  const dbPath = path.resolve(__dirname, '../local.db');
  console.log(`Cleaning local database: ${dbPath}`);
  const localDb = new Database(dbPath);
  
  const places = localDb.prepare("SELECT id, name, address, source_name FROM places WHERE source_name = 'OLA'").all();
  
  let hiddenCount = 0;
  let restoredCount = 0;
  
  const hideStmt = localDb.prepare("UPDATE places SET is_hidden = 1 WHERE id = ?");
  const restoreStmt = localDb.prepare("UPDATE places SET is_hidden = 0 WHERE id = ?");
  
  const remoteSqlLines = [];
  
  localDb.transaction(() => {
    for (const p of places) {
      if (isJunk(p.name, p.address)) {
        hideStmt.run(p.id);
        remoteSqlLines.push(`UPDATE places SET is_hidden = 1 WHERE id = '${p.id}';`);
        hiddenCount++;
      } else {
        restoreStmt.run(p.id);
        remoteSqlLines.push(`UPDATE places SET is_hidden = 0 WHERE id = '${p.id}';`);
        restoredCount++;
      }
    }
  })();
  
  console.log(`Local DB: Hidden ${hiddenCount} junk places, Unhidden/Restored ${restoredCount} clean places.`);
  localDb.close();
  
  if (remoteSqlLines.length > 0) {
    console.log(`Uploading cleanup updates to remote D1...`);
    const tempSqlFile = path.resolve(__dirname, 'ola_cleanup.sql');
    fs.writeFileSync(tempSqlFile, remoteSqlLines.join('\n'));
    
    try {
      const res = execSync(`npx wrangler d1 execute hangout-dev --remote --file="${tempSqlFile}"`, { encoding: 'utf8' });
      console.log('Remote D1 update success!');
    } catch (err) {
      console.error('Remote D1 update failed:', err.message);
    } finally {
      try { fs.unlinkSync(tempSqlFile); } catch (_) {}
    }
  }
  
  console.log('Cleanup complete!');
}

run();
