const fs = require('fs');
const path = require('path');

const filePath = path.resolve(__dirname, '../workers/api.ts');
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');

console.log('Searching for getGroupDetails:');
lines.forEach((line, i) => {
  if (line.includes('getGroupDetails')) {
    console.log(`${i + 1}: ${line.trim()}`);
  }
});
