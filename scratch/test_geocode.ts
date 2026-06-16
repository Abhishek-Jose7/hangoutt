import { geocodeAddress } from '../src/lib/maps/geocoding';

async function main() {
  console.log('Geocoding "Borivali, Mumbai ":');
  try {
    const res = await geocodeAddress('Borivali, Mumbai ');
    console.log(res);
  } catch (err) {
    console.error(err);
  }
}

main();
