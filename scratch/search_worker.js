const fs = require('fs');
const content = fs.readFileSync('workers/api.ts', 'utf8');
const lines = content.split('\n');
lines.forEach((line, idx) => {
  if (line.includes('/admin/places') || line.includes('admin/places') || line.includes('getAdminPlaces') || line.includes('discoverZonePlaces')) {
    console.log(`${idx + 1}: ${line}`);
  }
});
