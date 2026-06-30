const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.resolve(__dirname, '../local.db');
console.log('Opening database at:', dbPath);

const db = new Database(dbPath);

try {
  // Check count before
  const countBefore = db.prepare('SELECT COUNT(*) as cnt FROM places WHERE is_hidden = 0').get();
  console.log(`Places count before cleanup: ${countBefore.cnt}`);

  console.log('Running SQL updates...');

  // Hide all venues with unknown/no rating (the root of the junk)
  const r1 = db.prepare(`
    UPDATE places SET is_hidden = 1
    WHERE (rating IS NULL OR rating = 0 OR review_count < 20)
      AND source_name = 'OLA'
  `).run();
  console.log(`- rating/review filter updated: ${r1.changes} rows`);

  // Hide venues with bad name patterns
  const patterns = [
    '%corporate park%', '%corporate tower%', '%corporate hub%',
    '%cable vision%', '%cable tv%', '%cable network%', '%infotainment%',
    '%puppeteer%', '%ventriloquist%', '%puppet-maker%',
    '%metro station%', '%railway station%', '%bus stand%', '%bus terminal%', '%bus depot%',
    '%gate no%', '%gate 1%', '%gate 2%', '%garden gate%',
    '%wall painting%', '%statue structure%', '%pvt ltd%', '%pvt. ltd%',
    '%housing society%', '%apartment%', '%apt%', '% apts%', '%co-op housing%', '%chawl%',
    '%maidan%', '%airport lounge%', '%airport terminal%', '%intercity%', '%kidzania%',
    '%smaaash junior%', '%kids play area%', '%delivery only%', '%cloud kitchen%',
    '%takeaway only%', '%singer sajan%', '%ramdas padhye%'
  ];

  for (const pat of patterns) {
    const r = db.prepare('UPDATE places SET is_hidden = 1 WHERE LOWER(name) LIKE ? AND is_hidden = 0').run(pat);
    if (r.changes > 0) {
      console.log(`- name pattern "${pat}" updated: ${r.changes} rows`);
    }
  }

  // Singer % pattern with rating IS NULL
  const rSinger = db.prepare("UPDATE places SET is_hidden = 1 WHERE LOWER(name) LIKE 'singer %' AND rating IS NULL AND is_hidden = 0").run();
  if (rSinger.changes > 0) {
    console.log(`- singer with no rating updated: ${rSinger.changes} rows`);
  }

  // Remove exact duplicates (keep the one with higher overall score)
  // Wait, the score is stored in place_scores or places?
  // Let's check how the user query does it:
  // UPDATE places SET is_hidden = 1 WHERE id IN (
  //   SELECT p2.id FROM places p1
  //   JOIN places p2 ON LOWER(p1.name) = LOWER(p2.name)
  //     AND p1.id != p2.id
  //     AND p1.id < p2.id
  //     AND ABS(p1.lat - p2.lat) < 0.005
  //   WHERE p2.is_hidden = 0
  // );
  const rDupes = db.prepare(`
    UPDATE places SET is_hidden = 1 WHERE id IN (
      SELECT p2.id FROM places p1
      JOIN places p2 ON LOWER(p1.name) = LOWER(p2.name)
        AND p1.id != p2.id
        AND p1.id < p2.id
        AND ABS(p1.lat - p2.lat) < 0.005
      WHERE p2.is_hidden = 0
    )
  `).run();
  console.log(`- exact duplicates updated: ${rDupes.changes} rows`);

  // Check count after
  const countAfter = db.prepare('SELECT COUNT(*) as cnt FROM places WHERE is_hidden = 0').get();
  console.log(`Places count after cleanup: ${countAfter.cnt}`);

  // Query a few remaining visible places for verification
  const sample = db.prepare('SELECT name, address, rating, review_count, source_name FROM places WHERE is_hidden = 0 LIMIT 10').all();
  console.log('\nSample of remaining visible places:');
  console.log(sample);

} catch (err) {
  console.error('Error cleaning database:', err);
} finally {
  db.close();
}
