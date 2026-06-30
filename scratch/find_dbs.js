const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const fullPath = path.join(dir, file);
    if (file === 'node_modules' || file === '.git' || file === '.ideos') return;
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(fullPath));
    } else {
      if (file.endsWith('.db') || file.endsWith('.sqlite')) {
        results.push(fullPath);
      }
    }
  });
  return results;
}

const dbs = walk(path.resolve(__dirname, '..'));
console.log('Found database files:', dbs);
