import { db } from './src/lib/db/client';
import { zones, zoneFallbacks } from './src/lib/db/schema';
import { eq } from 'drizzle-orm';

const SEED_ZONES = [
  { id: 'zone_andheri', name: 'Andheri', centerLat: 19.1136, centerLng: 72.8697, radius: 4.0 },
  { id: 'zone_bandra', name: 'Bandra', centerLat: 19.0596, centerLng: 72.8295, radius: 3.0 },
  { id: 'zone_borivali', name: 'Borivali', centerLat: 19.2290, centerLng: 72.8570, radius: 4.0 },
  { id: 'zone_dadar', name: 'Dadar', centerLat: 19.0178, centerLng: 72.8478, radius: 2.5 },
  { id: 'zone_kurla', name: 'Kurla', centerLat: 19.0607, centerLng: 72.8826, radius: 3.0 },
  { id: 'zone_ghatkopar', name: 'Ghatkopar', centerLat: 19.0860, centerLng: 72.9082, radius: 3.0 },
  { id: 'zone_powai', name: 'Powai', centerLat: 19.1176, centerLng: 72.9060, radius: 3.0 },
  { id: 'zone_lower_parel', name: 'Lower Parel', centerLat: 19.0034, centerLng: 72.8276, radius: 2.0 },
  { id: 'zone_worli', name: 'Worli', centerLat: 19.0176, centerLng: 72.8179, radius: 2.5 },
  { id: 'zone_thane', name: 'Thane', centerLat: 19.2183, centerLng: 72.9781, radius: 5.0 },
  { id: 'zone_vashi', name: 'Vashi', centerLat: 19.0745, centerLng: 72.9978, radius: 3.5 },
  { id: 'zone_belapur', name: 'Belapur', centerLat: 19.0180, centerLng: 73.0392, radius: 3.5 },
  { id: 'zone_nerul', name: 'Nerul', centerLat: 19.0330, centerLng: 73.0180, radius: 2.5 },
  { id: 'zone_seawoods', name: 'Seawoods', centerLat: 19.0212, centerLng: 73.0192, radius: 2.5 },
  { id: 'zone_kharghar', name: 'Kharghar', centerLat: 19.0222, centerLng: 73.0644, radius: 3.0 },
  { id: 'zone_panvel', name: 'Panvel', centerLat: 18.9894, centerLng: 73.1175, radius: 4.0 },
];

