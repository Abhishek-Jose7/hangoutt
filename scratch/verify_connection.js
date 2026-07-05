const fs = require('fs');
const path = require('path');

// Parse .env manually to avoid extra dependencies
const envPath = path.resolve(__dirname, '../.env');
const envContent = fs.readFileSync(envPath, 'utf8');

const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    const key = match[1];
    let value = match[2] || '';
    // Remove wrapping quotes if present
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    env[key] = value.trim();
  }
});

const apiUrl = env.HANGOUT_API_URL;
const apiSecret = env.HANGOUT_API_SECRET;

console.log('Verifying remote database connection using config from .env:');
console.log(`API URL: ${apiUrl}`);
console.log(`API Secret: ${apiSecret ? '***' + apiSecret.slice(-4) : 'not set'}`);

if (!apiUrl || !apiSecret) {
  console.error('ERROR: HANGOUT_API_URL or HANGOUT_API_SECRET is missing in .env');
  process.exit(1);
}

async function verify() {
  const normalizedUrl = /^https?:\/\//i.test(apiUrl) ? apiUrl : `https://${apiUrl}`;
  const url = `${normalizedUrl.replace(/\/$/, '')}/health/db`;
  
  try {
    console.log(`Fetching health status from: ${url}`);
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${apiSecret}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!res.ok) {
      console.error(`HTTP Error: ${res.status} ${res.statusText}`);
      const text = await res.text();
      console.error('Response body:', text);
      process.exit(1);
    }
    
    const payload = await res.json();
    console.log('\nResponse Payload:', JSON.stringify(payload, null, 2));
    
    if (payload.ok && payload.database?.reachable) {
      console.log('\nSUCCESS: Connected to the remote database successfully!');
    } else {
      console.error('\nFAILURE: Database is not reachable or reported an error.');
      process.exit(1);
    }
  } catch (err) {
    console.error('\nError connecting to the remote database:', err);
    process.exit(1);
  }
}

verify();
