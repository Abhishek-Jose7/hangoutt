const path = require('path');
const Database = require('better-sqlite3');

function run() {
  const dbPath = path.resolve(__dirname, '../local.db');
  const db = new Database(dbPath);

  const total = db.prepare("SELECT COUNT(*) as count FROM places").get().count;
  const unsplashCount = db.prepare("SELECT COUNT(*) as count FROM places WHERE image_url LIKE '%unsplash.com%'").get().count;
  const googleCount = db.prepare("SELECT COUNT(*) as count FROM places WHERE image_url LIKE '%/api/places/photo%'").get().count;
  const nullCount = db.prepare("SELECT COUNT(*) as count FROM places WHERE image_url IS NULL").get().count;

  console.log(`Total places: ${total}`);
  console.log(`Unsplash image_urls: ${unsplashCount}`);
  console.log(`Google image_urls: ${googleCount}`);
  console.log(`Null image_urls: ${nullCount}`);

  if (unsplashCount > 0) {
    console.log('\nExamples of Unsplash urls in DB:');
    const examples = db.prepare("SELECT name, image_url FROM places WHERE image_url LIKE '%unsplash.com%' LIMIT 5").all();
    examples.forEach(r => console.log(`- ${r.name}: ${r.image_url}`));
  }

  db.close();
}

run();
