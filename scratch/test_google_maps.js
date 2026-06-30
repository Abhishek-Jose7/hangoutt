const API_KEY = 'AIzaSyD_Wtdg8MU9q687h5qTSaQW2S72AVkhyrI';
const lat = 19.0596; // Bandra center
const lng = 72.8295;
const radius = 1000;

async function testLegacy() {
  console.log('Testing Legacy Places API...');
  const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radius}&type=cafe&key=${API_KEY}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    console.log('Legacy Status:', data.status);
    if (data.results && data.results.length > 0) {
      console.log('Legacy Sample:', data.results.slice(0, 2).map(r => ({
        name: r.name,
        rating: r.rating,
        user_ratings_total: r.user_ratings_total,
        types: r.types,
        place_id: r.place_id
      })));
      return true;
    }
  } catch (err) {
    console.error('Legacy Error:', err.message);
  }
  return false;
}

async function testNew() {
  console.log('\nTesting New Places API...');
  const url = 'https://places.googleapis.com/v1/places:searchNearby';
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': API_KEY,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.types'
      },
      body: JSON.stringify({
        includedTypes: ['cafe'],
        maxResultCount: 5,
        locationRestriction: {
          circle: {
            center: { latitude: lat, longitude: lng },
            radius: radius
          }
        }
      })
    });
    
    if (!res.ok) {
      console.log('New API HTTP status:', res.status, await res.text());
      return false;
    }
    const data = await res.json();
    console.log('New API Sample:', JSON.stringify(data, null, 2));
    return true;
  } catch (err) {
    console.error('New API Error:', err.message);
  }
  return false;
}

async function run() {
  const legacyOk = await testLegacy();
  const newOk = await testNew();
  console.log(`\nTests finished. Legacy OK: ${legacyOk}, New OK: ${newOk}`);
}

run().catch(console.error);
