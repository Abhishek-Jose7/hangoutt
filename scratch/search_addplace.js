const fs = require('fs');
const content = fs.readFileSync('workers/api.ts', 'utf8');
const lines = content.split('\n');
lines.forEach((line, idx) => {
  if (idx >= 1735 && idx <= 1850) {
    console.log(`${idx + 1}: ${line}`);
  }
});
