const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.resolve(__dirname, '../local.db');
const db = new Database(dbPath);

// Find the group
const group = db.prepare("SELECT * FROM groups WHERE name = 'sapna ki mkc' OR id = '29642864' LIMIT 1").get();
if (!group) {
  console.error("Group not found");
  db.close();
  return;
}
console.log(`Found Group: id=${group.id}, name=${group.name}, status=${group.status}`);

const members = db.prepare("SELECT * FROM group_members WHERE group_id = ?").all(group.id);
console.log(`Members count: ${members.length}`);

const budgets = db.prepare("SELECT * FROM budgets WHERE group_id = ?").all(group.id);
console.log(`Budgets:`, budgets);

const locations = db.prepare("SELECT * FROM locations WHERE group_id = ?").all(group.id);
console.log(`Locations:`, locations);

db.close();
