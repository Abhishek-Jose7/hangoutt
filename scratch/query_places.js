'use strict';
const path = require('path');
const Database = require('better-sqlite3');

function run() {
  const dbPath = path.resolve(__dirname, '../local.db');
  const db = new Database(dbPath);

  // Check if any image_url contains '%'
  const percentRows = db.prepare("SELECT COUNT(*) as n FROM places WHERE image_url LIKE '%\\%%' ESCAPE '\\'").get();
  console.log(`Places with image_url containing '%' (encoded characters): ${percentRows.n}`);

  // Print a few examples of image_url containing '%'
  if (percentRows.n > 0) {
    const examples = db.prepare("SELECT id, name, image_url FROM places WHERE image_url LIKE '%\\%%' ESCAPE '\\' LIMIT 5").all();
    examples.forEach(r => {
      console.log(`- ${r.name}: ${r.image_url}`);
    });
  }

  db.close();
}

run();
