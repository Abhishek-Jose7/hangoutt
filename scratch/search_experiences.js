const fs = require('fs');
const content = fs.readFileSync('workers/api.ts', 'utf8');
const lines = content.split('\n');
lines.forEach((line, idx) => {
  if (line.includes('discoverExperiences') || line.includes('rebuildFeaturedExperiences') || line.includes('featuredExperiences')) {
    console.log(`${idx + 1}: ${line}`);
  }
});
