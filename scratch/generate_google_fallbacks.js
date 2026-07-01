require('dotenv').config();

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const GOOGLE_BASE_URL = 'https://maps.googleapis.com/maps/api/place';

const CATEGORIES = [
  'CAFE',
  'RESTAURANT',
  'DESSERT',
  'PARK',
  'ARCADE',
  'BOWLING',
  'ESCAPE_ROOM',
  'POTTERY',
  'LIVE_MUSIC',
  'SPORTS',
  'MOVIE',
  'MUSEUM',
  'MALL',
  'WORKSHOP'
];

async function run() {
  if (!GOOGLE_MAPS_API_KEY) {
    console.error('GOOGLE_MAPS_API_KEY is not defined in .env');
    return;
  }

  console.log('Fetching Google Photo references for categories in Mumbai...');
  const mapping = {};

  for (const cat of CATEGORIES) {
    const query = `${cat.toLowerCase().replace('_', ' ')} in Mumbai`;
    const searchUrl = `${GOOGLE_BASE_URL}/textsearch/json?query=${encodeURIComponent(query)}&key=${GOOGLE_MAPS_API_KEY}`;

    try {
      const res = await fetch(searchUrl);
      const data = await res.json();
      const results = data.results || [];
      
      let photoRef = null;
      for (const place of results) {
        if (place.photos && place.photos.length > 0 && place.photos[0].photo_reference) {
          photoRef = place.photos[0].photo_reference;
          break;
        }
      }

      if (photoRef) {
        mapping[cat] = `/api/places/photo?ref=${encodeURIComponent(photoRef)}`;
        console.log(`- ${cat}: Found photo reference!`);
      } else {
        console.log(`- ${cat}: No photo reference found.`);
      }
    } catch (err) {
      console.error(`Failed to fetch for ${cat}:`, err.message);
    }
  }

  console.log('\nGenerated Mapping:');
  console.log(JSON.stringify(mapping, null, 2));
}

run();