const SEED_FALLBACKS = [
  // Andheri Fallbacks
  {
    id: 'fb_andheri_bowling',
    zoneName: 'Andheri',
    name: 'The Game Palacio Andheri',
    category: 'BOWLING',
    lat: 19.1352,
    lng: 72.8311,
    estimatedCostPerHead: 1000,
    mandatoryCost: 1000,
    optionalCostMin: 0,
    optionalCostMax: 200,
    address: 'Fun Republic Lane, Andheri West',
    rating: 4.5,
  },
  {
    id: 'fb_andheri_cafe',
    zoneName: 'Andheri',
    name: 'Leaping Windows',
    category: 'CAFE',
    lat: 19.1329,
    lng: 72.8147,
    estimatedCostPerHead: 400,
    mandatoryCost: 150,
    optionalCostMin: 250,
    optionalCostMax: 600,
    address: 'Yari Road, Versova, Andheri West',
    rating: 4.6,
  },
  {
    id: 'fb_andheri_park',
    zoneName: 'Andheri',
    name: 'Versova Beach',
    category: 'PARK',
    lat: 19.1351,
    lng: 72.8119,
    estimatedCostPerHead: 0,
    mandatoryCost: 0,
    optionalCostMin: 0,
    optionalCostMax: 0,
    address: 'Versova, Andheri West',
    rating: 4.5,
  },

  // Bandra Fallbacks
  {
    id: 'fb_bandra_bowling',
    zoneName: 'Bandra',
    name: 'The Game Palacio Bandra',
    category: 'BOWLING',
    lat: 19.0596,
    lng: 72.8295,
    estimatedCostPerHead: 1100,
    mandatoryCost: 1100,
    optionalCostMin: 0,
    optionalCostMax: 200,
    address: 'Bandra West, Mumbai',
    rating: 4.6,
  },
  {
    id: 'fb_bandra_pottery',
    zoneName: 'Bandra',
    name: 'Bandra Pottery Lab',
    category: 'POTTERY',
    lat: 19.0500,
    lng: 72.8300,
    estimatedCostPerHead: 1200,
    mandatoryCost: 1200,
    optionalCostMin: 0,
    optionalCostMax: 0,
    address: 'Bandra West, Mumbai',
    rating: 4.7,
  },
  {
    id: 'fb_bandra_park',
    zoneName: 'Bandra',
    name: 'Carter Road Promenade',
    category: 'PARK',
    lat: 19.0690,
    lng: 72.8360,
    estimatedCostPerHead: 0,
    mandatoryCost: 0,
    optionalCostMin: 0,
    optionalCostMax: 0,
    address: 'Bandra West, Mumbai',
    rating: 4.6,
  },

  // Dadar Fallbacks
  {
    id: 'fb_dadar_cafe',
    zoneName: 'Dadar',
    name: "Grandmama's Cafe",
    category: 'CAFE',
    lat: 19.0178,
    lng: 72.8478,
    estimatedCostPerHead: 600,
    mandatoryCost: 250,
    optionalCostMin: 350,
    optionalCostMax: 900,
    address: 'Dadar East, Mumbai',
    rating: 4.3,
  },
  {
    id: 'fb_dadar_park',
    zoneName: 'Dadar',
    name: 'Shivaji Park',
    category: 'PARK',
    lat: 19.0268,
    lng: 72.8415,
    estimatedCostPerHead: 0,
    mandatoryCost: 0,
    optionalCostMin: 0,
    optionalCostMax: 0,
    address: 'Dadar West, Mumbai',
    rating: 4.5,
  },

  // Vashi Fallbacks
  {
    id: 'fb_vashi_mall',
    zoneName: 'Vashi',
    name: 'Inorbit Mall Vashi',
    category: 'MALL',
    lat: 19.0655,
    lng: 72.9970,
    estimatedCostPerHead: 300,
    mandatoryCost: 100,
    optionalCostMin: 200,
    optionalCostMax: 1000,
    address: 'Vashi, Navi Mumbai',
    rating: 4.4,
  },
  {
    id: 'fb_vashi_boardgame',
    zoneName: 'Vashi',
    name: 'Pair A Dice Cafe Vashi',
    category: 'BOARD_GAMES',
    lat: 19.0760,
    lng: 72.9990,
    estimatedCostPerHead: 400,
    mandatoryCost: 200,
    optionalCostMin: 200,
    optionalCostMax: 500,
    address: 'Sector 17, Vashi, Navi Mumbai',
    rating: 4.7,
  },

  // Belapur Fallbacks
  {
    id: 'fb_belapur_park',
    zoneName: 'Belapur',
    name: 'Wonders Park Belapur',
    category: 'PARK',
    lat: 19.0220,
    lng: 73.0290,
    estimatedCostPerHead: 50,
    mandatoryCost: 50,
    optionalCostMin: 0,
    optionalCostMax: 100,
    address: 'Sector 19, Nerul / Belapur',
    rating: 4.3,
  },
  {
    id: 'fb_belapur_cafe',
    zoneName: 'Belapur',
    name: 'Urban Cafe Belapur',
    category: 'CAFE',
    lat: 19.0180,
    lng: 73.0392,
    estimatedCostPerHead: 500,
    mandatoryCost: 200,
    optionalCostMin: 300,
    optionalCostMax: 800,
    address: 'CBD Belapur, Navi Mumbai',
    rating: 4.2,
  },

  // Kurla Fallbacks
  {
    id: 'fb_kurla_sports',
    zoneName: 'Kurla',
    name: 'Snow World Mumbai',
    category: 'SPORTS',
    lat: 19.0607,
    lng: 72.8826,
    estimatedCostPerHead: 600,
    mandatoryCost: 600,
    optionalCostMin: 0,
    optionalCostMax: 0,
    address: 'Phoenix Marketcity, Kurla',
    rating: 4.2,
  },
  {
    id: 'fb_kurla_mall',
    zoneName: 'Kurla',
    name: 'Phoenix Marketcity Kurla',
    category: 'MALL',
    lat: 19.0610,
    lng: 72.8830,
    estimatedCostPerHead: 500,
    mandatoryCost: 100,
    optionalCostMin: 400,
    optionalCostMax: 2000,
    address: 'LBS Marg, Kurla',
    rating: 4.5,
  },
];

async function seed() {
  try {
    console.log('Seeding zones...');
    for (const z of SEED_ZONES) {
      await db.insert(zones).values(z).onConflictDoUpdate({
        target: zones.name,
        set: { centerLat: z.centerLat, centerLng: z.centerLng, radius: z.radius },
      });
    }
    console.log('Zones seeded successfully.');

    console.log('Seeding zone fallbacks...');
    for (const fb of SEED_FALLBACKS) {
      await db.insert(zoneFallbacks).values(fb).onConflictDoUpdate({
        target: zoneFallbacks.id,
        set: fb,
      });
    }
    console.log('Zone fallbacks seeded successfully.');
    process.exit(0);
  } catch (err) {
    console.error('Seeding failed:', err);
    process.exit(1);
  }
}

seed();
