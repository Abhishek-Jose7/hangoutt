const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.resolve(__dirname, '../local.db');
const db = new Database(dbPath);

const groupId = 'a2d96c81-6041-410d-b4d5-3137c56e798e';

console.log('Querying all groups...');
const allGroups = db.prepare('SELECT * FROM groups').all();
console.log('All Groups:', allGroups.map(g => ({ id: g.id, name: g.name, code: g.invite_code })));

console.log('Querying group details for target ID:', groupId);
const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
console.log('Group:', group);

console.log('\nQuerying members...');
const members = db.prepare('SELECT * FROM group_members WHERE group_id = ?').all(groupId);
console.log('Members count:', members.length);
members.forEach(m => console.log(`Member: user_id=${m.user_id}, role=${m.role}, vibes=${m.vibes}`));

console.log('\nQuerying member locations...');
const locations = db.prepare('SELECT * FROM locations WHERE group_id = ?').all(groupId);
locations.forEach(loc => console.log(`Location: user_id=${loc.user_id}, lat=${loc.lat}, lng=${loc.lng}, name=${loc.location_name}`));

console.log('\nQuerying group budgets...');
const budgets = db.prepare('SELECT * FROM budgets WHERE group_id = ?').all(groupId);
budgets.forEach(b => console.log(`Budget: user_id=${b.user_id}, max=${b.max_budget}, travel_included=${b.travel_included}`));

console.log('\nQuerying existing plans...');
const plans = db.prepare('SELECT * FROM plans WHERE group_id = ?').all(groupId);
plans.forEach(p => {
  console.log(`Plan Index: ${p.plan_index}, Name: ${p.name}, Tagline: ${p.tagline}, MeetupZone: ${p.meetup_zone}, BudgetTier: ${p.budget_tier}, Cost: ${p.total_estimated_cost_per_head}`);
  const slots = db.prepare('SELECT * FROM plan_slots WHERE plan_id = ? ORDER BY slot_order').all(p.id);
  slots.forEach(s => {
    console.log(`  Slot ${s.slot_order}: ${s.name} (${s.category}), arrival: ${s.arrival_time}, cost: ${s.estimated_cost_per_head}, img: ${s.image_url}`);
  });
});
