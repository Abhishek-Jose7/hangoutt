import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const apiKey = process.env.GOOGLE_MAPS_API_KEY;

async function run() {
  if (!apiKey) {
    console.error('GOOGLE_MAPS_API_KEY is not defined in .env');
    return;
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  console.log('Sending test request to Gemini API...');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [{
        parts: [{
          text: 'Hello! Respond with "Gemini is online!" if you can read this.'
        }]
      }]
    })
  });

  console.log('Status:', res.status);
  const json = await res.json() as any;
  console.log('Response:', JSON.stringify(json, null, 2));
}

run().catch(console.error);
