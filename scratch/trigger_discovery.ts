import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.join(process.cwd(), '.env') });

const url = 'https://hangout-api.hangoutt.workers.dev';
const secret = process.env.HANGOUT_API_SECRET || '6dd3678469d5b577696e5d579b9c906bb24ec533426fa4c27381f8d45e7dc2dd';

async function main() {
  try {
    console.log('Triggering discover-zone Dadar...');
    const res1 = await fetch(`${url}/api/admin/discover-zone`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${secret.trim()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ zoneName: 'Dadar' })
    });
    console.log('Dadar status:', res1.status, await res1.json());

    console.log('Triggering discover-zone Bandra...');
    const res2 = await fetch(`${url}/api/admin/discover-zone`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${secret.trim()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ zoneName: 'Bandra' })
    });
    console.log('Bandra status:', res2.status, await res2.json());

    console.log('Triggering discover-experiences...');
    const res3 = await fetch(`${url}/api/admin/discover-experiences`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${secret.trim()}`,
        'Content-Type': 'application/json'
      }
    });
    console.log('Experiences status:', res3.status, await res3.json());
  } catch (err) {
    console.error('Error:', err);
  }
}
main();
