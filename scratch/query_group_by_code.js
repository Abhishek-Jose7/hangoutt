const HANGOUT_API_URL = 'https://hangout-api.hangoutt.workers.dev';
const HANGOUT_API_SECRET = '6dd3678469d5b577696e5d579b9c906bb24ec533426fa4c27381f8d45e7dc2dd';

async function main() {
  console.log('Fetching all groups from remote worker...');
  try {
    const clerkId = 'user_3Bt1C0dUXAmmHc06LgnBxCmk21D'; // Admin clerkId
    // Fetch user groups
    const res = await fetch(`${HANGOUT_API_URL}/groups?clerkId=${encodeURIComponent(clerkId)}`, {
      headers: {
        'Authorization': `Bearer ${HANGOUT_API_SECRET}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!res.ok) {
      console.error(`HTTP Error: ${res.status}`);
      return;
    }

    const payload = await res.json();
    if (payload.success) {
      const targetGroup = payload.data.find(g => g.inviteCode === 'UP4XBEJN');
      if (targetGroup) {
        console.log('Found Group:', targetGroup);
        // Get details
        const detailsRes = await fetch(`${HANGOUT_API_URL}/groups/${targetGroup.id}?clerkId=${encodeURIComponent(clerkId)}`, {
          headers: {
            'Authorization': `Bearer ${HANGOUT_API_SECRET}`,
            'Content-Type': 'application/json'
          }
        });
        const detailsPayload = await detailsRes.json();
        console.log('Group Details Data:', JSON.stringify(detailsPayload.data, null, 2));
      } else {
        console.log('Group UP4XBEJN not found. List of groups:', payload.data.map(g => ({ name: g.name, code: g.inviteCode })));
      }
    }
  } catch (err) {
    console.error('Error:', err);
  }
}

main();
