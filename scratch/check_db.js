'use strict';
const path = require('path');
const Database = require('better-sqlite3');

function run() {
  const dbPath = path.resolve(__dirname, '../local.db');
  console.log(`Inspecting database: ${dbPath}`);
  const db = new Database(dbPath);

  const totalPlaces = db.prepare("SELECT COUNT(*) as n FROM places").get();
  const visiblePlaces = db.prepare("SELECT COUNT(*) as n FROM places WHERE is_hidden = 0").get();
  const hiddenPlaces = db.prepare("SELECT COUNT(*) as n FROM places WHERE is_hidden = 1").get();
  const withImages = db.prepare("SELECT COUNT(*) as n FROM places WHERE is_hidden = 0 AND image_url IS NOT NULL AND image_url != ''").get();
  
  console.log(`Total places: ${totalPlaces.n}`);
  console.log(`Visible places: ${visiblePlaces.n}`);
  console.log(`Hidden places: ${hiddenPlaces.n}`);
  console.log(`Visible places with images: ${withImages.n}`);

  // Query categories of visible places
  const categories = db.prepare(`
    SELECT pc.category, COUNT(*) as n 
    FROM places p 
    JOIN place_categories pc ON pc.place_id = p.id 
    WHERE p.is_hidden = 0 
    GROUP BY pc.category
  `).all();
  console.log("\nVisible places by category:");
  categories.forEach(c => console.log(`  - ${c.category}: ${c.n}`));

  // Check fallback venues in zone_fallbacks
  const totalFallbacks = db.prepare("SELECT COUNT(*) as n FROM zone_fallbacks").get();
  console.log(`\nTotal zone fallbacks: ${totalFallbacks.n}`);

  db.close();
}

run();
