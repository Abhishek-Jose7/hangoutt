const path = require('path');
const Database = require('better-sqlite3');

function run() {
  const dbPath = path.resolve(__dirname, '../local.db');
  const db = new Database(dbPath);

  const total = db.prepare("SELECT COUNT(*) as count FROM places").get().count;
  const hidden = db.prepare("SELECT COUNT(*) as count FROM places WHERE is_hidden = 1").get().count;
  const ratingBelow4 = db.prepare("SELECT COUNT(*) as count FROM places WHERE rating < 4.0 AND rating > 0").get().count;
  const reviewBelow20 = db.prepare("SELECT COUNT(*) as count FROM places WHERE review_count < 20 AND review_count > 0").get().count;
  
  // count how many are rejected by: p.rating && p.rating > 0 && (p.reviewCount ?? 0) > 0 && (p.rating < 4.0 || (p.reviewCount ?? 0) < 20)
  const rejectedQuality = db.prepare(`
    SELECT COUNT(*) as count FROM places 
    WHERE rating IS NOT NULL AND rating > 0 
      AND review_count IS NOT NULL AND review_count > 0 
      AND (rating < 4.0 OR review_count < 20)
  `).get().count;

  console.log(`Total places: ${total}`);
  console.log(`Hidden places: ${hidden}`);
  console.log(`Places with rating < 4.0: ${ratingBelow4}`);
  console.log(`Places with review_count < 20: ${reviewBelow20}`);
  console.log(`Places rejected by quality gate (rating < 4 or reviews < 20): ${rejectedQuality}`);

  db.close();
}

run();
