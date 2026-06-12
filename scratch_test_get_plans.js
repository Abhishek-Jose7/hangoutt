const url = 'https://hangout-api.hangoutt.workers.dev';
const secret = '6dd3678469d5b577696e5d579b9c906bb24ec533426fa4c27381f8d45e7dc2dd';
const groupId = 'ce6c553d-70c4-49ff-8e0e-877258e424b6';

async function testGetPlans() {
  try {
    console.log(`Fetching plans for group ${groupId} from remote worker...`);
    const res = await fetch(`${url}/groups/${groupId}/plans`, {
      headers: {
        'Authorization': `Bearer ${secret}`
      }
    });
    console.log('Response status:', res.status);
    const data = await res.json();
    console.log('Response body:', JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Error:', err);
  }
}

testGetPlans();
