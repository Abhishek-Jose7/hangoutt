const Database = require('better-sqlite3');
const db = new Database('./local.db');

try {
  console.log('=== Groups ===');
  const groups = db.prepare('SELECT * FROM groups').all();
  console.log(groups);

  console.log('=== Group Members ===');
  const members = db.prepare('SELECT * FROM group_members').all();
  console.log(members);

  console.log('=== Budgets ===');
  const budgets = db.prepare('SELECT * FROM budgets').all();
  console.log(budgets);

  console.log('=== Locations ===');
  const locations = db.prepare('SELECT * FROM locations').all();
  console.log(locations);
} catch (err) {
  console.error('Error:', err);
} finally {
  db.close();
}
