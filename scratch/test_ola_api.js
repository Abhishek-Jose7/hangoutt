const path = require('path');
try { require('dotenv').config({ path: path.join(__dirname, '../.env') }); } catch (_) {}

const apiKey = process.env.OLA_MAPS_API_KEY || '';
const placeId = 'ola-platform:5000066475410';

async function main() {
  if (!apiKey) {
    console.error('OLA_MAPS_API_KEY is not defined in .env');
    return;
  }
  const url = `https://api.olamaps.io/places/v1/details?place_id=${encodeURIComponent(placeId)}&api_key=${apiKey}`;
  try {
    console.log('Fetching place details:', url);
    const res = await fetch(url, {
      headers: {
        'X-Request-Id': `hangoutt-test-details-${Date.now()}`,
        'Referer': 'http://localhost:3000',
        'Origin': 'http://localhost:3000'
      }
    });
    console.log('Status:', res.status);
    const json = await res.json();
    console.log('Keys:', Object.keys(json));
    if (json.result) {
      console.log('Result Keys:', Object.keys(json.result));
      console.log('rating:', json.result.rating);
      console.log('user_ratings_total:', json.result.user_ratings_total);
      console.log('business_status:', json.result.business_status);
      console.log('types:', json.result.types);
      console.log('geometry:', json.result.geometry);
    }
  } catch (err) {
    console.error('Error:', err);
  }
}
main();
