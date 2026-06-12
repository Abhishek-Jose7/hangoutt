const url = 'https://hangout-api.hangoutt.workers.dev';
const rawSecret = ' 6dd3678469d5b577696e5d579b9c906bb24ec533426fa4c27381f8d45e7dc2dd';

async function testWorker() {
  try {
    console.log('Testing raw URL fetch to /health/db...');
    const healthRes = await fetch(`${url}/health/db`);
    const healthData = await healthRes.json();
    console.log('Health DB Status:', healthRes.status, healthData);

    console.log('\nTesting auth with raw secret...');
    const authRes = await fetch(`${url}/groups`, {
      headers: {
        'Authorization': `Bearer ${rawSecret}`
      }
    });
    const authData = await authRes.json();
    console.log('Auth Status (raw):', authRes.status, authData);

    console.log('\nTesting auth with trimmed secret...');
    const authRes2 = await fetch(`${url}/groups`, {
      headers: {
        'Authorization': `Bearer ${rawSecret.trim()}`
      }
    });
    const authData2 = await authRes2.json();
    console.log('Auth Status (trimmed):', authRes2.status, authData2);

  } catch (err) {
    console.error('Error during fetch:', err);
  }
}

testWorker();
