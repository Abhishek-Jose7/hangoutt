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
  
  if (n.includes('plaza') || n.includes('market')) {
    const whitelist = ['cinema', 'theatre', 'multiplex', 'phoenix marketcity', 'jio world plaza', 'palladium', 'mall', 'dosa plaza'];
    if (!whitelist.some(w => n.includes(w))) {
      return true;
    }
  }
  
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
  
  // Enable foreign keys locally for cascading deletes
  localDb.pragma('foreign_keys = ON');
  
  const places = localDb.prepare("SELECT id, name, address FROM places").all();
  
  let deletedCount = 0;
  const deleteStmt = localDb.prepare("DELETE FROM places WHERE id = ?");
  const remoteSqlLines = [];
  
  localDb.transaction(() => {
    for (const p of places) {
      if (isJunk(p.name, p.address)) {
        deleteStmt.run(p.id);
        remoteSqlLines.push(`DELETE FROM places WHERE id = '${p.id}';`);
        deletedCount++;
      }
    }
  })();
  
  console.log(`Local DB: Deleted ${deletedCount} junk places.`);
  localDb.close();
  
  if (remoteSqlLines.length > 0) {
    console.log(`Uploading deletion updates to remote D1...`);
    const tempSqlFile = path.resolve(__dirname, 'ola_delete.sql');
    fs.writeFileSync(tempSqlFile, remoteSqlLines.join('\n'));
    
    try {
      execSync(`npx wrangler d1 execute hangout-dev --remote --file="${tempSqlFile}"`, { stdio: 'inherit' });
      console.log('Remote D1 delete success!');
    } catch (err) {
      console.error('Remote D1 delete failed:', err.message);
    } finally {
      try { fs.unlinkSync(tempSqlFile); } catch (_) {}
    }
  }
  
  console.log('Cleanup complete!');
}

run();
