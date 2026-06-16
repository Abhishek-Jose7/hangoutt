const apiKey = 'iNXr9SjXiNUZDxxoXXogfKCwLXLV1kRa9CyNwtlT';

async function testGeocode() {
  const addresses = [
    'Dadar Railway Station',
    'Seawoods',
    'Nerul',
    'Dadar'
  ];

  for (const addr of addresses) {
    try {
      console.log(`\nTesting geocode for "${addr}"...`);
      const url = `https://api.olamaps.io/places/v1/geocode?address=${encodeURIComponent(addr)}&api_key=${apiKey}`;
      const res = await fetch(url, {
        headers: {
          'Referer': 'http://localhost:3000',
          'Origin': 'http://localhost:3000'
        }
      });
      const data = await res.json() as any;
      console.log('Status:', res.status);
      console.log('Response:', JSON.stringify(data, null, 2));
    } catch (err) {
      console.error('Error for address:', addr, err);
    }
  }
}

testGeocode();
