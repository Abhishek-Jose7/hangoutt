const HANGOUT_API_URL = 'https://hangout-api.hangoutt.workers.dev';
const HANGOUT_API_SECRET = '6dd3678469d5b577696e5d579b9c906bb24ec533426fa4c27381f8d45e7dc2dd';
const groupId = '29642864-cef4-41d7-be36-af7f9dab3a48';

async function main() {
  console.log('Fetching plans...');
  const res = await fetch(`${HANGOUT_API_URL}/groups/${groupId}/plans`, {
    headers: {
      'Authorization': `Bearer ${HANGOUT_API_SECRET}`,
      'Content-Type': 'application/json'
    }
  });
  const payload = await res.json();
  console.log('Plans Payload:', JSON.stringify(payload.data, null, 2));
}

main();
