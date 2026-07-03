const fs = require('fs');
const path = require('path');

const filePath = path.resolve(__dirname, '../src/app/(app)/groups/[id]/page.tsx');
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');

console.log('Searching for "members" or "budget":');
lines.forEach((line, i) => {
  if (line.toLowerCase().includes('members') || line.toLowerCase().includes('budget') || line.toLowerCase().includes('sync')) {
    console.log(`${i + 1}: ${line.trim()}`);
  }
});
