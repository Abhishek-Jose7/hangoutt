const url = 'https://hangout-api.hangoutt.workers.dev';
const secret = '6dd3678469d5b577696e5d579b9c906bb24ec533426fa4c27381f8d45e7dc2dd';
const groupId = '35aca11a-f9b6-429f-af27-1d637721eaad';
const clerkId = 'user_3Bt1C0dUXAmmHc06LgnBxCmk21D';

async function getRemoteGroupDetails() {
  try {
    console.log(`Querying details for group ${groupId} from remote worker...`);
    const res = await fetch(`${url}/groups/${groupId}?clerkId=${clerkId}`, {
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

getRemoteGroupDetails();
