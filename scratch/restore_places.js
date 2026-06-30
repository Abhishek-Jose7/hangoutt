const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.resolve(__dirname, '../local.db');
const db = new Database(dbPath);

const badPatterns = [
  'corporate park','corporate tower','corporate hub','cable vision','cable tv',
  'cable network','infotainment','puppeteer','ventriloquist','puppet-maker',
  'metro station','railway station','bus stand','bus terminal','bus depot',
  'gate no',' gate 1',' gate 2','garden gate','world garden gate',
  'wall painting','statue structure','pvt ltd','pvt. ltd',
  'housing society','apartment',' apts','co-op housing','chawl',
  'maidan','airport lounge','airport terminal','intercity','kidzania',
  'smaaash junior','kids play area','delivery only','cloud kitchen',
  'takeaway only','singer sajan','ramdas padhye'
];

try {
  const hidden = db.prepare("SELECT id, name FROM places WHERE is_hidden = 1 AND source_name = 'OLA'").all();
  let restored = 0;
  for (const row of hidden) {
    const name = row.name.toLowerCase();
    if (!badPatterns.some(p => name.includes(p))) {
      db.prepare('UPDATE places SET is_hidden = 0 WHERE id = ?').run(row.id);
      restored++;
    }
  }
  console.log('Restored', restored, 'legitimate unrated venues');
} catch (err) {
  console.error(err);
} finally {
  db.close();
}
