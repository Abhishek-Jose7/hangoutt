import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

// Load .env manually
const envPath = path.join(process.cwd(), '.env');
const processEnv: Record<string, string> = {};
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const index = trimmed.indexOf('=');
    if (index !== -1) {
      const key = trimmed.substring(0, index).trim();
      const val = trimmed.substring(index + 1).trim();
      processEnv[key] = val;
    }
  });
}

const secretsToSet = ['OLA_MAPS_API_KEY', 'HANGOUT_API_SECRET', 'GROQ_API_KEY'];

function setSecret(name: string, value: string): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`Setting remote secret ${name}...`);
    const child = spawn('npx', ['wrangler', 'secret', 'put', name], {
      stdio: ['pipe', 'inherit', 'inherit'],
      shell: true
    });
    
    child.stdin.write(value + '\n');
    child.stdin.end();
    
    child.on('close', (code) => {
      if (code === 0) {
        console.log(`Successfully set secret ${name}`);
        resolve();
      } else {
        reject(new Error(`Failed to set secret ${name} with code ${code}`));
      }
    });
  });
}

async function main() {
  for (const name of secretsToSet) {
    const value = processEnv[name];
    if (value) {
      try {
        await setSecret(name, value);
      } catch (err) {
        console.error(err);
      }
    } else {
      console.warn(`Secret ${name} not found in .env`);
    }
  }
}

main();
