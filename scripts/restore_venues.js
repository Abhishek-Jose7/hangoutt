/**
 * Restores OLA venues that were over-aggressively hidden by clean_db.js.
 * Re-enables venues with NULL/low ratings that have no genuinely-bad name patterns.
 * Run: node scripts/restore_venues.js
 */
'use strict';

const path = require('path');
const Database = require('better-sqlite3');
const db = new Database(path.resolve(__dirname, '../local.db'));

const before = db.prepare(`SELECT COUNT(*) as n FROM places WHERE is_hidden = 1 AND source_name = 'OLA'`).get();
console.log(`Hidden OLA venues before restore: ${before.n}`);

// Restore hidden OLA venues unless their name contains a genuinely bad pattern
const KEEP_HIDDEN = [
  '%corporate park%', '%corporate tower%', '%corporate hub%',
  '%cable vision%', '%cable tv%', '%cable network%', '%infotainment%',
  '%puppeteer%', '%ventriloquist%', '%puppet-maker%',
  '%metro station%', '%railway station%', '%bus stand%', '%bus terminal%', '%bus depot%',
  '%airport lounge%', '%airport terminal%',
  '%apartment%', '% apts%', '%housing society%', '%co-op housing%', '%chawl%',
  '%pvt ltd%', '%pvt. ltd%',
  '%kidzania%', '%smaaash junior%', '%kids play area%',
  '%delivery only%', '%cloud kitchen%', '%takeaway only%',
  '%gate no %', '%garden gate%',
  '%maidan%',
];

const whereClauses = KEEP_HIDDEN.map(p => `LOWER(name) NOT LIKE '${p}'`).join('\n  AND ');

const sql = `
  UPDATE places
  SET is_hidden = 0
  WHERE is_hidden = 1
    AND source_name = 'OLA'
    AND ${whereClauses}
`;

const result = db.prepare(sql).run();
console.log(`Restored ${result.changes} venues.`);

const after = db.prepare(`SELECT COUNT(*) as n FROM places WHERE is_hidden = 1 AND source_name = 'OLA'`).get();
console.log(`Hidden OLA venues after restore: ${after.n}`);

const visible = db.prepare('SELECT COUNT(*) as n FROM places WHERE is_hidden = 0').get();
console.log(`Total visible venues: ${visible.n}`);

db.close();
