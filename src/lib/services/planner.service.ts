import 'server-only';
import { getNearestStation } from '../maps/geocoding';
import { groupRepository } from '../repositories/group.repository';
import { memberRepository } from '../repositories/member.repository';
import { budgetRepository } from '../repositories/budget.repository';
import { locationRepository } from '../repositories/location.repository';
import { planRepository, type PlanWithSlots } from '../repositories/plan.repository';
import { historyRepository } from '../repositories/history.repository';
import { recommendationService } from './recommendation.service';
import { generateItineraries } from '../groq/itineraryService';
import { selectCandidateZones, getHaversineDistance, LatLng } from '../algorithms/zoneSelection';
import { db, safeTransaction } from '../db/client';
import { users, groups, plans, planSlots, memberTravelMetrics, zones, places, placeCategories, placeCosts, placeScores, experiences, zoneFallbacks, rankingMetrics, featuredExperiences, discoveryQueue, apiBudget } from '../db/schema';
import { eq, sql, and, between } from 'drizzle-orm';
import { InsufficientLocationsError, NotFoundError, ValidationError, ForbiddenError } from '../errors';
import { ItineraryPromptContext, VenueCategory } from '../types/planner.types';
import { validateStatusTransition } from './group.service';
import { getVenueImageUrl, getVenueDetails, searchTextVenues, searchNearbyVenues } from '../maps/places';

function calculateMumbaiTravelBreakdown(from: LatLng, to: LatLng, outingTime?: string | null) {
  let isPeakTraffic = false;
  if (outingTime) {
    let hour = 12;
    const match24 = outingTime.match(/^(\d{1,2}):(\d{2})$/);
    if (match24) {
      hour = parseInt(match24[1]);
    } else {
      const match12 = outingTime.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
      if (match12) {
        hour = parseInt(match12[1]);
        const ampm = match12[3].toUpperCase();
        if (ampm === 'PM' && hour !== 12) hour += 12;
        if (ampm === 'AM' && hour === 12) hour = 0;
      }
    }
    // Peak hours: 8-11 AM, 5-8:30 PM
    if ((hour >= 8 && hour < 11) || (hour >= 17 && hour < 21)) {
      isPeakTraffic = true;
    }
  }

  const dist = getHaversineDistance(from, to);

  let walkingTime = 0;
  let autoTime = 0;
  let autoCost = 0;
  let trainTime = 0;
  let trainCost = 0;

  if (dist < 2) {
    walkingTime = Math.round(dist * 12);
  } else if (dist >= 2 && dist < 5) {
    // Walk (0.7 km) + Auto (dist - 0.7 km)
    walkingTime = Math.round(0.7 * 12);
    const autoDist = dist - 0.7;
    autoTime = Math.round(autoDist * (isPeakTraffic ? 6.0 : 4.0));
    autoCost = Math.round(23 + Math.max(0, autoDist - 1.5) * 15);
  } else {
    // Multi-modal: Auto to station (1.5km) + Walk (0.5km) + Train (dist - 2.5km) + Walk destination (1.0km)
    walkingTime = Math.round(1.5 * 12); // total walking distance 1.5km
    autoTime = Math.round(1.5 * (isPeakTraffic ? 6.0 : 4.0));
    autoCost = 23; // base auto fare
    const trainDist = Math.max(0, dist - 2.5);
    trainTime = Math.round(trainDist * 1.5) + 5; // 1.5 mins per km + 5 mins waiting
    trainCost = trainDist < 10 ? 10 : trainDist < 20 ? 15 : trainDist < 30 ? 20 : 30;
  }

  const totalTime = walkingTime + autoTime + trainTime;
  const totalCost = autoCost + trainCost;

  return {
    walkingTime,
    autoTime,
    autoCost,
    trainTime,
    trainCost,
    totalTime,
    totalCost
  };
}

function isVenueOpenAtTime(category: string, outingTime?: string | null): boolean {
  if (!outingTime) return true;
  let hour = 12.0;
  const match24 = outingTime.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    hour = parseInt(match24[1]) + parseInt(match24[2]) / 60.0;
  } else {
    const match12 = outingTime.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (match12) {
      let h = parseInt(match12[1]);
      const ampm = match12[3].toUpperCase();
      if (ampm === 'PM' && h !== 12) h += 12;
      if (ampm === 'AM' && h === 12) h = 0;
      hour = h + parseInt(match12[2]) / 60.0;
    }
  }

  const cat = category.toUpperCase();
  if (cat === 'MUSEUM' || cat === 'ART_GALLERY' || cat === 'ART_EXHIBITION') {
    return hour >= 10.0 && hour <= 18.0; // 10 AM to 6 PM
  }
  if (cat === 'PARK') {
    return hour >= 6.0 && hour <= 19.0; // 6 AM to 7 PM
  }
  if (cat === 'WORKSHOP' || cat === 'POTTERY' || cat === 'PAINTING') {
    return hour >= 9.0 && hour <= 21.0; // 9 AM to 9 PM
  }
  if (cat === 'COMIC_CON' || cat === 'ANIME_EVENT') {
    return hour >= 10.0 && hour <= 20.0; // 10 AM to 8 PM
  }
  return true;
}

const CATEGORY_WEIGHTS: Record<string, Record<string, number>> = {
  DATE: {
    CAFE: 10, RESTAURANT: 10, DESSERT: 10, POTTERY: 9, MUSEUM: 8, ART_GALLERY: 8,
    PARK: 8, MOVIE: 6, MALL: 6, ARCADE: 5, BOWLING: 5, ESCAPE_ROOM: 5, SPORTS: 5
  },
  FRIENDS: {
    BOWLING: 10, ARCADE: 10, ESCAPE_ROOM: 9, SPORTS: 9, CAFE: 8, RESTAURANT: 8, DESSERT: 8,
    MOVIE: 7, MALL: 7, POTTERY: 6, PARK: 5, MUSEUM: 5
  },
  FAMILY: {
    MUSEUM: 10, PARK: 9, ARCADE: 8, RESTAURANT: 8, DESSERT: 8, CAFE: 7, BOWLING: 7, MALL: 7,
    MOVIE: 6, POTTERY: 6, SPORTS: 5, ESCAPE_ROOM: 4
  },
  WORK: {
    ESCAPE_ROOM: 10, BOWLING: 9, ARCADE: 9, POTTERY: 9, RESTAURANT: 8, CAFE: 7, SPORTS: 6,
    MALL: 5, DESSERT: 5, MOVIE: 4, MUSEUM: 4, PARK: 4
  },
  CUSTOM: {
    CAFE: 8, RESTAURANT: 8, DESSERT: 7, PARK: 7, ARCADE: 6, BOWLING: 6, MALL: 6, MOVIE: 6,
    ESCAPE_ROOM: 5, POTTERY: 5, MUSEUM: 5, SPORTS: 5
  }
};

interface PlaceCandidate {
  id: string;
  name: string;
  category: string;
  rating: number;
  lat: number;
  lng: number;
  estimatedCostPerHead: number;
  address: string;
  openNow?: boolean;
  isExperience?: boolean;
  sourceUrl?: string;
  imageUrl?: string;
  isFallback?: boolean;
}

function validateCoordinates(lat: number, lng: number): boolean {
  return lat >= 18.8 && lat <= 19.5 && lng >= 72.6 && lng <= 73.3;
}

const PLANNER_REQUIRED_CATEGORIES: VenueCategory[] = [
  'CAFE', 'RESTAURANT', 'ARCADE', 'PARK', 'ESCAPE_ROOM', 'DESSERT', 'BOWLING', 'MUSEUM'
];

const REACTIVE_CATEGORY_COSTS: Record<string, { mandatory: number; min: number; max: number }> = {
  CAFE:        { mandatory: 0,   min: 200, max: 600  },
  RESTAURANT:  { mandatory: 0,   min: 300, max: 1000 },
  DESSERT:     { mandatory: 0,   min: 150, max: 400  },
  PARK:        { mandatory: 0,   min: 0,   max: 0    },
  ARCADE:      { mandatory: 300, min: 100, max: 500  },
  BOWLING:     { mandatory: 350, min: 100, max: 400  },
  ESCAPE_ROOM: { mandatory: 700, min: 0,   max: 0    },
  MUSEUM:      { mandatory: 150, min: 0,   max: 0    },
  MALL:        { mandatory: 0,   min: 100, max: 500  },
  SPORTS:      { mandatory: 300, min: 0,   max: 200  },
  MOVIE:       { mandatory: 350, min: 0,   max: 100  },
};

const CATEGORY_UNSPLASH_IMAGES: Record<string, string> = {
  'CAFE':        'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=600&auto=format&fit=crop',
  'RESTAURANT':  'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=600&auto=format&fit=crop',
  'DESSERT':     'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=600&auto=format&fit=crop',
  'PARK':        'https://images.unsplash.com/photo-1519331379826-f10be5486c6f?w=600&auto=format&fit=crop',
  'ARCADE':      'https://images.unsplash.com/photo-1511512578047-dfb367046420?w=600&auto=format&fit=crop',
  'BOWLING':     'https://images.unsplash.com/photo-1538510166367-5477e2a521e7?w=600&auto=format&fit=crop',
  'ESCAPE_ROOM': 'https://images.unsplash.com/photo-1519074069444-1ba4e6664104?w=600&auto=format&fit=crop',
  'MUSEUM':      'https://images.unsplash.com/photo-1566127444979-b3d2b654e3d7?w=600&auto=format&fit=crop',
  'MALL':        'https://images.unsplash.com/photo-1519567241046-7f570f9b8e83?w=600&auto=format&fit=crop',
  'SPORTS':      'https://images.unsplash.com/photo-1461896836934-bd45ba24e7e5?w=600&auto=format&fit=crop',
  'MOVIE':       'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=600&auto=format&fit=crop',
  'POTTERY':     'https://images.unsplash.com/photo-1565192647048-f997ded87ab5?w=600&auto=format&fit=crop',
  'WORKSHOP':    'https://images.unsplash.com/photo-1565192647048-f997ded87ab5?w=600&auto=format&fit=crop',
};

function getFallbackImageUrl(category: string): string {
  return CATEGORY_UNSPLASH_IMAGES[category.toUpperCase()] || 'https://images.unsplash.com/photo-1528605248644-14dd04022da1?w=600&auto=format&fit=crop';
}

const MUMBAI_FALLBACK_CANDIDATES: PlaceCandidate[] = [
  // ── CAFÉ ──────────────────────────────────────────────────────────────────
  { id: 'fb_cafe_prithvi',    name: 'Prithvi Cafe',              category: 'CAFE',        rating: 4.6, lat: 19.1075, lng: 72.8263, estimatedCostPerHead: 300,  address: 'Juhu, Mumbai',            openNow: true, isFallback: true, imageUrl: 'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=600&auto=format&fit=crop' },
  { id: 'fb_cafe_candies',    name: 'Candies',                   category: 'CAFE',        rating: 4.5, lat: 19.0590, lng: 72.8280, estimatedCostPerHead: 350,  address: 'Bandra West, Mumbai',     openNow: true, isFallback: true, imageUrl: 'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=600&auto=format&fit=crop' },
  { id: 'fb_cafe_doolally_k', name: 'Doolally Taproom Khar',     category: 'CAFE',        rating: 4.4, lat: 19.0715, lng: 72.8356, estimatedCostPerHead: 400,  address: 'Khar West, Mumbai',       openNow: true, isFallback: true, imageUrl: 'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=600&auto=format&fit=crop' },
  { id: 'fb_cafe_doolally_a', name: 'Doolally Taproom Andheri',  category: 'CAFE',        rating: 4.4, lat: 19.1190, lng: 72.8580, estimatedCostPerHead: 400,  address: 'Andheri West, Mumbai',    openNow: true, isFallback: true },
  { id: 'fb_cafe_chai_kings', name: 'Chai Kings',                category: 'CAFE',        rating: 4.3, lat: 19.2290, lng: 72.8570, estimatedCostPerHead: 150,  address: 'Borivali West, Mumbai',   openNow: true, isFallback: true },
  { id: 'fb_cafe_vashi_bru',  name: 'Cafe Bru Vashi',            category: 'CAFE',        rating: 4.2, lat: 19.0745, lng: 72.9978, estimatedCostPerHead: 250,  address: 'Vashi, Navi Mumbai',      openNow: true, isFallback: true },
  { id: 'fb_cafe_thane_smg',  name: 'Social Thane',              category: 'CAFE',        rating: 4.3, lat: 19.2010, lng: 72.9780, estimatedCostPerHead: 350,  address: 'Thane West, Mumbai',      openNow: true, isFallback: true },
  { id: 'fb_cafe_grandmamas', name: "Grandmama's Cafe",          category: 'CAFE',        rating: 4.3, lat: 19.0178, lng: 72.8478, estimatedCostPerHead: 500,  address: 'Dadar East, Mumbai',      openNow: true, isFallback: true },
  { id: 'fb_cafe_leopold',    name: 'Cafe Leopold',              category: 'CAFE',        rating: 4.3, lat: 18.9219, lng: 72.8319, estimatedCostPerHead: 450,  address: 'Colaba, Mumbai',          openNow: true, isFallback: true },
  { id: 'fb_cafe_tea_trail',  name: 'Tea Trails',                category: 'CAFE',        rating: 4.2, lat: 19.0734, lng: 72.9989, estimatedCostPerHead: 200,  address: 'Inorbit Mall, Vashi',     openNow: true, isFallback: true },
  { id: 'fb_cafe_bkc_social', name: 'Social BKC',                category: 'CAFE',        rating: 4.4, lat: 19.0645, lng: 72.8675, estimatedCostPerHead: 400,  address: 'Capital Building, BKC, Mumbai', openNow: true, isFallback: true },
  { id: 'fb_cafe_powai_social', name: 'Social Powai',            category: 'CAFE',        rating: 4.4, lat: 19.1170, lng: 72.9080, estimatedCostPerHead: 400,  address: 'Delphi Building, Powai, Mumbai', openNow: true, isFallback: true },
  { id: 'fb_cafe_kurla_starbucks', name: 'Starbucks Marketcity', category: 'CAFE',        rating: 4.3, lat: 19.0880, lng: 72.8890, estimatedCostPerHead: 350,  address: 'Phoenix Marketcity, Kurla, Mumbai', openNow: true, isFallback: true },

  // ── RESTAURANT ────────────────────────────────────────────────────────────
  { id: 'fb_rest_joeys_a',    name: "Joey's Pizza Andheri",      category: 'RESTAURANT',  rating: 4.5, lat: 19.1136, lng: 72.8697, estimatedCostPerHead: 500,  address: 'Andheri West, Mumbai',    openNow: true, isFallback: true },
  { id: 'fb_rest_cafe_madras',name: 'Cafe Madras',               category: 'RESTAURANT',  rating: 4.6, lat: 19.0232, lng: 72.8640, estimatedCostPerHead: 200,  address: 'Matunga, Mumbai',         openNow: true, isFallback: true },
  { id: 'fb_rest_swati',      name: 'Swati Snacks',              category: 'RESTAURANT',  rating: 4.5, lat: 18.9682, lng: 72.8108, estimatedCostPerHead: 250,  address: 'Tardeo, Mumbai',          openNow: true, isFallback: true },
  { id: 'fb_rest_pav_bhaji',  name: 'Sardar Pav Bhaji',          category: 'RESTAURANT',  rating: 4.4, lat: 18.9682, lng: 72.8108, estimatedCostPerHead: 150,  address: 'Tardeo, Mumbai',          openNow: true, isFallback: true },
  { id: 'fb_rest_pizza_bay',  name: 'Pizza By The Bay',          category: 'RESTAURANT',  rating: 4.5, lat: 18.9345, lng: 72.8272, estimatedCostPerHead: 800,  address: 'Churchgate, Mumbai',      openNow: true, isFallback: true },
  { id: 'fb_rest_vashi',      name: 'New Yorker Vashi',          category: 'RESTAURANT',  rating: 4.3, lat: 19.0700, lng: 72.9940, estimatedCostPerHead: 600,  address: 'Vashi, Navi Mumbai',      openNow: true, isFallback: true },
  { id: 'fb_rest_thane',      name: 'Hotel Geetanjali',          category: 'RESTAURANT',  rating: 4.2, lat: 19.2183, lng: 72.9781, estimatedCostPerHead: 300,  address: 'Thane West, Mumbai',      openNow: true, isFallback: true },
  { id: 'fb_rest_borivali',   name: 'Rajdhani Thali Borivali',   category: 'RESTAURANT',  rating: 4.4, lat: 19.2290, lng: 72.8570, estimatedCostPerHead: 400,  address: 'Borivali West, Mumbai',   openNow: true, isFallback: true },
  { id: 'fb_rest_powai',      name: 'Meal of Fortune Powai',     category: 'RESTAURANT',  rating: 4.2, lat: 19.1176, lng: 72.9060, estimatedCostPerHead: 450,  address: 'Powai, Mumbai',           openNow: true, isFallback: true },
  { id: 'fb_rest_bkc_dishoom', name: 'O Pedro BKC',              category: 'RESTAURANT',  rating: 4.6, lat: 19.0638, lng: 72.8682, estimatedCostPerHead: 800,  address: 'Jet Airways Building, BKC, Mumbai', openNow: true, isFallback: true },
  { id: 'fb_rest_powai_chilis', name: 'Chili\'s Powai',          category: 'RESTAURANT',  rating: 4.5, lat: 19.1165, lng: 72.9090, estimatedCostPerHead: 600,  address: 'Ventura Building, Powai, Mumbai', openNow: true, isFallback: true },
  { id: 'fb_rest_kurla_barbeque', name: 'Barbeque Nation Kurla', category: 'RESTAURANT',  rating: 4.4, lat: 19.0885, lng: 72.8895, estimatedCostPerHead: 800,  address: 'Phoenix Marketcity, Kurla, Mumbai', openNow: true, isFallback: true },

  // ── DESSERT ───────────────────────────────────────────────────────────────
  { id: 'fb_dessert_le15',    name: 'Le15 Patisserie',           category: 'DESSERT',     rating: 4.4, lat: 19.0596, lng: 72.8295, estimatedCostPerHead: 300,  address: 'Bandra West, Mumbai',     openNow: true, isFallback: true },
  { id: 'fb_dessert_naturals',name: 'Naturals Ice Cream',        category: 'DESSERT',     rating: 4.5, lat: 19.1075, lng: 72.8263, estimatedCostPerHead: 150,  address: 'Juhu, Mumbai',            openNow: true, isFallback: true },
  { id: 'fb_dessert_theo',    name: 'Theobroma Colaba',          category: 'DESSERT',     rating: 4.4, lat: 18.9219, lng: 72.8319, estimatedCostPerHead: 250,  address: 'Colaba, Mumbai',          openNow: true, isFallback: true },
  { id: 'fb_dessert_borivali',name: 'Sweet Chariot Borivali',    category: 'DESSERT',     rating: 4.2, lat: 19.2290, lng: 72.8570, estimatedCostPerHead: 200,  address: 'Borivali West, Mumbai',   openNow: true, isFallback: true },
  { id: 'fb_dessert_thane',   name: 'Bake House Thane',          category: 'DESSERT',     rating: 4.1, lat: 19.2183, lng: 72.9781, estimatedCostPerHead: 200,  address: 'Thane West, Mumbai',      openNow: true, isFallback: true },
  { id: 'fb_dessert_vashi',   name: 'Cupcake Therapy Vashi',     category: 'DESSERT',     rating: 4.2, lat: 19.0745, lng: 72.9978, estimatedCostPerHead: 200,  address: 'Vashi, Navi Mumbai',      openNow: true, isFallback: true },

  // ── PARK / FREE ───────────────────────────────────────────────────────────
  { id: 'fb_park_shivaji',    name: 'Shivaji Park',              category: 'PARK',        rating: 4.5, lat: 19.0268, lng: 72.8415, estimatedCostPerHead: 0,    address: 'Dadar West, Mumbai',      openNow: true, isFallback: true },
  { id: 'fb_park_marine',     name: 'Marine Drive Promenade',    category: 'PARK',        rating: 4.8, lat: 18.9448, lng: 72.8236, estimatedCostPerHead: 0,    address: 'Marine Lines, Mumbai',    openNow: true, isFallback: true },
  { id: 'fb_park_carter',     name: 'Carter Road Promenade',     category: 'PARK',        rating: 4.6, lat: 19.0690, lng: 72.8360, estimatedCostPerHead: 0,    address: 'Bandra West, Mumbai',     openNow: true, isFallback: true },
  { id: 'fb_park_versova',    name: 'Versova Beach',             category: 'PARK',        rating: 4.4, lat: 19.1385, lng: 72.8116, estimatedCostPerHead: 0,    address: 'Versova, Andheri West',   openNow: true, isFallback: true },
  { id: 'fb_park_gorai',      name: 'Gorai Beach',               category: 'PARK',        rating: 4.3, lat: 19.2320, lng: 72.8220, estimatedCostPerHead: 0,    address: 'Borivali West, Mumbai',   openNow: true, isFallback: true },
  { id: 'fb_park_upvan',      name: 'Upvan Lake Thane',          category: 'PARK',        rating: 4.4, lat: 19.2148, lng: 73.0018, estimatedCostPerHead: 0,    address: 'Thane West, Mumbai',      openNow: true, isFallback: true },
  { id: 'fb_park_vashi_cp',   name: 'Central Park Vashi',        category: 'PARK',        rating: 4.3, lat: 19.0733, lng: 72.9971, estimatedCostPerHead: 0,    address: 'Vashi, Navi Mumbai',      openNow: true, isFallback: true },
  { id: 'fb_park_sion_fort',  name: 'Sion Fort',                 category: 'PARK',        rating: 4.2, lat: 19.0373, lng: 72.8630, estimatedCostPerHead: 0,    address: 'Sion, Mumbai',            openNow: true, isFallback: true },
  { id: 'fb_park_natl',       name: 'Sanjay Gandhi National Park',category: 'PARK',       rating: 4.7, lat: 19.2280, lng: 72.8741, estimatedCostPerHead: 50,   address: 'Borivali East, Mumbai',   openNow: true, isFallback: true },
  { id: 'fb_park_kharghar',   name: 'Central Park Kharghar',     category: 'PARK',        rating: 4.5, lat: 19.0460, lng: 73.0680, estimatedCostPerHead: 0,    address: 'Kharghar, Navi Mumbai',   openNow: true, isFallback: true },
  { id: 'fb_park_bkc_garden', name: 'Jio World Garden',          category: 'PARK',        rating: 4.5, lat: 19.0620, lng: 72.8690, estimatedCostPerHead: 50,   address: 'Jio World Centre, BKC, Mumbai', openNow: true, isFallback: true },
  { id: 'fb_park_powai_lake', name: 'Powai Lake Promenade',      category: 'PARK',        rating: 4.2, lat: 19.1220, lng: 72.9050, estimatedCostPerHead: 0,    address: 'Powai Lake Road, Powai, Mumbai', openNow: true, isFallback: true },

  // ── ARCADE ────────────────────────────────────────────────────────────────
  { id: 'fb_arcade_smaaash',  name: 'Smaaash Lower Parel',       category: 'ARCADE',      rating: 4.4, lat: 19.0034, lng: 72.8276, estimatedCostPerHead: 600,  address: 'Lower Parel, Mumbai',     openNow: true, isFallback: true },
  { id: 'fb_arcade_ezone_v',  name: 'E-Zone Inorbit Vashi',      category: 'ARCADE',      rating: 4.2, lat: 19.0734, lng: 72.9989, estimatedCostPerHead: 400,  address: 'Inorbit Mall, Vashi',     openNow: true, isFallback: true },
  { id: 'fb_arcade_xero',     name: 'Xero Degrees Andheri',      category: 'ARCADE',      rating: 4.1, lat: 19.1190, lng: 72.8580, estimatedCostPerHead: 350,  address: 'Andheri West, Mumbai',    openNow: true, isFallback: true },
  { id: 'fb_arcade_rcity',    name: 'Timezone R City Ghatkopar', category: 'ARCADE',      rating: 4.2, lat: 19.0860, lng: 72.9082, estimatedCostPerHead: 400,  address: 'R City Mall, Ghatkopar',  openNow: true, isFallback: true },
  { id: 'fb_arcade_viviana',  name: 'Funky Monkey Viviana Thane',category: 'ARCADE',      rating: 4.0, lat: 19.2087, lng: 73.0083, estimatedCostPerHead: 400,  address: 'Viviana Mall, Thane',     openNow: true, isFallback: true },
  { id: 'fb_arcade_bkc_timezone', name: 'Timezone Jio World Drive', category: 'ARCADE',   rating: 4.3, lat: 19.0605, lng: 72.8595, estimatedCostPerHead: 500,  address: 'Jio World Drive, BKC, Mumbai', openNow: true, isFallback: true },
  { id: 'fb_arcade_powai_game', name: 'The Game Powai',          category: 'ARCADE',      rating: 4.3, lat: 19.1176, lng: 72.9060, estimatedCostPerHead: 500,  address: 'Central Avenue, Powai, Mumbai', openNow: true, isFallback: true },
  { id: 'fb_arcade_kurla_timezone', name: 'Timezone Phoenix Marketcity', category: 'ARCADE', rating: 4.2, lat: 19.0880, lng: 72.8890, estimatedCostPerHead: 500, address: 'Phoenix Marketcity, Kurla, Mumbai', openNow: true, isFallback: true },

  // ── BOWLING ───────────────────────────────────────────────────────────────
  { id: 'fb_bowl_palacio_b',  name: 'The Game Palacio Bandra',   category: 'BOWLING',     rating: 4.6, lat: 19.0596, lng: 72.8295, estimatedCostPerHead: 900,  address: 'Bandra West, Mumbai',     openNow: true, isFallback: true },
  { id: 'fb_bowl_palacio_a',  name: 'The Game Palacio Andheri',  category: 'BOWLING',     rating: 4.5, lat: 19.1136, lng: 72.8697, estimatedCostPerHead: 900,  address: 'Andheri West, Mumbai',    openNow: true, isFallback: true },
  { id: 'fb_bowl_clubhouse',  name: 'Smaaash Bowling Lower Parel',category: 'BOWLING',    rating: 4.3, lat: 19.0034, lng: 72.8276, estimatedCostPerHead: 500,  address: 'Lower Parel, Mumbai',     openNow: true, isFallback: true },
  { id: 'fb_bowl_viviana',    name: 'Bowling Co Viviana Thane',  category: 'BOWLING',     rating: 4.1, lat: 19.2087, lng: 73.0083, estimatedCostPerHead: 500,  address: 'Viviana Mall, Thane',     openNow: true, isFallback: true },

  // ── ESCAPE ROOM ───────────────────────────────────────────────────────────
  { id: 'fb_escape_mystery_a',name: 'Mystery Rooms Andheri',     category: 'ESCAPE_ROOM', rating: 4.5, lat: 19.1190, lng: 72.8580, estimatedCostPerHead: 700,  address: 'Andheri West, Mumbai',    openNow: true, isFallback: true },
  { id: 'fb_escape_clue_b',   name: 'Clue Hunt Bandra',          category: 'ESCAPE_ROOM', rating: 4.4, lat: 19.0596, lng: 72.8295, estimatedCostPerHead: 750,  address: 'Bandra West, Mumbai',     openNow: true, isFallback: true },
  { id: 'fb_escape_breakout', name: 'Breakout Andheri',          category: 'ESCAPE_ROOM', rating: 4.3, lat: 19.1050, lng: 72.8650, estimatedCostPerHead: 700,  address: 'Andheri East, Mumbai',    openNow: true, isFallback: true },
  { id: 'fb_escape_riddle',   name: 'The Riddle Room Powai',     category: 'ESCAPE_ROOM', rating: 4.2, lat: 19.1176, lng: 72.9060, estimatedCostPerHead: 750,  address: 'Powai, Mumbai',           openNow: true, isFallback: true },

  // ── MUSEUM ────────────────────────────────────────────────────────────────
  { id: 'fb_museum_solutions',name: 'Museum of Solutions',        category: 'MUSEUM',      rating: 4.8, lat: 19.0080, lng: 72.8250, estimatedCostPerHead: 500,  address: 'Lower Parel, Mumbai',     openNow: true, isFallback: true },
  { id: 'fb_museum_csmt',     name: 'Chhatrapati Shivaji Museum', category: 'MUSEUM',     rating: 4.7, lat: 18.9267, lng: 72.8322, estimatedCostPerHead: 150,  address: 'Fort, Mumbai',            openNow: true, isFallback: true },
  { id: 'fb_museum_bdu',      name: 'Dr. Bhau Daji Lad Museum',  category: 'MUSEUM',      rating: 4.5, lat: 18.9789, lng: 72.8374, estimatedCostPerHead: 200,  address: 'Byculla, Mumbai',         openNow: true, isFallback: true },
  { id: 'fb_museum_nehru',    name: 'Nehru Science Centre',       category: 'MUSEUM',     rating: 4.3, lat: 19.0192, lng: 72.8169, estimatedCostPerHead: 80,   address: 'Worli, Mumbai',           openNow: true, isFallback: true },

  // ── MALL ──────────────────────────────────────────────────────────────────
  { id: 'fb_mall_phoenix',    name: 'Phoenix Mills Lower Parel',  category: 'MALL',        rating: 4.4, lat: 19.0002, lng: 72.8270, estimatedCostPerHead: 0,    address: 'Lower Parel, Mumbai',     openNow: true, isFallback: true },
  { id: 'fb_mall_inorbit',    name: 'Inorbit Mall Vashi',         category: 'MALL',        rating: 4.3, lat: 19.0734, lng: 72.9989, estimatedCostPerHead: 0,    address: 'Vashi, Navi Mumbai',      openNow: true, isFallback: true },
  { id: 'fb_mall_rcity',      name: 'R City Mall Ghatkopar',      category: 'MALL',        rating: 4.2, lat: 19.0860, lng: 72.9082, estimatedCostPerHead: 0,    address: 'Ghatkopar West, Mumbai',  openNow: true, isFallback: true },
  { id: 'fb_mall_viviana',    name: 'Viviana Mall Thane',         category: 'MALL',        rating: 4.4, lat: 19.2087, lng: 73.0083, estimatedCostPerHead: 0,    address: 'Thane West, Mumbai',      openNow: true, isFallback: true },
  { id: 'fb_mall_oberoi',     name: 'Oberoi Mall Goregaon',       category: 'MALL',        rating: 4.2, lat: 19.1610, lng: 72.8520, estimatedCostPerHead: 0,    address: 'Goregaon East, Mumbai',   openNow: true, isFallback: true },
  { id: 'fb_mall_palladium',  name: 'Palladium Mall Lower Parel', category: 'MALL',        rating: 4.3, lat: 19.0020, lng: 72.8270, estimatedCostPerHead: 0,    address: 'Lower Parel, Mumbai',     openNow: true, isFallback: true },
  { id: 'fb_mall_bkc_drive',  name: 'Jio World Drive',            category: 'MALL',        rating: 4.4, lat: 19.0605, lng: 72.8595, estimatedCostPerHead: 0,    address: 'Jio World Drive, BKC, Mumbai', openNow: true, isFallback: true },
  { id: 'fb_mall_kurla_phoenix', name: 'Phoenix Marketcity Kurla', category: 'MALL',       rating: 4.5, lat: 19.0880, lng: 72.8890, estimatedCostPerHead: 0,    address: 'LBS Marg, Kurla, Mumbai', openNow: true, isFallback: true },

  // ── SPORTS ────────────────────────────────────────────────────────────────
  { id: 'fb_sports_snow',     name: 'Snow World Mumbai',          category: 'SPORTS',      rating: 4.2, lat: 19.0607, lng: 72.8826, estimatedCostPerHead: 600,  address: 'Kurla West, Mumbai',      openNow: true, isFallback: true },
  { id: 'fb_sports_jumpzone', name: 'JumpZone Andheri',           category: 'SPORTS',      rating: 4.3, lat: 19.1180, lng: 72.8580, estimatedCostPerHead: 450,  address: 'Andheri West, Mumbai',    openNow: true, isFallback: true },
  { id: 'fb_sports_footsal',  name: 'Footsal Powai',              category: 'SPORTS',      rating: 4.2, lat: 19.1176, lng: 72.9060, estimatedCostPerHead: 300,  address: 'Powai, Mumbai',           openNow: true, isFallback: true },

  // ── MOVIE ─────────────────────────────────────────────────────────────────
  { id: 'fb_movie_pvr_bandra',name: 'PVR Cinemas Bandra',         category: 'MOVIE',       rating: 4.3, lat: 19.0596, lng: 72.8295, estimatedCostPerHead: 350,  address: 'Bandra West, Mumbai',     openNow: true, isFallback: true },
  { id: 'fb_movie_inox_a',    name: 'INOX Andheri',               category: 'MOVIE',       rating: 4.2, lat: 19.1136, lng: 72.8697, estimatedCostPerHead: 350,  address: 'Andheri West, Mumbai',    openNow: true, isFallback: true },
  { id: 'fb_movie_pvr_thane', name: 'PVR Cinemas Thane',          category: 'MOVIE',       rating: 4.2, lat: 19.2087, lng: 73.0083, estimatedCostPerHead: 300,  address: 'Viviana Mall, Thane',     openNow: true, isFallback: true },
  { id: 'fb_movie_pvr_vashi', name: 'PVR Cinemas Vashi',          category: 'MOVIE',       rating: 4.1, lat: 19.0734, lng: 72.9989, estimatedCostPerHead: 300,  address: 'Inorbit Mall, Vashi',     openNow: true, isFallback: true },

  // ── POTTERY / WORKSHOP ────────────────────────────────────────────────────
  { id: 'fb_pottery_bandra',  name: 'Bandra Pottery Lab',         category: 'POTTERY',     rating: 4.7, lat: 19.0500, lng: 72.8300, estimatedCostPerHead: 1200, address: 'Bandra West, Mumbai',     openNow: true, isExperience: true, isFallback: true },
  { id: 'fb_pottery_andheri', name: 'The Pottery Studio Andheri', category: 'POTTERY',     rating: 4.4, lat: 19.1190, lng: 72.8580, estimatedCostPerHead: 1000, address: 'Andheri West, Mumbai',    openNow: true, isExperience: true, isFallback: true },
];

export interface ItineraryTemplate {
  slot1: string[];
  slot1Act: boolean;
  slot2: string[];
  slot2Act: boolean;
  slot3: string[];
  slot3Act: boolean;
}

export const ITINERARY_TEMPLATES: ItineraryTemplate[] = [
  // 1. Arcade -> Restaurant -> Dessert
  { slot1: ['ARCADE'], slot1Act: true, slot2: ['RESTAURANT'], slot2Act: false, slot3: ['DESSERT'], slot3Act: false },
  // 2. Cafe -> Pottery -> Restaurant
  { slot1: ['CAFE'], slot1Act: false, slot2: ['POTTERY', 'WORKSHOP'], slot2Act: true, slot3: ['RESTAURANT'], slot3Act: false },
  // 3. Museum -> Mall -> Cafe
  { slot1: ['MUSEUM'], slot1Act: true, slot2: ['MALL'], slot2Act: true, slot3: ['CAFE'], slot3Act: false },
  // 4. Bowling -> Restaurant -> Park
  { slot1: ['BOWLING'], slot1Act: true, slot2: ['RESTAURANT'], slot2Act: false, slot3: ['PARK'], slot3Act: true },
  // 5. Escape room -> Restaurant -> Dessert
  { slot1: ['ESCAPE_ROOM'], slot1Act: true, slot2: ['RESTAURANT'], slot2Act: false, slot3: ['DESSERT'], slot3Act: false },
  // 6. Park -> Cafe -> Arcade
  { slot1: ['PARK'], slot1Act: true, slot2: ['CAFE'], slot2Act: false, slot3: ['ARCADE'], slot3Act: true },
  // 7. Art Gallery -> Restaurant -> Cafe
  { slot1: ['ART_GALLERY', 'MUSEUM'], slot1Act: true, slot2: ['RESTAURANT'], slot2Act: false, slot3: ['CAFE'], slot3Act: false },
  // 8. Sports -> Restaurant -> Dessert
  { slot1: ['SPORTS'], slot1Act: true, slot2: ['RESTAURANT'], slot2Act: false, slot3: ['DESSERT'], slot3Act: false },
  // 9. Cafe -> Painting -> Restaurant
  { slot1: ['CAFE'], slot1Act: false, slot2: ['PAINTING', 'WORKSHOP'], slot2Act: true, slot3: ['RESTAURANT'], slot3Act: false },
  // 10. Bowling -> Cafe -> Sports
  { slot1: ['BOWLING'], slot1Act: true, slot2: ['CAFE'], slot2Act: false, slot3: ['SPORTS', 'ARCADE'], slot3Act: true },
  // 11. Movie -> Restaurant -> Cafe
  { slot1: ['MOVIE'], slot1Act: true, slot2: ['RESTAURANT'], slot2Act: false, slot3: ['CAFE'], slot3Act: false },
  // 12. Park -> Restaurant -> Dessert
  { slot1: ['PARK'], slot1Act: true, slot2: ['RESTAURANT'], slot2Act: false, slot3: ['DESSERT'], slot3Act: false },
  // 13. Museum -> Cafe -> Mall
  { slot1: ['MUSEUM'], slot1Act: true, slot2: ['CAFE'], slot2Act: false, slot3: ['MALL'], slot3Act: true },
  // 14. Arcade -> Restaurant -> Park
  { slot1: ['ARCADE'], slot1Act: true, slot2: ['RESTAURANT'], slot2Act: false, slot3: ['PARK'], slot3Act: true },
  // 15. Workshop -> Cafe -> Dessert
  { slot1: ['WORKSHOP', 'POTTERY'], slot1Act: true, slot2: ['CAFE'], slot2Act: false, slot3: ['DESSERT'], slot3Act: false },
  // 16. Escape Room -> Cafe -> Restaurant
  { slot1: ['ESCAPE_ROOM'], slot1Act: true, slot2: ['CAFE'], slot2Act: false, slot3: ['RESTAURANT'], slot3Act: false },
  // 17. Park -> Cafe -> Restaurant
  { slot1: ['PARK'], slot1Act: true, slot2: ['CAFE'], slot2Act: false, slot3: ['RESTAURANT'], slot3Act: false },
  // 18. Museum -> Restaurant -> Dessert
  { slot1: ['MUSEUM'], slot1Act: true, slot2: ['RESTAURANT'], slot2Act: false, slot3: ['DESSERT'], slot3Act: false },
  // 19. Sports -> Cafe -> Arcade
  { slot1: ['SPORTS'], slot1Act: true, slot2: ['CAFE'], slot2Act: false, slot3: ['ARCADE'], slot3Act: true },
  // 20. Art Gallery -> Cafe -> Dessert
  { slot1: ['ART_GALLERY', 'MUSEUM'], slot1Act: true, slot2: ['CAFE'], slot2Act: false, slot3: ['DESSERT'], slot3Act: false },
  // 21. Bowling -> Cafe -> Dessert
  { slot1: ['BOWLING'], slot1Act: true, slot2: ['CAFE'], slot2Act: false, slot3: ['DESSERT'], slot3Act: false },
  // 22. Cafe -> Arcade -> Restaurant
  { slot1: ['CAFE'], slot1Act: false, slot2: ['ARCADE'], slot2Act: true, slot3: ['RESTAURANT'], slot3Act: false },
  // 23. Mall -> Cafe -> Dessert
  { slot1: ['MALL'], slot1Act: true, slot2: ['CAFE'], slot2Act: false, slot3: ['DESSERT'], slot3Act: false },
  // 24. Cafe -> Museum -> Restaurant
  { slot1: ['CAFE'], slot1Act: false, slot2: ['MUSEUM'], slot2Act: true, slot3: ['RESTAURANT'], slot3Act: false },
  // 25. Workshop -> Restaurant -> Dessert
  { slot1: ['WORKSHOP', 'PAINTING'], slot1Act: true, slot2: ['RESTAURANT'], slot2Act: false, slot3: ['DESSERT'], slot3Act: false },
  // 26. Arcade -> Cafe -> Restaurant
  { slot1: ['ARCADE'], slot1Act: true, slot2: ['CAFE'], slot2Act: false, slot3: ['RESTAURANT'], slot3Act: false },
  // 27. Park -> Cafe -> Movie
  { slot1: ['PARK'], slot1Act: true, slot2: ['CAFE'], slot2Act: false, slot3: ['MOVIE'], slot3Act: true },
  // 28. Escape Room -> Restaurant -> Park
  { slot1: ['ESCAPE_ROOM'], slot1Act: true, slot2: ['RESTAURANT'], slot2Act: false, slot3: ['PARK'], slot3Act: true },
  // 29. Cafe -> Sports -> Restaurant
  { slot1: ['CAFE'], slot1Act: false, slot2: ['SPORTS'], slot2Act: true, slot3: ['RESTAURANT'], slot3Act: false },
  // 30. Museum -> Cafe -> Restaurant
  { slot1: ['MUSEUM'], slot1Act: true, slot2: ['CAFE'], slot2Act: false, slot3: ['RESTAURANT'], slot3Act: false }
];

export const POPULAR_CHAINS = [
  'starbucks', 'social', 'barbeque nation', 'bbq nation', 'timezone',
  'mcdonald', 'pizza hut', 'domino', 'kfc', 'burger king', 'coffee day',
  'ccd', 'third wave', 'blue tokai', 'tea trails', 'natural ice cream',
  'naturals', 'theobroma', 'chili', 'subway', 'sbarro', 'pizza express',
  'mainland china', 'copper chimney', 'hard rock', 'smokey house',
  'smaaash', 'starbucks coffee'
];

export const isChain = (name: string): boolean => {
  const lower = name.toLowerCase();
  return POPULAR_CHAINS.some(chain => lower.includes(chain));
};

export function generateWhyRecommended(plan: any, groupData: any): string[] {
  const reasons: string[] = [];

  // 1. Travel compatibility
  if (plan.longestTravelTime <= 45) {
    reasons.push("✓ Everyone travels under 45 min");
  } else if (plan.longestTravelTime <= 60) {
    reasons.push("✓ Max travel time under 1 hour");
  } else {
    reasons.push("✓ Balanced travel times for group");
  }

  // 2. Budget compatibility
  if (plan.budgetTier === 'BUDGET_FRIENDLY' || plan.budgetTier === 'TRAVEL_FRIENDLY') {
    reasons.push("✓ Highly pocket-friendly costs");
  } else if (plan.budgetScore >= 0.8) {
    reasons.push("✓ Fits group budget parameters");
  }

  // 3. Venue quality / Highest rated
  const slots = plan.slots || [];
  const ratings = slots.map((s: any) => s.rating).filter((r: any) => r !== null && r !== undefined);
  if (ratings.length > 0) {
    const maxRating = Math.max(...ratings);
    if (maxRating >= 4.5) {
      const bestSlot = slots.find((s: any) => s.rating === maxRating);
      reasons.push(`✓ Includes top-rated ${bestSlot?.name || 'venue'} (${maxRating}★)`);
    } else {
      reasons.push("✓ High quality venue selection");
    }
  }

  // 4. Weather / Monsoon safety
  const isRainySeason = (() => {
    if (!groupData?.outingDate) return false;
    const parts = groupData.outingDate.split('-');
    if (parts.length < 2) return false;
    const month = parseInt(parts[1]);
    return [6, 7, 8].includes(month); // June, July, August
  })();
  if (isRainySeason) {
    const hasOutdoor = slots.some((s: any) => ['PARK', 'PROMENADE', 'BEACH', 'OUTDOOR'].includes(s.category.toUpperCase()));
    if (!hasOutdoor) {
      reasons.push("✓ 100% indoor/monsoon protected");
    } else {
      reasons.push("✓ Monsoon active - outdoor travel caution");
    }
  }

  // 5. Vibe / Preference fit
  const overallFit = Math.round(plan.score * 100);
  reasons.push(`✓ Fits ${overallFit}% of preferences`);

  return reasons;
}


const VENUE_DESCRIPTIONS: Record<string, string> = {
  'fb_cafe_prithvi': 'Legendary open-air garden café next to Prithvi Theatre. Renowned for its Irish coffee, cutting chai, samosas, and artistic crowd.',
  'fb_cafe_candies': 'An iconic, multi-level villa café in Bandra with quirky Mediterranean decor, cold coffee, chicken sliders, and outdoor seating.',
  'fb_cafe_doolally_k': 'Mumbai\'s favorite craft microbrewery taproom. Great collection of craft beers, house fries, board games, and dog-friendly vibes.',
  'fb_cafe_doolally_a': 'Mumbai\'s favorite craft microbrewery taproom. Great collection of craft beers, house fries, board games, and dog-friendly vibes.',
  'fb_cafe_bkc_social': 'Vibrant workspace by day and high-energy bar by night. Quirky industrial decor, signature cocktails, and modern fusion snacks.',
  'fb_cafe_powai_social': 'Vibrant workspace by day and high-energy bar by night. Quirky industrial decor, signature cocktails, and modern fusion snacks.',
  'fb_cafe_kurla_starbucks': 'Cozy coffee house inside Phoenix Marketcity. Perfect for warm conversations and relaxing over premium craft coffee.',
  'fb_rest_joeys_a': 'Famous local deep-dish pizza spot known for incredibly generous toppings and loaded cheese. A legendary cult favorite in Mumbai.',
  'fb_rest_cafe_madras': 'Famous heritage South Indian joint in Matunga. Renowned for butter idlis, ragi dosa, and authentic filter coffee.',
  'fb_rest_swati': 'Premium traditional Gujarati/Maharashtrian street food spot. Hygienic, highly rated, and perfect for light, delicious bites.',
  'fb_rest_pav_bhaji': 'Legendary butter-loaded Mumbai pav bhaji spot. A historic culinary landmark in Mumbai.',
  'fb_rest_pizza_bay': 'Beautiful seaside restaurant at Marine Drive. Enjoy premium pizzas and mocktails with a breathtaking view of the Queen\'s Necklace.',
  'fb_rest_bkc_dishoom': 'Premium coastal Portuguese-Goan dining spot in BKC. Known for craft cocktails, seafood, and beautiful high-ceiling vintage decor.',
  'fb_rest_powai_chilis': 'Great American-Mexican grill restaurant with amazing burgers, sizzlers, and margaritas overlooking the Powai streets.',
  'fb_rest_kurla_barbeque': 'Popular live-grill buffet dining. Features unlimited skewers of barbecue starters, main course, and extensive desserts.',
  'fb_park_sion_fort': 'Historical watchtower fort built in 1670. Climb to the top for a green, peaceful panoramic view of central Mumbai (45-60 min).',
  'fb_park_marine': 'Seaside promenade with a stunning view of the Arabian Sea. Unwind, catch the breeze, and watch the sunset (45-60 min).',
  'fb_park_carter': 'Scenic 1.2km Bandra seaside walk. Features food stalls, dog parks, and sunset viewing decks (45-60 min).',
  'fb_park_versova': 'Relaxed sandy beach in Andheri West. Ideal for evening walks, catching the sunset, and chatting with friends.',
  'fb_park_bkc_garden': 'Lush, manicured 13-acre rooftop garden in BKC. Hosts events and has peaceful green trails (45-60 min).',
  'fb_park_powai_lake': 'Peaceful lakeside walking path. Watch local fishermen, enjoy the greenery, and catch the sunset.',
  'fb_arcade_smaaash': 'Sprawling gaming hub in Lower Parel. Features 50+ arcade titles, virtual reality rides, laser tag, and active sports.',
  'fb_arcade_xero': 'Trendy student-vibe arcade café in Andheri. Indulge in crazy freakshakes, loaded fries, and classic video game cabinets.',
  'fb_arcade_rcity': 'Timezone Ghatkopar. Massive indoor arcade with ticket games, bowling lanes, bumper cars, and virtual reality simulators.',
  'fb_arcade_bkc_timezone': 'Premium Timezone arcade. Features 40+ high-end arcade game cabinets, active VR gaming, and group racing setups.',
  'fb_arcade_powai_game': 'Boutique gaming lounge in Powai. Features boutique bowling lanes, arcade game consoles, and virtual reality setups.',
  'fb_arcade_kurla_timezone': 'Timezone Marketcity. Huge indoor arcade with ticket games, simulator rides, bowling lanes, and laser setups.',
  'fb_bowl_palacio_b': 'Premium boutique bowling alley in Bandra. Features luxury wooden lanes, dining lounge, and arcade games.',
  'fb_bowl_palacio_a': 'Premium boutique bowling alley in Andheri. Features luxury wooden lanes, dining lounge, and arcade games.',
  'fb_bowl_clubhouse': 'Smaaash Bowling Lower Parel. Classic multi-lane bowling center with lively music and group dining tables.',
  'fb_bowl_viviana': 'Large bowling alley inside Viviana Mall. Great for casual group challenges and weekend fun.',
  'fb_escape_mystery_a': 'Interactive real-life escape room. Work together in teams of 2-8 to solve puzzles and escape within 60 minutes.',
  'fb_escape_clue_b': 'Mumbai\'s original escape game in Bandra. Crack codes, find clues, and escape the room before the timer run out.',
  'fb_museum_nehru': 'Interactive science museum with 500+ hands-on science exhibits, 3D science shows, and a space dome.',
  'fb_mall_phoenix': 'High-end luxury shopping district and mall. Sprawling food options, cafes, and open courtyards.',
  'fb_mall_rcity': 'Massive shopping mall in Ghatkopar. Features 500+ stores, dynamic snow park, and multi-screen cinemas.',
  'fb_mall_kurla_phoenix': 'One of India\'s largest malls. Features snow park, 100+ dining options, movie theaters, and shopping brands.',
  'fb_mall_bkc_drive': 'Boutique luxury shopping center in BKC. Features high-end brands, fine cafes, and open walk paths.',
};


export function buildFallbackItineraryDataForEval(
  planIndex: number,
  groupData: any,
  presentMembers: any[],
  presentLocations: any[],
  memberLocations?: LatLng[],
  groupBudget?: number
) {
  return buildFallbackItineraryData(planIndex, groupData, presentMembers, presentLocations, memberLocations, groupBudget);
}

function getDurationForCategory(category: string): number {
  const cat = category.toUpperCase();
  if (cat === 'PARK') return 60;
  if (cat === 'DESSERT') return 45;
  if (cat === 'CAFE') return 90;
  if (cat === 'RESTAURANT') return 90;
  if (cat === 'MALL') return 120;
  if (cat === 'ARCADE' || cat === 'BOWLING') return 120;
  if (cat === 'ESCAPE_ROOM') return 90;
  if (cat === 'MUSEUM') return 120;
  if (cat === 'SPORTS' || cat === 'POTTERY' || cat === 'WORKSHOP') return 120;
  return 90;
}

function getFallbackSlotDescription(slotId: string, slotName: string, category: string, order: number, groupType: string, zoneName: string): string {
  if (VENUE_DESCRIPTIONS[slotId]) {
    return VENUE_DESCRIPTIONS[slotId];
  }
  
  const gType = (groupType || 'friends').toLowerCase();
  const names: Record<string, string> = {
    'CAFE': `Chill local café in ${zoneName}. Grab some coffee, check out the menu, and chat while everyone gathers.`,
    'RESTAURANT': `Top-rated dining spot in ${zoneName}. Recharge and share stories over delicious dishes together.`,
    'PARK': `Scenic local spot in ${zoneName}. Catch the evening breeze, walk around, and take group photos (45-60 min).`,
    'MALL': `Sprawling shopping space in ${zoneName}. Window shop, cool off in the AC, and explore group hangouts.`,
    'DESSERT': `Sweet ending spot in ${zoneName}. Grab milkshakes, ice cream, or waffles for a great final chat.`,
    'ARCADE': `High-energy gaming arcade in ${zoneName}. Unleash your competitive streak with simulator games and group challenges.`,
    'BOWLING': `Luxury bowling center in ${zoneName}. Lace up your bowling shoes and challenge the group to a match.`,
    'ESCAPE_ROOM': `Interactive escape game in ${zoneName}. Put your heads together, crack the clues, and escape.`,
    'MUSEUM': `Interactive local museum in ${zoneName}. Explore exhibits and interactive displays together.`,
    'SPORTS': `Active sports arena in ${zoneName}. Fun and games for the group to get the blood pumping.`,
  };
  return names[category.toUpperCase()] || `Meet up at ${slotName} in ${zoneName} to hang out with the ${gType}.`;
}

function buildFallbackItineraryData(
  planIndex: number,
  groupData: any,
  presentMembers: any[],
  presentLocations: any[],
  memberLocations?: LatLng[],
  groupBudget?: number,
  globalUsedPlaceIds?: Set<string>
) {
  const budgetTiers = ['TRAVEL_FRIENDLY', 'BUDGET_FRIENDLY', 'BALANCED', 'EXPERIENCE_FIRST'] as const;
  const budgetTier = budgetTiers[(planIndex - 1) % 4];

  // Dynamically pick best zone from member locations instead of using hardcoded zones
  const locs = memberLocations && memberLocations.length > 0
    ? memberLocations
    : presentLocations.map((l: any) => ({ lat: l.lat, lng: l.lng }));

  const rankedZones = locs.length > 0 ? selectCandidateZones(locs) : [
    { name: 'Bandra', lat: 19.0596, lng: 72.8295 },
    { name: 'Dadar', lat: 19.0178, lng: 72.8478 },
    { name: 'Kurla', lat: 19.0607, lng: 72.8826 },
    { name: 'Ghatkopar', lat: 19.0860, lng: 72.9082 },
  ];

  const zoneIdx = (planIndex - 1) % Math.max(1, rankedZones.length);
  const zoneObj = rankedZones[zoneIdx];

  const budgetCap = groupBudget && groupBudget > 0 ? groupBudget : 5000;
  const TRAVEL_EST = 80;
  const venueTotal = Math.max(0, budgetCap - TRAVEL_EST);

  const outingHour = (() => {
    const t = groupData.outingTime || '12:00';
    const m = t.match(/^(\d{1,2}):(\d{2})/);
    return m ? parseInt(m[1]) : 12;
  })();

  const hasMoviePreference = (groupData.activity && String(groupData.activity).toLowerCase().includes('movie')) ||
    (groupData.outingType && String(groupData.outingType).toLowerCase().includes('movie'));

  const rankedPoolSorted = MUMBAI_FALLBACK_CANDIDATES
    .filter(c => hasMoviePreference || c.category.toUpperCase() !== 'MOVIE')
    .map(c => ({ ...c, _d: getHaversineDistance({ lat: zoneObj.lat, lng: zoneObj.lng }, { lat: c.lat, lng: c.lng }), imageUrl: c.imageUrl || getFallbackImageUrl(c.category) }))
    .filter(c => c._d <= 4.5) // Restrict fallback candidates to a tight 4.5km radius to prevent location mismatch
    .sort((a, b) => a._d - b._d)
    .map(({ _d: _, ...c }) => c as PlaceCandidate);

  // Fisher-Yates shuffle within distance tiers to ensure different venues on each regeneration
  // Group by distance tier (0-1.5km, 1.5-3km, 3-4.5km) then shuffle within each tier
  const rankedPool = [...rankedPoolSorted];
  const shuffleRange = (arr: PlaceCandidate[], start: number, end: number) => {
    for (let i = Math.min(end, arr.length - 1); i > start; i--) {
      const j = start + Math.floor(Math.random() * (i - start + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  };
  // Find tier boundaries
  const tier1End = rankedPool.findIndex(c => getHaversineDistance({ lat: zoneObj.lat, lng: zoneObj.lng }, { lat: c.lat, lng: c.lng }) > 1.5);
  const tier2End = rankedPool.findIndex(c => getHaversineDistance({ lat: zoneObj.lat, lng: zoneObj.lng }, { lat: c.lat, lng: c.lng }) > 3.0);
  if (tier1End > 0) shuffleRange(rankedPool, 0, tier1End - 1);
  if (tier2End > tier1End) shuffleRange(rankedPool, Math.max(0, tier1End), tier2End - 1);
  if (tier2End >= 0 && tier2End < rankedPool.length) shuffleRange(rankedPool, tier2End, rankedPool.length - 1);

  const globalUsed = globalUsedPlaceIds || new Set<string>();

  function pickAffordableSlots(): PlaceCandidate[] {
    const used = new Set<string>();
    const picks: PlaceCandidate[] = [];

    let requiredCats: string[] = [];
    let maxCosts: number[] = [Infinity, Infinity, Infinity];

    if (budgetTier === 'BUDGET_FRIENDLY') {
      requiredCats = ['MALL', 'CAFE', 'PARK'];
      maxCosts = [0, 250, 0];
    } else if (budgetTier === 'TRAVEL_FRIENDLY') {
      requiredCats = ['PARK', 'CAFE', 'DESSERT'];
      maxCosts = [0, 300, 250];
    } else if (budgetTier === 'EXPERIENCE_FIRST') {
      requiredCats = [
        (rankedPool.some(c => c.category === 'BOWLING') ? 'BOWLING' : 'ARCADE'),
        'RESTAURANT',
        'DESSERT'
      ];
      maxCosts = [Infinity, Infinity, Infinity];
    } else { // BALANCED
      requiredCats = ['ARCADE', 'RESTAURANT', 'PARK'];
      maxCosts = [600, 500, 0];
    }

    for (let i = 0; i < 3; i++) {
      const cat = requiredCats[i];
      const maxC = maxCosts[i];

      // Pick from top-3 matching candidates randomly instead of always the first match
      const matchingCandidates = rankedPool.filter(c =>
        c.category.toUpperCase() === cat &&
        !used.has(c.id) &&
        !globalUsed.has(c.id) &&
        c.estimatedCostPerHead <= maxC &&
        isVenueOpenAtTime(c.category, groupData.outingTime)
      );
      const top3 = matchingCandidates.slice(0, 3);
      let candidate: PlaceCandidate | undefined;
      if (top3.length > 0) {
        candidate = top3[Math.floor(Math.random() * top3.length)];
      }

      if (!candidate) {
        const relaxedMatches = rankedPool.filter(c =>
          c.category.toUpperCase() === cat &&
          !used.has(c.id) &&
          !globalUsed.has(c.id) &&
          isVenueOpenAtTime(c.category, groupData.outingTime)
        );
        if (relaxedMatches.length > 0) {
          candidate = relaxedMatches[Math.floor(Math.random() * Math.min(3, relaxedMatches.length))];
        }
      }

      if (!candidate) {
        const anyCatMatches = rankedPool.filter(c =>
          !used.has(c.id) &&
          !globalUsed.has(c.id) &&
          c.estimatedCostPerHead <= maxC &&
          isVenueOpenAtTime(c.category, groupData.outingTime)
        );
        if (anyCatMatches.length > 0) {
          candidate = anyCatMatches[Math.floor(Math.random() * Math.min(3, anyCatMatches.length))];
        }
      }

      if (candidate) {
        picks.push(candidate);
        used.add(candidate.id);
        globalUsed.add(candidate.id);
      }
    }

    while (picks.length < 3) {
      const pad = rankedPool.find(c => !used.has(c.id) && !globalUsed.has(c.id));
      if (pad) {
        picks.push(pad);
        used.add(pad.id);
        globalUsed.add(pad.id);
      } else {
        const categories = ['CAFE', 'RESTAURANT', 'PARK', 'MALL'];
        const cat = categories[picks.length % categories.length];
        const names: Record<string, string> = {
          'CAFE': `Cozy Café in ${zoneObj.name}`,
          'RESTAURANT': `Vibrant Dining in ${zoneObj.name}`,
          'PARK': `${zoneObj.name} Scenic Walkway`,
          'MALL': `${zoneObj.name} Shopping Spot`
        };
        const mockId = `fb_mock_${zoneObj.name.toLowerCase()}_${cat.toLowerCase()}_${picks.length}`;
        const mockCand: PlaceCandidate = {
          id: mockId,
          name: names[cat] || `Hangout Spot in ${zoneObj.name}`,
          category: cat as any,
          rating: 4.5,
          lat: zoneObj.lat + (Math.random() - 0.5) * 0.005,
          lng: zoneObj.lng + (Math.random() - 0.5) * 0.005,
          estimatedCostPerHead: cat === 'PARK' ? 0 : (cat === 'CAFE' ? 250 : 400),
          address: `${zoneObj.name}, Mumbai`,
          openNow: true,
          isFallback: true
        };
        picks.push(mockCand);
        used.add(mockId);
        globalUsed.add(mockId);
      }
    }
    return picks.slice(0, 3);
  }

  const selectedPlaces = pickAffordableSlots();

  const slots = selectedPlaces.map((place, slotIdx) => {
    const duration = getDurationForCategory(place.category);
    let arrivalTime = groupData.outingTime || '11:00 AM';
    if (slotIdx > 0) {
      let prevTime = groupData.outingTime || '11:00 AM';
      for (let i = 0; i < slotIdx; i++) {
        const prevPlace = selectedPlaces[i];
        const prevDuration = getDurationForCategory(prevPlace.category);
        const prevTransit = 15;
        prevTime = addMinutesToTimeString(prevTime, prevDuration + prevTransit);
      }
      arrivalTime = prevTime;
    }

    let mandatoryCost = place.estimatedCostPerHead;
    let optionalCostMin = 0;
    let optionalCostMax = 0;

    if (['CAFE', 'RESTAURANT', 'DESSERT'].includes(place.category.toUpperCase())) {
      const est = place.estimatedCostPerHead;
      mandatoryCost = Math.round(est * 0.4);
      optionalCostMin = Math.round(est * 0.6);
      optionalCostMax = Math.round(est * 1.5);
    } else if (place.isExperience) {
      mandatoryCost = place.estimatedCostPerHead;
      optionalCostMin = 0;
      optionalCostMax = 0;
    } else {
      const est = place.estimatedCostPerHead;
      mandatoryCost = Math.round(est * 0.7);
      optionalCostMin = Math.round(est * 0.3);
      optionalCostMax = Math.round(est * 1.0);
    }

    return {
      order: slotIdx + 1,
      venueId: place.isExperience ? null : place.id,
      experienceId: place.isExperience ? place.id : null,
      name: place.name,
      category: place.category,
      arrivalTime,
      durationMinutes: duration,
      travelToNextMinutes: slotIdx === 2 ? null : 15,
      estimatedCostPerHead: place.estimatedCostPerHead,
      mandatoryCost,
      optionalCostMin,
      optionalCostMax,
      imageUrl: place.imageUrl || getFallbackImageUrl(place.category),
      link: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name + ' ' + place.address)}`,
      note: getFallbackSlotDescription(place.id, place.name, place.category, slotIdx + 1, groupData.groupType || 'friends', zoneObj.name),
      lat: place.lat,
      lng: place.lng,
      address: place.address || ''
    };
  });

  for (let sIdx = 0; sIdx < slots.length - 1; sIdx++) {
    const current = slots[sIdx];
    const next = slots[sIdx + 1];
    const slotDist = getHaversineDistance({ lat: current.lat, lng: current.lng }, { lat: next.lat, lng: next.lng });

    const travelMin = Math.max(15, Math.round(slotDist * 4.0) + 5);
    const travelCost = Math.round(23 + Math.max(0, slotDist - 1.5) * 15);

    current.travelToNextMinutes = travelMin;
    (current as any).travelToNextCost = Math.ceil(travelCost / Math.min(3, presentMembers.length));
    // Propagate corrected arrival time to the next slot
    next.arrivalTime = addMinutesToTimeString(current.arrivalTime, current.durationMinutes + travelMin);
  }

  const memberTravelsForPlan: any[] = [];
  const totalTimes: number[] = [];
  const totalCosts: number[] = [];

  presentLocations.forEach(loc => {
    const breakdown = calculateMumbaiTravelBreakdown({ lat: loc.lat, lng: loc.lng }, { lat: zoneObj.lat, lng: zoneObj.lng }, groupData.outingTime);
    
    totalTimes.push(breakdown.totalTime);
    totalCosts.push(breakdown.totalCost);

    const travelId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : require('crypto').randomUUID();

    memberTravelsForPlan.push({
      id: travelId,
      userId: loc.userId,
      walkingTime: breakdown.walkingTime,
      autoTime: breakdown.autoTime,
      autoCost: breakdown.autoCost,
      trainTime: breakdown.trainTime,
      trainCost: breakdown.trainCost,
      totalTime: breakdown.totalTime,
      totalCost: breakdown.totalCost,
      train_time: breakdown.trainTime,
      train_cost: breakdown.trainCost,
      cab_time: breakdown.autoTime,
      cab_cost: breakdown.autoCost,
      walk_time: breakdown.walkingTime
    });
  });

  const avgTotalTime = Math.round(totalTimes.reduce((sum, t) => sum + t, 0) / totalTimes.length);
  const avgTotalCost = Math.round(totalCosts.reduce((sum, c) => sum + c, 0) / totalCosts.length);
  const longestTravelTime = Math.max(...totalTimes);
  const shortestTravelTime = Math.min(...totalTimes);

  const variance = totalTimes.reduce((sum, t) => sum + Math.pow(t - avgTotalTime, 2), 0) / totalTimes.length;
  const stdDev = Math.sqrt(variance);
  let travelFairnessScore = stdDev <= 10 ? 1.0 : Math.max(0.0, 1.0 - (stdDev - 10) / 30.0);

  const slotsMandatoryCost = slots.reduce((sum, s) => sum + s.mandatoryCost, 0);
  const slotsOptionalMin = slots.reduce((sum, s) => sum + s.optionalCostMin, 0);
  const slotsOptionalMax = slots.reduce((sum, s) => sum + s.optionalCostMax, 0);

  const totalMandatoryCost = slotsMandatoryCost + avgTotalCost;

  const planId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : require('crypto').randomUUID();

  const avgTrainTime = memberTravelsForPlan.length > 0
    ? Math.round(memberTravelsForPlan.reduce((s, m) => s + (m.trainTime || 0), 0) / memberTravelsForPlan.length)
    : 0;
  const avgTrainCost = memberTravelsForPlan.length > 0
    ? Math.round(memberTravelsForPlan.reduce((s, m) => s + (m.trainCost || 0), 0) / memberTravelsForPlan.length)
    : 0;
  const avgAutoTime = memberTravelsForPlan.length > 0
    ? Math.round(memberTravelsForPlan.reduce((s, m) => s + (m.autoTime || 0), 0) / memberTravelsForPlan.length)
    : 0;
  const avgAutoCost = memberTravelsForPlan.length > 0
    ? Math.round(memberTravelsForPlan.reduce((s, m) => s + (m.autoCost || 0), 0) / memberTravelsForPlan.length)
    : 0;
  const avgWalkTime = memberTravelsForPlan.length > 0
    ? Math.round(memberTravelsForPlan.reduce((s, m) => s + (m.walkingTime || 0), 0) / memberTravelsForPlan.length)
    : 0;

  let tagline = `A wonderful day out in ${zoneObj.name}.`;
  if (budgetTier === 'TRAVEL_FRIENDLY') {
    tagline = `A commute-optimized day out in ${zoneObj.name} designed to minimize travel for everyone.`;
  } else if (budgetTier === 'BUDGET_FRIENDLY') {
    tagline = `A pocket-friendly day out exploring scenic walks and cozy local spots in ${zoneObj.name}.`;
  } else if (budgetTier === 'BALANCED') {
    tagline = `A well-balanced itinerary featuring top-rated cafes and relaxing spots in ${zoneObj.name}.`;
  } else if (budgetTier === 'EXPERIENCE_FIRST') {
    tagline = `An excitement-filled day highlighting the best food, gaming, and premium experiences in ${zoneObj.name}.`;
  }

  let whyRecommended: string[] = [];
  if (budgetTier === 'TRAVEL_FRIENDLY') {
    whyRecommended = [
      "Optimized for minimal travel time",
      `Average travel time ${avgTotalTime} minutes`,
      `Longest commute only ${longestTravelTime} minutes`,
      "Fairly distributed transit costs"
    ];
  } else if (budgetTier === 'BUDGET_FRIENDLY') {
    whyRecommended = [
      "Lowest overall cost per head",
      `98% budget compatibility`,
      "Pocket-friendly cafes and stops",
      "Saves budget for future outings"
    ];
  } else if (budgetTier === 'BALANCED') {
    whyRecommended = [
      "Best overall match score",
      `Average travel time ${avgTotalTime} mins`,
      `Matches ${groupData.groupType?.toLowerCase() || 'friends'} vibe`,
      "Highly rated popular spots"
    ];
  } else { // EXPERIENCE_FIRST
    whyRecommended = [
      "Top-rated experiences nearby",
      "Premium food and entertainment",
      "Includes trending group activities",
      "Highest overall venue ratings"
    ];
  }

  return {
    id: planId,
    groupId: groupData.id,
    planIndex,
    name: zoneObj.name,
    tagline,
    budgetTier,
    totalEstimatedCostPerHead: totalMandatoryCost + slotsOptionalMin,
    totalDurationMinutes: slots.reduce((sum, s) => sum + s.durationMinutes, 0) + (slots[0].travelToNextMinutes || 0) + (slots[1].travelToNextMinutes || 0),
    score: budgetTier === 'BALANCED' ? 0.95 : (budgetTier === 'TRAVEL_FRIENDLY' ? 0.92 : (budgetTier === 'EXPERIENCE_FIRST' ? 0.88 : 0.82)),

    experienceScore: budgetTier === 'EXPERIENCE_FIRST' ? 0.95 : 0.82,
    travelScore: budgetTier === 'TRAVEL_FRIENDLY' ? 0.95 : 0.82,
    budgetScore: budgetTier === 'BUDGET_FRIENDLY' ? 0.95 : 0.78,
    fairnessScore: travelFairnessScore,
    popularityScore: 0.90,
    groupTypeMatchScore: 1.0,
    vibeMatchScore: 1.0,
    compositeScore: budgetTier === 'BALANCED' ? 0.95 : (budgetTier === 'TRAVEL_FRIENDLY' ? 0.92 : (budgetTier === 'EXPERIENCE_FIRST' ? 0.88 : 0.82)),

    avgTrainTime,
    avgCabTime: avgAutoTime,
    avgTrainCost,
    avgCabCost: avgAutoCost,
    longestTravelTime,
    shortestTravelTime,
    travelFairnessScore,

    avgAutoTime,
    avgAutoCost,
    avgTotalTime,
    avgTotalCost,
    avgWalkTime,
    mandatoryCost: totalMandatoryCost,
    optionalCostMin: slotsOptionalMin,
    optionalCostMax: slotsOptionalMax,
    whyRecommended,
    slots,
    memberTravels: memberTravelsForPlan
  };
}

// ─── Reactive self-heal helpers ───────────────────────────────────────────────

async function getReactiveBudgetRemaining(): Promise<number> {
  const today = new Date().toISOString().split('T')[0];
  try {
    const rows = await db
      .select()
      .from(apiBudget)
      .where(and(eq(apiBudget.dayUtc, today), eq(apiBudget.source, 'reactive')))
      .limit(1);
    const row = rows[0];
    return row ? Math.max(0, row.callsLimit - row.callsUsed) : 300;
  } catch {
    return 300;
  }
}

async function incrementReactiveBudget(): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const now = new Date().toISOString();
  try {
    const uuid = typeof crypto !== 'undefined' ? crypto.randomUUID() : require('crypto').randomUUID();
    try {
      await db.insert(apiBudget).values({
        id: uuid, dayUtc: today, source: 'reactive',
        callsUsed: 1, callsLimit: 300, updatedAt: now,
      });
    } catch {
      await db.update(apiBudget)
        .set({ callsUsed: sql`calls_used + 1`, updatedAt: now })
        .where(and(eq(apiBudget.dayUtc, today), eq(apiBudget.source, 'reactive')));
    }
  } catch {
    // Non-critical
  }
}

async function reactiveVenueFetch(
  zone: { name: string; lat: number; lng: number },
  missingCategories: string[]
): Promise<PlaceCandidate[]> {
  const remaining = await getReactiveBudgetRemaining();
  if (remaining <= 0) {
    console.log('[REACTIVE] API budget exhausted today, skipping reactive fetch');
    return [];
  }

  const fetched: PlaceCandidate[] = [];
  const now = new Date().toISOString();
  const maxToFetch = Math.min(missingCategories.length, 3, remaining);

  for (const category of missingCategories.slice(0, maxToFetch)) {
    try {
      const results = await searchNearbyVenues(zone.lat, zone.lng, category as VenueCategory, 2500);
      await incrementReactiveBudget();

      for (const item of results.slice(0, 5)) {
        const placeId = item.place_id;
        if (!placeId) continue;

        const placeLat = item.geometry?.location?.lat ?? item.lat;
        const placeLng = item.geometry?.location?.lng ?? item.lng;
        if (!placeLat || !placeLng || !validateCoordinates(placeLat, placeLng)) continue;

        const name = item.name || item.description || '';
        if (name.length < 3) continue;

        const rating = item.rating ? Number(item.rating) : null;
        const reviewCount = item.user_ratings_total || 0;
        // Only reject if we have enough evidence the venue is genuinely bad.
        if (rating !== null && rating > 0 && reviewCount > 0 && (rating < 4.0 || reviewCount < 20)) continue;

        const id = `GOOGLE_${placeId}`;
        const costs = REACTIVE_CATEGORY_COSTS[category] ?? { mandatory: 200, min: 0, max: 400 };
        const popularity = rating ? rating / 5.0 : 0.5;
        const budgetFriendliness = Math.max(0, Math.min(1, 1.0 - (costs.mandatory / 1500)));
        const overall = (popularity + 0.5 + 0.8) / 3.0;

        try {
          const randomUUID = () => typeof crypto !== 'undefined' ? crypto.randomUUID() : require('crypto').randomUUID();

          await db.insert(places).values({
            id, name,
            address: item.formatted_address || item.vicinity || '',
            lat: placeLat, lng: placeLng,
            rating, reviewCount,
            sourceName: 'GOOGLE', sourcePlaceId: placeId,
            lastVerified: now, verifiedAt: now,
            firstSeen: now, businessStatus: 'OPERATIONAL',
            createdAt: now, updatedAt: now,
          }).onConflictDoUpdate({
            target: places.id,
            set: { lastVerified: now, updatedAt: now, rating, reviewCount },
          });

          await db.insert(placeCategories).values({ id: randomUUID(), placeId: id, category })
            .onConflictDoUpdate({ target: [placeCategories.placeId, placeCategories.category], set: { category } });

          const expType = ['BOWLING', 'ARCADE', 'MUSEUM', 'POTTERY', 'ESCAPE_ROOM'].includes(category)
            ? 'PRIMARY_EXPERIENCE'
            : ['CAFE', 'RESTAURANT', 'DESSERT'].includes(category)
              ? 'FOOD_STOP'
              : 'OPTIONAL_STOP';
          await db.insert(placeCategories).values({ id: randomUUID(), placeId: id, category: expType })
            .onConflictDoUpdate({ target: [placeCategories.placeId, placeCategories.category], set: { category: expType } });

          await db.insert(placeCosts).values({
            placeId: id, mandatoryCost: costs.mandatory,
            optionalCostMin: costs.min, optionalCostMax: costs.max,
          }).onConflictDoUpdate({
            target: placeCosts.placeId,
            set: { mandatoryCost: costs.mandatory, optionalCostMin: costs.min, optionalCostMax: costs.max },
          });

          await db.insert(placeScores).values({
            placeId: id, popularity, budgetFriendliness, conversation: 0.5,
            groupSuitability: 0.7, dateSuitability: 0.7, friendsSuitability: 0.7,
            familySuitability: 0.7, weatherSuitability: 0.8, uniqueness: 0.6,
            experienceScore: 0.8, overall,
          }).onConflictDoUpdate({
            target: placeScores.placeId,
            set: { popularity, overall },
          });

          fetched.push({
            id, name, category,
            rating: rating ?? 4.0,
            lat: placeLat, lng: placeLng,
            estimatedCostPerHead: costs.mandatory + costs.min,
            address: item.formatted_address || item.vicinity || '',
            openNow: true, isFallback: false,
          } as any);
        } catch (insertErr) {
          console.error(`[REACTIVE] DB insert failed for ${id}:`, insertErr);
        }
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        console.error(`[REACTIVE] searchNearbyVenues failed for ${category} in ${zone.name}:`, err);
      }
    }
  }

  console.log(`[REACTIVE] Added ${fetched.length} venues for ${zone.name} — gaps: ${missingCategories.slice(0, maxToFetch).join(', ')}`);
  return fetched;
}

function enqueueGapDiscovery(
  zone: { name: string; lat: number; lng: number; radius?: number },
  categories: string[]
): void {
  void (async () => {
    const now = new Date().toISOString();
    for (const cat of categories) {
      try {
        const existing = await db
          .select({ id: discoveryQueue.id })
          .from(discoveryQueue)
          .where(and(
            eq(discoveryQueue.zoneName, zone.name),
            eq(discoveryQueue.category, cat),
            eq(discoveryQueue.status, 'PENDING')
          ))
          .limit(1);
        if (existing.length > 0) continue;

        const uuid = typeof crypto !== 'undefined' ? crypto.randomUUID() : require('crypto').randomUUID();
        await db.insert(discoveryQueue).values({
          id: uuid, zoneName: zone.name,
          zoneLat: zone.lat, zoneLng: zone.lng,
          zoneRadius: zone.radius ?? 3000,
          category: cat,
          priorityScore: 0.8,
          reason: 'planner_gap',
          status: 'PENDING',
          attemptCount: 0,
          createdAt: now, updatedAt: now,
        });
      } catch {
        // Non-critical
      }
    }
  })();
}

// ──────────────────────────────────────────────────────────────────────────────

const CONVERSATION_SCORES: Record<string, number> = {
  POTTERY: 10,
  BOARD_GAME: 8,
  BOARD_GAME_EVENT: 8,
  ESCAPE_ROOM: 8,
  WORKSHOP: 10,
  PAINTING: 9,
  MUSEUM: 7,
  ART_GALLERY: 7,
  EXHIBITION: 7,
  CAFE: 6,
  RESTAURANT: 5,
  PARK: 6,
  DESSERT: 5,
  ARCADE: 4,
  BOWLING: 4,
  SPORTS: 3,
  SPORTS_EVENT: 3,
  LIVE_MUSIC: 3,
  CONCERT: 2,
  MOVIE: 2,
  MOVIE_THEATER: 2,
  THEATRE: 3,
  MALL: 3,
};

function addMinutesToTimeString(timeStr: string, minutesToAdd: number): string {
  let hour = 11;
  let min = 0;
  let isPm = false;
  
  const match24 = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    hour = parseInt(match24[1]);
    min = parseInt(match24[2]);
  } else {
    const match12 = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (match12) {
      hour = parseInt(match12[1]);
      min = parseInt(match12[2]);
      isPm = match12[3].toUpperCase() === 'PM';
    }
  }

  if (isPm && hour !== 12) hour += 12;
  if (!isPm && hour === 12) hour = 0;

  const totalMin = hour * 60 + min + minutesToAdd;
  let finalHour = Math.floor(totalMin / 60) % 24;
  let finalMin = totalMin % 60;

  let finalAmPm = 'AM';
  if (finalHour >= 12) {
    finalAmPm = 'PM';
    if (finalHour > 12) finalHour -= 12;
  }
  if (finalHour === 0) finalHour = 12;

  const padMin = finalMin.toString().padStart(2, '0');
  return `${finalHour}:${padMin} ${finalAmPm}`;
}

async function resolveZoneFallbacks(zoneName: string, zoneLat: number, zoneLng: number): Promise<PlaceCandidate[]> {
  const allFallbacks = await db.select().from(zoneFallbacks);
  if (allFallbacks.length === 0) return [];

  const fallbacksByZone: Record<string, typeof allFallbacks> = {};
  for (const fb of allFallbacks) {
    if (!fallbacksByZone[fb.zoneName]) {
      fallbacksByZone[fb.zoneName] = [];
    }
    fallbacksByZone[fb.zoneName].push(fb);
  }

  const currentZoneKey = Object.keys(fallbacksByZone).find(
    k => k.toLowerCase() === zoneName.toLowerCase()
  );
  if (currentZoneKey && fallbacksByZone[currentZoneKey].length > 0) {
    return fallbacksByZone[currentZoneKey].map((fb: any) => ({
      id: fb.id,
      name: fb.name,
      category: fb.category,
      rating: fb.rating || 4.5,
      lat: fb.lat,
      lng: fb.lng,
      estimatedCostPerHead: fb.estimatedCostPerHead,
      address: fb.address || '',
      openNow: true,
      isFallback: true
    }));
  }

  const allZones = await db.select().from(zones);
  
  let nearestZoneName = '';
  let minDist = Infinity;

  for (const zone of allZones) {
    const hasFb = Object.keys(fallbacksByZone).some(
      k => k.toLowerCase() === zone.name.toLowerCase()
    );
    if (!hasFb) continue;

    const dist = getHaversineDistance({ lat: zoneLat, lng: zoneLng }, { lat: zone.centerLat, lng: zone.centerLng });
    if (dist < minDist) {
      minDist = dist;
      nearestZoneName = zone.name;
    }
  }

  const nearestZoneKey = Object.keys(fallbacksByZone).find(
    k => k.toLowerCase() === nearestZoneName.toLowerCase()
  );
  if (nearestZoneKey && fallbacksByZone[nearestZoneKey].length > 0) {
    console.log(`Zone "${zoneName}" has no fallbacks. Using fallbacks from nearest zone: "${nearestZoneName}" (${minDist.toFixed(1)}km away)`);
    return fallbacksByZone[nearestZoneKey].map((fb: any) => ({
      id: fb.id,
      name: fb.name,
      category: fb.category,
      rating: fb.rating || 4.5,
      lat: fb.lat,
      lng: fb.lng,
      estimatedCostPerHead: fb.estimatedCostPerHead,
      address: fb.address || '',
      openNow: true,
      isFallback: true
    }));
  }

  // Final safety net: proximity-sort MUMBAI_FALLBACK_CANDIDATES when DB table is empty
  console.log(`[FALLBACK] zoneFallbacks table is empty for "${zoneName}". Using in-memory candidates sorted by proximity.`);
  return MUMBAI_FALLBACK_CANDIDATES
    .map(c => ({ ...c, _dist: getHaversineDistance({ lat: zoneLat, lng: zoneLng }, { lat: c.lat, lng: c.lng }) }))
    .filter(c => c._dist <= 4.5) // Restrict to a tight 4.5km radius to prevent cross-suburb mismatch
    .sort((a, b) => (a as any)._dist - (b as any)._dist)
    .slice(0, 10)
    .map(({ _dist: _, ...c }) => c as PlaceCandidate);
}

function scorePlaceCandidateRefactored(
  place: any,
  groupType: string,
  zoneLowestBudget: number,
  avgMemberCoords: LatLng,
  metrics: any,
  lastVerified: string
) {
  const weights = CATEGORY_WEIGHTS[groupType.toUpperCase()] || CATEGORY_WEIGHTS.CUSTOM;
  const weight = weights[place.category.toUpperCase()] || 5;
  const categoryMatch = weight / 10.0;

  let budgetMatch = 0.0;
  if (place.estimatedCostPerHead <= zoneLowestBudget) {
    budgetMatch = 1.0;
  } else {
    budgetMatch = Math.max(0.0, 1.0 - (place.estimatedCostPerHead - zoneLowestBudget) / 1000);
  }

  let popularity = 0.0;
  if (metrics && metrics.timesGenerated > 0) {
    popularity = metrics.timesWon / metrics.timesGenerated;
  } else {
    popularity = Math.min(1.0, Math.max(0.0, ((place.rating || 4.0) - 3.5) / 1.5));
  }

  const dist = getHaversineDistance(avgMemberCoords, { lat: place.lat, lng: place.lng });
  const travelFairness = Math.max(0.0, 1.0 - dist / 15.0);

  const ratingScore = Math.min(1.0, Math.max(0.0, (place.rating || 4.0) / 5.0));

  // Calculate freshness using decay formula Math.exp(-daysSinceDiscovery / 14) based on firstSeen
  const firstSeenDate = place.firstSeen ? new Date(place.firstSeen).getTime() : Date.now() - 60 * 24 * 60 * 60 * 1000;
  const daysSinceDiscovery = Math.max(0, (Date.now() - firstSeenDate) / (24 * 60 * 60 * 1000));
  const freshness = Math.exp(-daysSinceDiscovery / 14);

  // Calculate uniqueness score (Interestingness)
  const nameLower = (place.name || '').toLowerCase();
  const chains = [
    'mcdonald',
    'starbucks',
    'subway',
    'domino',
    'kfc',
    'burger king',
    'pizza hut',
    'baskin robbins',
    'dunkin',
    'cafe coffee day',
    'ccd',
    'pizza express',
    'barbeque nation',
    'taco bell',
    'coffee bean',
    'third wave',
    'blue tokai'
  ];

  const isChain = chains.some(chain => nameLower.includes(chain));
  let uniquenessScore = 0.6; // default moderate uniqueness

  if (isChain) {
    uniquenessScore = 0.1; // heavily penalized
  } else {
    const uniqueCategories = [
      'BOARD_GAMES', 'BOARD_GAME_CAFE', 'POTTERY', 'ARCADE', 'WORKSHOP',
      'MUSEUM', 'BOWLING', 'ESCAPE_ROOM', 'ART_GALLERY', 'ART_EXHIBITION',
      'CONCERT', 'COMIC_CON', 'ANIME_EVENT', 'STANDUP_COMEDY', 'PAINTING'
    ];
    const catUpper = (place.category || '').toUpperCase();
    if (uniqueCategories.includes(catUpper)) {
      uniquenessScore = 1.0; // heavily boosted
    }
  }

  // Blend popularity and uniquenessScore for places
  let popularityComponent = popularity;
  if (!place.isExperience) {
    popularityComponent = (popularity + uniquenessScore) / 2.0;
  }

  // Adjusted weights totaling 1.0 (35% Category, 20% Budget, 15% Popularity component, 15% Freshness, 10% Travel, 5% Rating)
  let score = 0.35 * categoryMatch +
              0.20 * budgetMatch +
              0.15 * popularityComponent +
              0.15 * freshness +
              0.10 * travelFairness +
              0.05 * ratingScore;
  
  // Apply direct penalty to chain places to prioritize local favorites
  if (isChain) {
    score = score - 0.20;
  }

  // Apply boostFactor
  const boost = typeof place.boostFactor === 'number' ? place.boostFactor : 1.0;
  score = score * boost;

  // Apply a 1.25 boost multiplier to candidates whose daysSinceDiscovery < 30 (Recently Discovered)
  if (daysSinceDiscovery < 30) {
    score = score * 1.25;
  }

  return score;
}

export async function executePlanningEngineForEval(
  groupData: any, presentMembers: any[], budgetSummary: any,
  presentLocations: any[], preferredCategories: string[], vibes: string[],
  historyEntries: any[], lowestBudget: number, options: string[] = []
): Promise<any[]> {
  return executePlanningEngine(groupData, presentMembers, budgetSummary, presentLocations, preferredCategories, vibes, historyEntries, lowestBudget, options);
}

async function executePlanningEngine(
  groupData: any,
  presentMembers: any[],
  budgetSummary: any,
  presentLocations: any[],
  preferredCategories: string[],
  vibes: string[],
  historyEntries: any[],
  lowestBudget: number,
  options: string[] = []
): Promise<any[]> {
  const city = 'Mumbai';
  const memberCoords = presentLocations.map(loc => ({ lat: loc.lat, lng: loc.lng }));
  const allCandidateZones = selectCandidateZones(memberCoords);
  
  // Randomly sample 4 zones from the larger pool (8) to ensure each regeneration
  // produces genuinely different zone midpoints and itineraries
  const shuffledAllZones = [...allCandidateZones];
  for (let i = shuffledAllZones.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffledAllZones[i], shuffledAllZones[j]] = [shuffledAllZones[j], shuffledAllZones[i]];
  }
  const candidateZones = shuffledAllZones.slice(0, 4);

  const avgLat = memberCoords.reduce((sum, c) => sum + c.lat, 0) / memberCoords.length;
  const avgLng = memberCoords.reduce((sum, c) => sum + c.lng, 0) / memberCoords.length;
  const avgMemberCoords = { lat: avgLat, lng: avgLng };

  const logRejection = (name: string, reason: string) => {
    console.log(`[VENUE REJECTED] "${name}" | Reason: ${reason}`);
  };

  const isCheaper = options.includes('Cheaper');
  const isMoreIndoor = options.includes('More Indoor');
  const isLessTravel = options.includes('Less Travel');
  const isMoreActivities = options.includes('More Activities');
  const isMoreFood = options.includes('More Food');
  const isMoreCreative = options.includes('More Creative');
  const hasMoviePreference = (preferredCategories && preferredCategories.some(cat => cat.toUpperCase() === 'MOVIE')) ||
    (groupData.activity && String(groupData.activity).toLowerCase().includes('movie')) ||
    (groupData.outingType && String(groupData.outingType).toLowerCase().includes('movie')) ||
    (vibes && vibes.some(v => String(v).toLowerCase().includes('movie')));

  let activeVibes = [...vibes];
  if (options.includes('More Romantic') && !activeVibes.some(v => v.toUpperCase() === 'ROMANTIC')) {
    activeVibes.push('ROMANTIC');
  }

  const budgetsList = await budgetRepository.getGroupBudgets(groupData.id);

  const zoneCandidatesPromises = candidateZones.map(async (zone) => {
    const memberAvailableBudgets = presentMembers.map(m => {
      const loc = presentLocations.find(l => l.userId === m.userId);
      const memberLat = loc ? loc.lat : 19.0760;
      const memberLng = loc ? loc.lng : 72.8777;

      const travelBreakdown = calculateMumbaiTravelBreakdown(
        { lat: memberLat, lng: memberLng },
        { lat: zone.lat, lng: zone.lng },
        groupData.outingTime
      );
      const travelCost = travelBreakdown.totalCost;

      const budgetRecord = budgetsList.find(b => b.userId === m.userId);
      // Fall back to the engine's lowestBudget param (from presentBudgetSummary.min) when DB
      // has no record — avoids defaulting to 2000 for synthetic/eval groups.
      const maxBudget = budgetRecord ? budgetRecord.maxBudget : (lowestBudget > 0 ? lowestBudget : 2000);
      const travelIncluded = budgetRecord ? budgetRecord.travelIncluded : 1;

      const availableBudget = travelIncluded === 1 ? maxBudget - travelCost : maxBudget;

      return {
        userId: m.userId,
        availableBudget,
        travelCost
      };
    });

    const zoneLowestBudget = Math.min(...memberAvailableBudgets.map(m => m.availableBudget));

    const radiusKm = 3.0;
    const latDiff = radiusKm / 111.0;
    const lngDiff = radiusKm / (111.0 * Math.cos(zone.lat * Math.PI / 180));

    const dbPlaces = await db
      .select({
        id: places.id,
        name: places.name,
        address: places.address,
        lat: places.lat,
        lng: places.lng,
        rating: places.rating,
        reviewCount: places.reviewCount,
        category: placeCategories.category,
        mandatoryCost: placeCosts.mandatoryCost,
        optionalCostMin: placeCosts.optionalCostMin,
        optionalCostMax: placeCosts.optionalCostMax,
        lastVerified: places.lastVerified,
        isFeatured: places.isFeatured,
        isHidden: places.isHidden,
        boostFactor: places.boostFactor,
        firstSeen: places.firstSeen,
        imageUrl: places.imageUrl
      })
      .from(places)
      .innerJoin(placeCategories, eq(placeCategories.placeId, places.id))
      .innerJoin(placeCosts, eq(placeCosts.placeId, places.id))
      .where(
        and(
          between(places.lat, zone.lat - latDiff, zone.lat + latDiff),
          between(places.lng, zone.lng - lngDiff, zone.lng + lngDiff)
        )
      );

    const candidates: PlaceCandidate[] = [];

    dbPlaces.forEach((p: any) => {
      // Quality Gate: filter hidden places
      if (p.isHidden === 1) {
        logRejection(p.name, 'Hidden by admin curation');
        return;
      }

      if (p.category.toUpperCase() === 'MOVIE' && !hasMoviePreference) {
        logRejection(p.name, 'Excluded because no movie preference was specified');
        return;
      }

      // Quality gate: reject venues with confirmed low ratings
      if (p.rating && p.rating > 0 && (p.reviewCount ?? 0) > 0 && (p.rating < 4.0 || (p.reviewCount ?? 0) < 20)) {
        logRejection(p.name, `Low quality (rating=${p.rating}, reviews=${p.reviewCount ?? 0})`);
        return;
      }

      const dist = getHaversineDistance({ lat: zone.lat, lng: zone.lng }, { lat: p.lat, lng: p.lng });
      
      // Ensure the venue strictly belongs to the midpoint zone location
      const nameLower = p.name.toLowerCase();
      const addrLower = (p.address || '').toLowerCase();
      const zoneLower = zone.name.toLowerCase();

      // Normalize BKC and other variations
      const zoneTerms = [zoneLower];
      if (zoneLower === 'bkc') {
        zoneTerms.push('bandra kurla complex');
      }

      const matchesText = zoneTerms.some(term => nameLower.includes(term) || addrLower.includes(term));
      
      let isAllowedInZone = false;
      if (dist <= 1.5) {
        isAllowedInZone = true;
      } else if (dist <= 2.5 && matchesText) {
        isAllowedInZone = true;
      }

      if (!isAllowedInZone) {
        logRejection(p.name, `REJECTED | Reason: Venue not matching midpoint zone "${zone.name}" (dist=${dist.toFixed(1)}km, no name/address match)`);
        return;
      }

      candidates.push({
        id: p.id,
        name: p.name,
        category: p.category,
        rating: p.rating || 4.0,
        lat: p.lat,
        lng: p.lng,
        estimatedCostPerHead: p.mandatoryCost + p.optionalCostMin,
        address: p.address || '',
        openNow: true,
        mandatoryCost: p.mandatoryCost,
        optionalCostMin: p.optionalCostMin,
        optionalCostMax: p.optionalCostMax,
        lastVerified: p.lastVerified,
        isFeatured: p.isFeatured,
        isHidden: p.isHidden,
        boostFactor: p.boostFactor,
        firstSeen: p.firstSeen,
        imageUrl: p.imageUrl
      } as any);
    });

    const dbExperiences = await db
      .select({
        id: experiences.id,
        title: experiences.title,
        description: experiences.description,
        category: experiences.category,
        city: experiences.city,
        latitude: experiences.latitude,
        longitude: experiences.longitude,
        startDate: experiences.startDate,
        endDate: experiences.endDate,
        ticketPrice: experiences.ticketPrice,
        capacity: experiences.capacity,
        source: experiences.source,
        sourceUrl: experiences.sourceUrl,
        imageUrl: experiences.imageUrl,
        rating: experiences.rating,
        popularityScore: experiences.popularityScore,
        isRecurring: experiences.isRecurring,
        isActive: experiences.isActive,
        trendingScore: experiences.trendingScore,
        firstSeen: experiences.firstSeen,
        createdAt: experiences.createdAt,
        updatedAt: experiences.updatedAt,
        featuredId: featuredExperiences.id
      })
      .from(experiences)
      .leftJoin(featuredExperiences, eq(featuredExperiences.experienceId, experiences.id))
      .where(
        and(
          eq(experiences.city, 'Mumbai'),
          eq(experiences.isActive, 1)
        )
      );

    dbExperiences.forEach((e: any) => {
      // Date verification: Outing date must fall within the experience's start and end date
      if (groupData.outingDate) {
        const outingDateStr = groupData.outingDate.split('T')[0];
        const startStr = e.startDate.split('T')[0];
        const endStr = e.endDate.split('T')[0];
        if (outingDateStr < startStr || outingDateStr > endStr) {
          logRejection(e.title, `Event not active on outing date (${outingDateStr})`);
          return; // Skip ineligible experience
        }
      }

      const dist = getHaversineDistance({ lat: zone.lat, lng: zone.lng }, { lat: e.latitude, lng: e.longitude });
      const isFeatured = e.featuredId !== null;

      // Workshop/pottery/class experiences are niche — only include them when the group
      // explicitly wants creative activities, otherwise they crowd out cafes, arcades, parks.
      const WORKSHOP_CATS = new Set(['WORKSHOP', 'POTTERY', 'PAINTING', 'CREATIVE', 'BOARD_GAME', 'BOARD_GAME_EVENT']);
      const experienceCat = (e.category ?? '').toUpperCase();
      if (WORKSHOP_CATS.has(experienceCat)) {
        const groupWantsWorkshop = preferredCategories.some(p => WORKSHOP_CATS.has(p.toUpperCase()));
        if (!groupWantsWorkshop && !isMoreCreative && !isFeatured) {
          logRejection(e.title, `Workshop/class excluded — group preferences don't include creative activities`);
          return;
        }
      }

      // Stricter zone matching for experiences
      const eNameLower = e.title.toLowerCase();
      const eZoneLower = zone.name.toLowerCase();
      const eZoneTerms = [eZoneLower];
      if (eZoneLower === 'bkc') eZoneTerms.push('bandra kurla complex');
      const eMatchesText = eZoneTerms.some(term => eNameLower.includes(term));
      
      let isExpAllowed = false;
      if (dist <= 1.8) {
        isExpAllowed = true;
      } else if (dist <= 3.5 && (eMatchesText || isFeatured)) {
        isExpAllowed = true;
      }

      if (!isExpAllowed && !isFeatured) {
        logRejection(e.title, `REJECTED | Reason: Experience not matching midpoint zone "${zone.name}" (dist=${dist.toFixed(1)}km)`);
        return;
      }

      candidates.push({
        id: e.id,
        name: e.title,
        category: e.category,
        rating: e.rating || 4.5,
        lat: e.latitude,
        lng: e.longitude,
        estimatedCostPerHead: e.ticketPrice,
        address: e.sourceUrl || '',
        openNow: true,
        isExperience: true,
        imageUrl: e.imageUrl || undefined,
        sourceUrl: e.sourceUrl,
        mandatoryCost: e.ticketPrice,
        optionalCostMin: 0,
        optionalCostMax: 0,
        lastVerified: e.updatedAt,
        isFeatured: isFeatured ? 1 : 0,
        isHidden: 0,
        boostFactor: 1.0,
        firstSeen: e.firstSeen
      } as any);
    });

    if (candidates.length < 5) {
      // 1. Detect which required categories are missing
      const existingCats = new Set(candidates.map(c => c.category.toUpperCase()));
      const gaps = PLANNER_REQUIRED_CATEGORIES.filter(cat => !existingCats.has(cat)).slice(0, 3);

      // 2. Reactive live fetch — bounded at 3 categories, 2s per Ola call
      if (gaps.length > 0) {
        try {
          const fetched = await reactiveVenueFetch({ name: zone.name, lat: zone.lat, lng: zone.lng }, gaps);
          if (fetched.length > 0) {
            console.log(`[PLANNER] Reactive fetch added ${fetched.length} venues to ${zone.name}`);
            candidates.push(...fetched);
          }
        } catch (reactiveErr) {
          console.warn('[PLANNER] Reactive fetch failed:', reactiveErr);
        }
        // Signal background worker to fill this zone — fire-and-forget
        enqueueGapDiscovery({ name: zone.name, lat: zone.lat, lng: zone.lng, radius: radiusKm * 1000 }, gaps);
      }

      // 3. Only use zoneFallbacks if still sparse after live fetch
      if (candidates.length < 5) {
        const fallbacks = await resolveZoneFallbacks(zone.name, zone.lat, zone.lng);
        const filteredFallbacks = hasMoviePreference ? fallbacks : fallbacks.filter(f => f.category.toUpperCase() !== 'MOVIE');
        if (filteredFallbacks.length > 0) {
          candidates.push(...filteredFallbacks);
        }
      }
    }

    const openCandidates = candidates.filter(c => {
      const isOpen = isVenueOpenAtTime(c.category, groupData.outingTime);
      if (!isOpen) {
        logRejection(c.name, `Closed at outing time (${groupData.outingTime})`);
      }
      return isOpen;
    });

    const filteredCandidates = openCandidates.filter(c => {
      const outdoorCategories = ['PARK', 'OUTDOOR_EXPERIENCE', 'SCENIC_EXPERIENCE'];
      if (isMoreIndoor && outdoorCategories.includes(c.category.toUpperCase())) {
        logRejection(c.name, `REJECTED | Reason: Excluded by "More Indoor" option`);
        return false;
      }

      const effectiveBudget = isCheaper ? zoneLowestBudget * 0.8 : zoneLowestBudget;
      const perSlotCap = Math.max(300, Math.floor(effectiveBudget * 0.8)); // Allow slots to consume up to 80% of total budget (min cap ₹300)
      if (c.estimatedCostPerHead > perSlotCap && !c.isFallback) {
        logRejection(c.name, `REJECTED | Reason: Budget (cost ₹${c.estimatedCostPerHead} exceeds per-slot cap ₹${perSlotCap})`);
        return false;
      }

      const dist = getHaversineDistance({ lat: zone.lat, lng: zone.lng }, { lat: c.lat, lng: c.lng });
      const maxDistance = isLessTravel ? 5 : 8;
      if (dist > maxDistance && !c.isFallback) {
        logRejection(c.name, `REJECTED | Reason: Too far (${dist.toFixed(1)}km exceeds allowed ${maxDistance}km from zone center)`);
        return false;
      }

      return true;
    });

    const scoredCandidatesPromises = filteredCandidates.map(async (c) => {
      const metricsResults = await db
        .select()
        .from(rankingMetrics)
        .where(eq(rankingMetrics.placeId, c.id))
        .limit(1)
        .catch(() => [] as any[]);
      const metricsRecord = (metricsResults && metricsResults.length > 0) ? metricsResults[0] : null;

      const baseScore = scorePlaceCandidateRefactored(
        c,
        groupData.groupType,
        zoneLowestBudget,
        avgMemberCoords,
        metricsRecord,
        (c as any).lastVerified
      );
      const randomOffset = (Math.random() - 0.5) * 0.15;
      const score = baseScore + randomOffset;

      return {
        ...c,
        score
      };
    });

    const scoredCandidates = await Promise.all(scoredCandidatesPromises);
    scoredCandidates.sort((a, b) => b.score - a.score);

    return {
      zone,
      zoneLowestBudget,
      candidates: scoredCandidates
    };
  });

  const zonesData = await Promise.all(zoneCandidatesPromises);

  const usedPlaceIds = new Set<string>();
  const draftItineraries: any[] = [];
  const tiers = ['TRAVEL_FRIENDLY', 'BUDGET_FRIENDLY', 'BALANCED', 'EXPERIENCE_FIRST'] as const;

  const buildPass = async (allowSharedVenues = false) => {
    const shuffledZones = [...candidateZones];
    for (let idx = shuffledZones.length - 1; idx > 0; idx--) {
      const j = Math.floor(Math.random() * (idx + 1));
      [shuffledZones[idx], shuffledZones[j]] = [shuffledZones[j], shuffledZones[idx]];
    }

    // Shuffle the templates pool to guarantee diversity
    const templatesPool = [...ITINERARY_TEMPLATES];
    for (let j = templatesPool.length - 1; j > 0; j--) {
      const k = Math.floor(Math.random() * (j + 1));
      [templatesPool[j], templatesPool[k]] = [templatesPool[k], templatesPool[j]];
    }

    const getActiveTemplate = (idx: number): ItineraryTemplate => {
      if (isMoreActivities) {
        return { slot1: ['BOWLING', 'ARCADE', 'ESCAPE_ROOM', 'MUSEUM', 'SPORTS', 'POTTERY', 'PAINTING'], slot1Act: true, slot2: ['CAFE', 'RESTAURANT'], slot2Act: false, slot3: ['BOWLING', 'ARCADE', 'ESCAPE_ROOM', 'MUSEUM', 'SPORTS', 'POTTERY', 'PAINTING'], slot3Act: true };
      }
      if (isMoreCreative) {
        return { slot1: ['POTTERY', 'WORKSHOP', 'ART_GALLERY', 'PAINTING'], slot1Act: true, slot2: ['CAFE', 'RESTAURANT'], slot2Act: false, slot3: ['POTTERY', 'WORKSHOP', 'ART_GALLERY', 'PAINTING'], slot3Act: true };
      }
      if (isMoreFood) {
        return { slot1: ['CAFE'], slot1Act: false, slot2: ['RESTAURANT'], slot2Act: false, slot3: ['DESSERT', 'CAFE'], slot3Act: false };
      }
      return templatesPool[idx % templatesPool.length];
    };

    for (let i = 0; i < 4; i++) {
      if (draftItineraries.length >= 4) break;

      const budgetTier = tiers[i];
      const planIndex = i + 1;

      if (draftItineraries.some(it => it.planIndex === planIndex)) continue;

      let zoneObj = shuffledZones[i % shuffledZones.length];
      let zoneData = zonesData.find(zd => zd.zone.name === zoneObj.name) || zonesData[0];

      const filterAndUnused = (list: any[]) => allowSharedVenues ? list : list.filter(c => !usedPlaceIds.has(c.id));
      let candidatesPool = filterAndUnused(zoneData.candidates);

      const template = getActiveTemplate(planIndex - 1);
      const slot1Cats = template.slot1;
      const slot1IsActivity = template.slot1Act;
      const slot2Cats = template.slot2;
      const slot2IsActivity = template.slot2Act;
      const slot3Cats = template.slot3;
      const slot3IsActivity = template.slot3Act;

      // Track categories already picked in this plan to avoid e.g. CAFE+CAFE in same plan
      const selectedPlanCats = new Set<string>();
      let chainCount = 0;

      const selectPlaceForSlot = (preferredCats: string[], isActivity: boolean) => {
        let matches = candidatesPool.filter(c => preferredCats.includes(c.category.toUpperCase()));
        if (chainCount >= 1) {
          matches = matches.filter(c => !isChain(c.name));
        }

        if (matches.length === 0) {
          if (isActivity) {
            matches = candidatesPool.filter(c => !['CAFE', 'RESTAURANT', 'DESSERT'].includes(c.category.toUpperCase()));
          } else {
            const FOOD_CATS = ['CAFE', 'RESTAURANT', 'DESSERT'];
            // Prefer a food category not already used in this plan (avoids café+café)
            matches = candidatesPool.filter(c =>
              FOOD_CATS.includes(c.category.toUpperCase()) && !selectedPlanCats.has(c.category.toUpperCase())
            );
            if (matches.length === 0) {
              matches = candidatesPool.filter(c => FOOD_CATS.includes(c.category.toUpperCase()));
            }
          }
          if (chainCount >= 1) {
            matches = matches.filter(c => !isChain(c.name));
          }
        }
        if (matches.length === 0) return null;

        const top3 = matches.slice(0, 3);
        const rand = Math.random();
        let selected: PlaceCandidate;
        if (top3.length === 1) {
          selected = top3[0];
        } else if (top3.length === 2) {
          selected = rand < 0.6 ? top3[0] : top3[1];
        } else {
          if (rand < 0.5) selected = top3[0];
          else if (rand < 0.85) selected = top3[1];
          else selected = top3[2];
        }

        if (isChain(selected.name)) {
          chainCount++;
        }
        return selected;
      };

      const isTwoSlots = zoneData.zoneLowestBudget < 750;

      const slot1Place = selectPlaceForSlot(slot1Cats, slot1IsActivity);
      if (!slot1Place) continue;
      selectedPlanCats.add(slot1Place.category.toUpperCase());
      candidatesPool = candidatesPool.filter(c => c.id !== slot1Place.id);

      const slot2Place = selectPlaceForSlot(slot2Cats, slot2IsActivity);
      if (!slot2Place) continue;
      selectedPlanCats.add(slot2Place.category.toUpperCase());
      candidatesPool = candidatesPool.filter(c => c.id !== slot2Place.id);

      let slot3Place: PlaceCandidate | null = null;
      if (!isTwoSlots) {
        slot3Place = selectPlaceForSlot(slot3Cats, slot3IsActivity);
        if (!slot3Place) continue;
        selectedPlanCats.add(slot3Place.category.toUpperCase());
        candidatesPool = candidatesPool.filter(c => c.id !== slot3Place!.id);
      }

      const getMandatoryCost = (place: PlaceCandidate) => {
        if ((place as any).mandatoryCost !== undefined) {
          return (place as any).mandatoryCost;
        }
        if (['CAFE', 'RESTAURANT', 'DESSERT'].includes(place.category.toUpperCase())) {
          return Math.round(place.estimatedCostPerHead * 0.4);
        } else if (place.isExperience) {
          return place.estimatedCostPerHead;
        } else {
          return Math.round(place.estimatedCostPerHead * 0.7);
        }
      };

      const getOptionalCostMin = (place: PlaceCandidate) => {
        if ((place as any).optionalCostMin !== undefined) {
          return (place as any).optionalCostMin;
        }
        if (['CAFE', 'RESTAURANT', 'DESSERT'].includes(place.category.toUpperCase())) {
          return Math.round(place.estimatedCostPerHead * 0.6);
        } else if (place.isExperience) {
          return 0;
        } else {
          return Math.round(place.estimatedCostPerHead * 0.3);
        }
      };

      const getOptionalCostMax = (place: PlaceCandidate) => {
        if ((place as any).optionalCostMax !== undefined) {
          return (place as any).optionalCostMax;
        }
        if (['CAFE', 'RESTAURANT', 'DESSERT'].includes(place.category.toUpperCase())) {
          return Math.round(place.estimatedCostPerHead * 1.5);
        } else if (place.isExperience) {
          return 0;
        } else {
          return Math.round(place.estimatedCostPerHead * 1.0);
        }
      };

      const m1 = getMandatoryCost(slot1Place);
      const m2 = getMandatoryCost(slot2Place);
      const m3 = isTwoSlots ? 0 : getMandatoryCost(slot3Place!);
      const totalMandatorySlotsCost = m1 + m2 + m3;

      const opt1 = getOptionalCostMin(slot1Place);
      const opt2 = getOptionalCostMin(slot2Place);
      const opt3 = isTwoSlots ? 0 : getOptionalCostMin(slot3Place!);
      const totalEstimatedSlotsCost = totalMandatorySlotsCost + opt1 + opt2 + opt3;

      if (totalEstimatedSlotsCost > zoneData.zoneLowestBudget) {
        logRejection(`Plan-${planIndex}`, `Total slots estimated cost (₹${totalEstimatedSlotsCost}) exceeds lowest member available budget (₹${Math.round(zoneData.zoneLowestBudget)})`);
        continue;
      }

      if (!allowSharedVenues) {
        usedPlaceIds.add(slot1Place.id);
        usedPlaceIds.add(slot2Place.id);
        if (!isTwoSlots && slot3Place) {
          usedPlaceIds.add(slot3Place.id);
        }
      }

      const selectedPlaces = isTwoSlots ? [slot1Place, slot2Place] : [slot1Place, slot2Place, slot3Place!];
      
      const slotsPromises = selectedPlaces.map(async (place, slotIdx) => {
        let finalImg = place.imageUrl || null;
        let finalLink = place.sourceUrl || null;
        let needsDbUpdate = false;
        
        if (place.id && !place.id.startsWith('fb_') && !place.id.startsWith('fallback_') && !place.isExperience) {
          try {
            let actualPlaceId = place.id;
            if (place.id.startsWith('GOOGLE_')) {
              actualPlaceId = place.id.slice(7);
            } else if (place.id.startsWith('OLA_')) {
              actualPlaceId = place.id.slice(4);
            }
            const details = await getVenueDetails(actualPlaceId);
            if (details && details.photos && details.photos.length > 0) {
              const photoRef = details.photos[0].photo_reference;
              if (photoRef) {
                finalImg = `/api/places/photo?ref=${encodeURIComponent(photoRef)}`;
                if (finalImg !== place.imageUrl) {
                  needsDbUpdate = true;
                }
              }
            }
            if (details && details.website) {
              finalLink = details.website;
            }
          } catch (err) {}
        }

        const isUnsplashImg = !finalImg || finalImg.includes('unsplash.com') || finalImg.includes('placehold.co');
        if (isUnsplashImg) {
          const googleImg = await getVenueImageUrl(place.name, city, place.category);
          if (googleImg && !googleImg.includes('unsplash.com') && !googleImg.includes('placehold.co')) {
            finalImg = googleImg;
            if (place.id && !place.id.startsWith('fb_') && !place.id.startsWith('fallback_') && !place.isExperience && finalImg !== place.imageUrl) {
              needsDbUpdate = true;
            }
          }
        }
        // Final fallback: always have a category-based Unsplash image if still null
        if (!finalImg) {
          finalImg = getFallbackImageUrl(place.category);
        }
        if (!finalLink) {
          finalLink = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name + ' ' + place.address)}`;
        }

        if (needsDbUpdate && place.id && !place.isExperience) {
          void db.update(places)
            .set({ imageUrl: finalImg })
            .where(eq(places.id, place.id))
            .catch((err: any) => console.warn(`Failed to update imageUrl in DB for place ${place.id}:`, err));
        }

        const duration = getDurationForCategory(place.category);
        let arrivalTime = groupData.outingTime || '11:00 AM';
        if (slotIdx > 0) {
          let prevTime = groupData.outingTime || '11:00 AM';
          for (let i = 0; i < slotIdx; i++) {
            const prevPlace = selectedPlaces[i];
            const prevDuration = getDurationForCategory(prevPlace.category);
            const prevTransit = 15;
            prevTime = addMinutesToTimeString(prevTime, prevDuration + prevTransit);
          }
          arrivalTime = prevTime;
        }

        return {
          order: slotIdx + 1,
          venueId: place.isExperience ? null : place.id,
          experienceId: place.isExperience ? place.id : null,
          name: place.name,
          category: place.category,
          rating: place.rating ?? null,
          arrivalTime,
          durationMinutes: duration,
          travelToNextMinutes: slotIdx === 2 ? null : 15,
          estimatedCostPerHead: place.estimatedCostPerHead,
          mandatoryCost: getMandatoryCost(place),
          optionalCostMin: getOptionalCostMin(place),
          optionalCostMax: getOptionalCostMax(place),
          imageUrl: finalImg,
          link: finalLink,
          note: getFallbackSlotDescription(place.id, place.name, place.category, slotIdx + 1, groupData.groupType || 'friends', zoneObj.name),
          lat: place.lat,
          lng: place.lng,
          address: place.address || ''
        };
      });

      const buildItineraryData = async () => {
        const slots = await Promise.all(slotsPromises);

        for (let sIdx = 0; sIdx < slots.length - 1; sIdx++) {
          const current = slots[sIdx];
          const next = slots[sIdx + 1];
          const slotDist = getHaversineDistance({ lat: current.lat, lng: current.lng }, { lat: next.lat, lng: next.lng });

          const travelMin = Math.max(15, Math.round(slotDist * 4.0) + 5);
          const travelCost = Math.round(23 + Math.max(0, slotDist - 1.5) * 15);

          current.travelToNextMinutes = travelMin;
          (current as any).travelToNextCost = Math.ceil(travelCost / Math.min(3, presentMembers.length));
          // Propagate corrected arrival time to the next slot
          next.arrivalTime = addMinutesToTimeString(current.arrivalTime, current.durationMinutes + travelMin);
        }

        const memberTravelsForPlan: any[] = [];
        const totalTimes: number[] = [];
        const totalCosts: number[] = [];

        presentLocations.forEach(loc => {
          const breakdown = calculateMumbaiTravelBreakdown({ lat: loc.lat, lng: loc.lng }, { lat: zoneObj.lat, lng: zoneObj.lng }, groupData.outingTime);
          
          totalTimes.push(breakdown.totalTime);
          totalCosts.push(breakdown.totalCost);

          const travelId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : require('crypto').randomUUID();

          memberTravelsForPlan.push({
            id: travelId,
            userId: loc.userId,
            walkingTime: breakdown.walkingTime,
            autoTime: breakdown.autoTime,
            autoCost: breakdown.autoCost,
            trainTime: breakdown.trainTime,
            trainCost: breakdown.trainCost,
            totalTime: breakdown.totalTime,
            totalCost: breakdown.totalCost,
            train_time: breakdown.trainTime,
            train_cost: breakdown.trainCost,
            cab_time: breakdown.autoTime,
            cab_cost: breakdown.autoCost,
            walk_time: breakdown.walkingTime
          });
        });

        const avgTotalTime = Math.round(totalTimes.reduce((sum, t) => sum + t, 0) / totalTimes.length);
        const avgTotalCost = Math.round(totalCosts.reduce((sum, c) => sum + c, 0) / totalCosts.length);
        const longestTravelTime = Math.max(...totalTimes);
        const shortestTravelTime = Math.min(...totalTimes);

        const variance = totalTimes.reduce((sum, t) => sum + Math.pow(t - avgTotalTime, 2), 0) / totalTimes.length;
        const stdDev = Math.sqrt(variance);
        let travelFairnessScore = stdDev <= 10 ? 1.0 : Math.max(0.0, 1.0 - (stdDev - 10) / 30.0);

        const slotsMandatoryCost = slots.reduce((sum, s) => sum + s.mandatoryCost, 0);
        const slotsOptionalMin = slots.reduce((sum, s) => sum + s.optionalCostMin, 0);
        const slotsOptionalMax = slots.reduce((sum, s) => sum + s.optionalCostMax, 0);

        const totalMandatoryCost = slotsMandatoryCost + avgTotalCost;

        const planId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : require('crypto').randomUUID();

        // Dynamic travel score
        const travelScore = Math.max(0.5, Math.min(0.98, 1.0 - (avgTotalTime / 120.0)));

        // Dynamic budget score
        const budgetScore = Math.max(0.5, Math.min(0.98, 1.0 - (totalMandatoryCost / (zoneData.zoneLowestBudget || 2000)) * 0.2));

        // Dynamic preference score based on average candidate suitability/rating
        const preferenceScore = Math.max(0.5, Math.min(0.98, slots.reduce((sum, s) => sum + (s.rating || 4.2), 0) / (slots.length * 5.0)));

        // Dynamic quality score based on average ratings
        const ratings = slots.map(s => s.rating).filter(r => r !== null && r !== undefined);
        const avgRating = ratings.length > 0 ? ratings.reduce((sum, r) => sum + r, 0) / ratings.length : 4.2;
        const qualityScore = Math.max(0.5, Math.min(0.98, avgRating / 5.0 + 0.1));

        // Dynamic weather score
        const isRainySeason = (() => {
          if (!groupData?.outingDate) return false;
          const parts = groupData.outingDate.split('-');
          if (parts.length < 2) return false;
          const month = parseInt(parts[1]);
          return [6, 7, 8].includes(month);
        })();
        const hasOutdoor = slots.some(s => ['PARK', 'PROMENADE', 'BEACH', 'OUTDOOR'].includes(s.category.toUpperCase()));
        const weatherScore = isRainySeason ? (hasOutdoor ? 0.60 : 0.95) : 0.95;

        // Composite overall score using the weights:
        // Travel (35%), Budget (25%), Preferences (20%), Venue Quality (15%), Weather (5%)
        const overallScore = travelScore * 0.35 + budgetScore * 0.25 + preferenceScore * 0.20 + qualityScore * 0.15 + weatherScore * 0.05;

        // Compute real per-member travel averages from breakdown data
        const avgTrainTime = memberTravelsForPlan.length > 0
          ? Math.round(memberTravelsForPlan.reduce((s, m) => s + (m.trainTime || 0), 0) / memberTravelsForPlan.length)
          : 0;
        const avgTrainCost = memberTravelsForPlan.length > 0
          ? Math.round(memberTravelsForPlan.reduce((s, m) => s + (m.trainCost || 0), 0) / memberTravelsForPlan.length)
          : 0;
        const avgAutoTime = memberTravelsForPlan.length > 0
          ? Math.round(memberTravelsForPlan.reduce((s, m) => s + (m.autoTime || 0), 0) / memberTravelsForPlan.length)
          : 0;
        const avgAutoCost = memberTravelsForPlan.length > 0
          ? Math.round(memberTravelsForPlan.reduce((s, m) => s + (m.autoCost || 0), 0) / memberTravelsForPlan.length)
          : 0;
        const avgWalkTime = memberTravelsForPlan.length > 0
          ? Math.round(memberTravelsForPlan.reduce((s, m) => s + (m.walkingTime || 0), 0) / memberTravelsForPlan.length)
          : 0;

        let planName = zoneObj.name;
        let tagline = `A wonderful day out in ${zoneObj.name}.`;

        if (planIndex === 1) {
          tagline = `A pocket-friendly day out exploring scenic walks and cozy local spots in ${zoneObj.name}.`;
        } else if (planIndex === 2) {
          tagline = `Start with coffee, explore a local attraction, then end the day with a great meal in ${zoneObj.name}.`;
        } else if (planIndex === 3) {
          tagline = `An exciting day featuring bowling, arcades, and active entertainment in ${zoneObj.name}.`;
        } else if (planIndex === 4) {
          tagline = `Discover pottery classes, art galleries, and cultural experiences in ${zoneObj.name}.`;
        }

        const draftPlanForWhy = {
          longestTravelTime,
          budgetTier,
          budgetScore,
          score: overallScore,
          slots
        };
        const whyRecList = generateWhyRecommended(draftPlanForWhy, groupData);

        return {
          id: planId,
          groupId: groupData.id,
          planIndex,
          name: planName,
          tagline,
          budgetTier,
          totalEstimatedCostPerHead: totalMandatoryCost + slotsOptionalMin,
          totalDurationMinutes: slots.reduce((sum, s) => sum + s.durationMinutes, 0) + slots.reduce((sum, s) => sum + (s.travelToNextMinutes || 0), 0),
          score: overallScore,

          experienceScore: preferenceScore,
          travelScore: travelScore,
          budgetScore: budgetScore,
          fairnessScore: travelFairnessScore,
          popularityScore: qualityScore,
          groupTypeMatchScore: preferenceScore,
          vibeMatchScore: weatherScore,
          compositeScore: overallScore,

          avgTrainTime,
          avgCabTime: avgAutoTime,
          avgTrainCost,
          avgCabCost: avgAutoCost,
          longestTravelTime,
          shortestTravelTime,
          travelFairnessScore,

          avgAutoTime,
          avgAutoCost,
          avgTotalTime,
          avgTotalCost,
          avgWalkTime,
          mandatoryCost: totalMandatoryCost,
          optionalCostMin: slotsOptionalMin,
          optionalCostMax: slotsOptionalMax,
          whyRecommended: whyRecList,
          slots,
          memberTravels: memberTravelsForPlan
        };
      };

      const itinerary = await buildItineraryData();
      draftItineraries.push(itinerary);
    }
  };

  await buildPass(false);

  if (draftItineraries.length < 4) {
    console.warn(`Only ${draftItineraries.length} plans generated. Running second pass allowing shared venues...`);
    await buildPass(true);
  }

  draftItineraries.sort((a, b) => b.score - a.score);
  draftItineraries.forEach((it, idx) => {
    it.planIndex = idx + 1;
  });

  return draftItineraries;
}

export const plannerService = {
  async generatePlan(
    userId: string,
    groupId: string,
    options: string[] = [],
    authContext?: { clerkId?: string }
  ): Promise<{ success: boolean; plans: PlanWithSlots[] }> {
    const { isHangoutApiConfigured, hangoutApi } = await import('../cloudflare/hangoutApi');
    if (isHangoutApiConfigured()) {
      let clerkId = authContext?.clerkId;
      if (!clerkId) {
        const { userRepository } = await import('../repositories/user.repository');
        const userRecord = await userRepository.findById(userId);
        if (!userRecord) {
          throw new Error('User not found in local database');
        }
        clerkId = userRecord.clerkId;
      }
      const detailsRes = await hangoutApi<any>(`/groups/${groupId}?clerkId=${encodeURIComponent(clerkId)}`);
      if (!detailsRes.success) {
        throw new Error(detailsRes.error?.message || 'Failed to fetch group details from D1');
      }

      const { group: groupData, members, budgetSummary, locations, currentUser } = detailsRes.data;
      if (currentUser.role !== 'ADMIN') {
        throw new ForbiddenError('Only the group admin can generate itineraries.');
      }

      if (!['COLLECTING_MEMBERS', 'COLLECTING_DETAILS', 'READY_TO_GENERATE', 'VOTING'].includes(groupData.status)) {
        throw new ValidationError(`Group is not in a state ready for itinerary generation (current status: ${groupData.status}).`);
      }

      // Collect present members and their locations, with resilient fallbacks
      const presentMembers = members;
      const presentUserIds = presentMembers.map((m: any) => m.userId);
      let presentLocations = locations.filter((loc: any) => presentUserIds.includes(loc.userId));

      // If some members have no locations, assign the calculated group midpoint/centroid of members who have locations, or Mumbai centroid if none.
      const submittedLocations = presentLocations.filter((loc: any) => loc.lat !== 19.0760 || loc.lng !== 72.8777);
      let defaultLat = 19.0760;
      let defaultLng = 72.8777;
      if (submittedLocations.length > 0) {
        defaultLat = submittedLocations.reduce((sum: number, l: any) => sum + l.lat, 0) / submittedLocations.length;
        defaultLng = submittedLocations.reduce((sum: number, l: any) => sum + l.lng, 0) / submittedLocations.length;
      }

      if (presentLocations.length < presentMembers.length) {
        console.warn(`[PLANNER] ${presentMembers.length - presentLocations.length} member(s) missing locations. Assigning calculated group midpoint/centroid.`);
        for (const m of presentMembers) {
          if (!presentLocations.find((l: any) => l.userId === m.userId)) {
            presentLocations.push({ userId: m.userId, lat: defaultLat, lng: defaultLng, locationName: 'Group Midpoint (default)' });
          }
        }
      }

      // Reject invalid coordinates instead of snapping
      for (const loc of presentLocations) {
        if (!validateCoordinates(loc.lat, loc.lng)) {
          throw new ValidationError(`Member location "${loc.locationName || 'Unknown'}" has coordinates (${loc.lat}, ${loc.lng}) which are outside the supported Mumbai, Navi Mumbai, and Thane region. Please re-enter a valid location.`);
        }
      }

      const minBudget = budgetSummary.min || 1000;
      const avgBudget = budgetSummary.avg || 2000;
      const maxBudget = budgetSummary.max || 5000;

      // Fetch preferred activities from users in parallel
      const favoriteCategories: string[] = [];
      try {
        const userResponses = await Promise.all(
          presentMembers.map((m: any) =>
            hangoutApi<any>(`/users?clerkId=${m.clerkId}`).catch((err: any) => {
              console.error(`Error fetching user activities for ${m.clerkId}:`, err);
              return null;
            })
          )
        );
        for (const userRes of userResponses) {
          if (userRes && userRes.success && userRes.data?.favoriteActivities) {
            try {
              const acts = JSON.parse(userRes.data.favoriteActivities);
              if (Array.isArray(acts)) {
                favoriteCategories.push(...acts);
              }
            } catch (_e) {}
          }
        }
      } catch (err) {
        console.error('Error in parallel activities fetch:', err);
      }
      const uniquePreferredCategories = Array.from(new Set(favoriteCategories));

      const aggregatedVibes = new Set<string>();
      for (const m of presentMembers) {
        if (m.vibes) {
          try {
            const memberVibes = JSON.parse(m.vibes);
            if (Array.isArray(memberVibes)) {
              memberVibes.forEach(v => aggregatedVibes.add(v));
            }
          } catch (_e) {}
        }
      }
      const vibes = Array.from(aggregatedVibes);
      if (vibes.length === 0 && groupData.vibes) {
        try {
          const groupVibes = JSON.parse(groupData.vibes);
          if (Array.isArray(groupVibes)) {
            groupVibes.forEach(v => vibes.push(v));
          }
        } catch (_e) {}
      }

      const lowestBudget = minBudget;

      let draftPlans: any[] = [];
      try {
        draftPlans = await executePlanningEngine(
          groupData,
          presentMembers,
          budgetSummary,
          presentLocations,
          uniquePreferredCategories,
          vibes,
          [], // empty history
          lowestBudget,
          options
        );
      } catch (engineErr) {
        console.error('[PLANNER] executePlanningEngine failed, falling back to hardcoded plans:', engineErr);
      }

      // Pad to exactly 4 plans if fewer are generated
      if (draftPlans.length < 4) {
        console.warn(`[PLANNER] Only ${draftPlans.length} plans generated by engine. Padding with fallback itineraries.`);
        const mLocs = presentLocations.map((l: any) => ({ lat: l.lat, lng: l.lng }));
        const budget = lowestBudget || budgetSummary?.min || 1000;
        const existingIndexes = new Set(draftPlans.map(d => d.planIndex));

        const usedPlaceIds = new Set<string>();
        draftPlans.forEach(plan => {
          plan.slots?.forEach((slot: any) => {
            if (slot.venueId) usedPlaceIds.add(slot.venueId);
            if (slot.experienceId) usedPlaceIds.add(slot.experienceId);
          });
        });

        for (let fi = 1; fi <= 4; fi++) {
          if (!existingIndexes.has(fi)) {
            const fallbackPlan = buildFallbackItineraryData(fi, groupData, presentMembers, presentLocations, mLocs, budget, usedPlaceIds);
            fallbackPlan.planIndex = fi;
            draftPlans.push(fallbackPlan);
          }
        }
      }

      const context: ItineraryPromptContext = {
        groupName: groupData.name,
        groupType: groupData.groupType as any,
        vibes,
        memberCount: presentMembers.length,
        groupMinBudget: minBudget,
        groupAvgBudget: avgBudget,
        groupMaxBudget: maxBudget,
        preferredCategories: uniquePreferredCategories,
        midpointAddress: draftPlans[0]?.name || 'Mumbai Central',
        venues: [],
        experiences: [],
        outingDate: groupData.outingDate,
        outingTime: groupData.outingTime,
      };

      const groqResult = await generateItineraries(draftPlans, context);

      const dbPlans: any[] = [];
      const dbSlots: any[] = [];
      const dbMemberTravels: any[] = [];

      const randomUUID = () => {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
          return crypto.randomUUID();
        }
        return require('crypto').randomUUID();
      };

      groqResult.itineraries.forEach((it, idx) => {
        const draft = draftPlans.find(d => d.planIndex === it.id || d.id === it.id) || draftPlans[idx % draftPlans.length];
        const planId = draft.id;

        dbPlans.push({
          id: planId,
          groupId,
          planIndex: idx + 1,
          name: it.name,
          tagline: it.tagline,
          meetupZone: draft.name,
          budgetTier: it.budgetTier || draft.budgetTier,
          totalEstimatedCostPerHead: it.totalEstimatedCostPerHead || draft.totalEstimatedCostPerHead,
          totalDurationMinutes: it.totalDurationMinutes || draft.totalDurationMinutes,
          score: draft.score,

          experienceScore: draft.experienceScore,
          travelScore: draft.travelScore,
          budgetScore: draft.budgetScore,
          fairnessScore: draft.fairnessScore,
          popularityScore: draft.popularityScore,
          groupTypeMatchScore: draft.groupTypeMatchScore,
          vibeMatchScore: draft.vibeMatchScore,
          compositeScore: draft.compositeScore,

          avgTrainTime: draft.avgTrainTime,
          avgCabTime: draft.avgCabTime,
          avgTrainCost: draft.avgTrainCost,
          avgCabCost: draft.avgCabCost,
          longestTravelTime: draft.longestTravelTime,
          shortestTravelTime: draft.shortestTravelTime,
          travelFairnessScore: draft.travelFairnessScore,

          mandatoryCost: draft.mandatoryCost,
          optionalCostMin: draft.optionalCostMin,
          optionalCostMax: draft.optionalCostMax,
          whyRecommended: JSON.stringify(it.whyRecommended || draft.whyRecommended),
          avgAutoTime: draft.avgAutoTime,
          avgAutoCost: draft.avgAutoCost,
          avgTotalTime: draft.avgTotalTime,
          avgTotalCost: draft.avgTotalCost,
          avgWalkTime: draft.avgWalkTime,
          generatedAt: new Date().toISOString()
        });

        it.slots.forEach((s: any) => {
          const draftSlot = draft.slots.find((ds: any) => ds.order === s.order) || draft.slots[s.order - 1];
          const finalVenueId = (draftSlot?.venueId && !draftSlot.venueId.startsWith('fb_') && !draftSlot.venueId.startsWith('fallback_')) ? draftSlot.venueId : null;
          dbSlots.push({
            id: randomUUID(),
            planId,
            slotOrder: s.order,
            venueId: finalVenueId,
            experienceId: draftSlot?.experienceId || null,
            venueName: s.name,
            name: s.name,
            category: s.category,
            arrivalTime: s.arrivalTime,
            durationMinutes: s.durationMinutes,
            travelToNextMinutes: s.travelToNextMinutes || null,
            estimatedCostPerHead: s.estimatedCostPerHead,
            note: s.note,
            travelToNextCost: draftSlot?.travelToNextCost || null,
            imageUrl: s.imageUrl || draftSlot?.imageUrl || null,
            link: s.link || draftSlot?.link || null
          });
        });

        draft.memberTravels.forEach((mt: any) => {
          dbMemberTravels.push({
            id: mt.id,
            planId,
            userId: mt.userId,
            trainTime: mt.trainTime,
            trainCost: mt.trainCost,
            cabTime: mt.autoTime,
            cabCost: mt.autoCost,
            walkTime: mt.walkingTime,
            autoTime: mt.autoTime,
            autoCost: mt.autoCost,
            totalTime: mt.totalTime,
            totalCost: mt.totalCost
          });
        });
      });

      const dbVenues: any[] = [];
      const seenVenueIds = new Set<string>();
      draftPlans.forEach((draft: any) => {
        draft.slots.forEach((ds: any) => {
          if (ds.venueId && !ds.venueId.startsWith('fb_') && !ds.venueId.startsWith('fallback_') && !seenVenueIds.has(ds.venueId)) {
            seenVenueIds.add(ds.venueId);
            dbVenues.push({
              id: ds.venueId,
              name: ds.name,
              address: ds.address || '',
              lat: ds.lat,
              lng: ds.lng,
              rating: ds.rating ?? null,
              category: ds.category || '',
              mandatoryCost: ds.mandatoryCost || 0,
              optionalCostMin: ds.optionalCostMin || 0,
              optionalCostMax: ds.optionalCostMax || 0,
              imageUrl: ds.imageUrl || null,
              link: ds.link || null
            });
          }
        });
      });

      let saveSucceeded = false;
      try {
        const saveRes = await hangoutApi<any>(`/groups/${groupId}/plans`, {
          method: 'POST',
          body: {
            plans: dbPlans,
            slots: dbSlots,
            memberTravels: dbMemberTravels,
            venues: dbVenues,
            generationOptions: options,
          },
        });
        saveSucceeded = saveRes.success;
        if (!saveRes.success) {
          console.error('[PLANNER] D1 save failed:', saveRes.error?.message || 'Unknown error');
        }
      } catch (saveErr) {
        console.error('[PLANNER] D1 save threw an error, returning plans anyway:', saveErr);
      }

      // If save succeeded, fetch the persisted plans; otherwise return the in-memory plans directly
      if (saveSucceeded) {
        try {
          const savedPlans = await hangoutApi<any>(`/groups/${groupId}/plans`);
          if (savedPlans.success && savedPlans.data) {
            return { success: true, plans: savedPlans.data };
          }
        } catch (fetchErr) {
          console.error('[PLANNER] Failed to fetch saved plans from D1, returning in-memory plans:', fetchErr);
        }
      }

      // Return in-memory plans as a fallback
      const inMemoryPlans = dbPlans.map((plan: any, idx: number) => {
        const planSlotsList = dbSlots.filter((s: any) => s.planId === plan.id);
        const planMemberTravels = dbMemberTravels.filter((mt: any) => mt.planId === plan.id);
        return {
          ...plan,
          slots: planSlotsList,
          memberTravelMetrics: planMemberTravels,
        };
      });
      return { success: true, plans: inMemoryPlans };
    }

    // 1. Verify group exists
    const group = await groupRepository.findById(groupId);
    if (!group || group.status === 'DELETED') {
      throw new NotFoundError('The specified planning group does not exist.');
    }

    // 2. Verify caller is ADMIN
    const callerMember = await memberRepository.getMember(groupId, userId);
    if (!callerMember || callerMember.role !== 'ADMIN') {
      throw new ForbiddenError('Only the group admin can generate itineraries.');
    }

    // 3. Verify group status is ready for generation
    if (!['COLLECTING_MEMBERS', 'COLLECTING_DETAILS', 'READY_TO_GENERATE', 'VOTING'].includes(group.status)) {
      throw new ValidationError(`Group is not in a state ready for itinerary generation (current status: ${group.status}).`);
    }

    // 4. Fetch members
    const members = await memberRepository.getMembersWithUserDetails(groupId);
    if (members.length === 0) {
      throw new NotFoundError('No members found in this group.');
    }

    const presentMembers = members;
    const presentUserIds = presentMembers.map(m => m.userId);

    // 5. Check submitted locations — resilient fallbacks
    const locations = await locationRepository.getGroupLocations(groupId);
    const presentLocations: any[] = locations.filter(l => presentUserIds.includes(l.userId));

    // If some members have no locations, assign the calculated group midpoint/centroid of members who have locations, or Mumbai centroid if none.
    const submittedLocations = presentLocations.filter((loc: any) => loc.lat !== 19.0760 || loc.lng !== 72.8777);
    let defaultLat = 19.0760;
    let defaultLng = 72.8777;
    if (submittedLocations.length > 0) {
      defaultLat = submittedLocations.reduce((sum: number, l: any) => sum + l.lat, 0) / submittedLocations.length;
      defaultLng = submittedLocations.reduce((sum: number, l: any) => sum + l.lng, 0) / submittedLocations.length;
    }

    if (presentLocations.length < presentMembers.length) {
      console.warn(`[PLANNER-LOCAL] ${presentMembers.length - presentLocations.length} member(s) missing locations. Assigning calculated group midpoint/centroid.`);
      for (const m of presentMembers) {
        if (!presentLocations.find((l: any) => l.userId === m.userId)) {
          presentLocations.push({ userId: m.userId, lat: defaultLat, lng: defaultLng, locationName: 'Group Midpoint (default)' });
        }
      }
    }

    // Reject invalid coordinates instead of snapping
    for (const loc of presentLocations) {
      if (!validateCoordinates(loc.lat, loc.lng)) {
        throw new ValidationError(`Member location "${loc.locationName || 'Unknown'}" has coordinates (${loc.lat}, ${loc.lng}) which are outside the supported Mumbai, Navi Mumbai, and Thane region. Please re-enter a valid location.`);
      }
    }

    // 6. Fetch budgets list (fallback to default 2000 if none)
    const budgetsList = await budgetRepository.getGroupBudgets(groupId);
    const presentBudgetsList = budgetsList.filter(b => presentUserIds.includes(b.userId));
    const presentBudgets = presentBudgetsList.map(b => b.maxBudget);
    
    if (presentBudgets.length === 0) {
      presentBudgets.push(2000);
    }

    const presentBudgetSummary = {
      min: Math.min(...presentBudgets),
      avg: Math.round(presentBudgets.reduce((sum, b) => sum + b, 0) / presentBudgets.length),
      max: Math.max(...presentBudgets),
      submittedCount: presentBudgets.length,
      totalMembers: presentMembers.length,
    };

    // Set group status to GENERATING
    validateStatusTransition(group.status, 'GENERATING');
    await groupRepository.update(groupId, {
      status: 'GENERATING',
    });

    try {
      // 7. Gather preferences and vibes
      const favoriteCategories: string[] = [];
      try {
        const userResults = await Promise.all(presentMembers.map(m => dbSelectUserActivities(m.userId)));
        for (const user of userResults) {
          if (user && user.favoriteActivities) {
            try {
              const acts = JSON.parse(user.favoriteActivities);
              if (Array.isArray(acts)) {
                favoriteCategories.push(...acts);
              }
            } catch (_e) {
              const acts = user.favoriteActivities.split(',').map((s: string) => s.trim());
              favoriteCategories.push(...acts);
            }
          }
        }
      } catch (err) {
        console.error('Error fetching user activities in parallel:', err);
      }
      const uniquePreferredCategories = Array.from(new Set(favoriteCategories));

      // Collect vibes
      const aggregatedVibes = new Set<string>();
      for (const m of presentMembers) {
        if (m.vibes) {
          try {
            const memberVibes = JSON.parse(m.vibes);
            if (Array.isArray(memberVibes)) {
              memberVibes.forEach(v => aggregatedVibes.add(v));
            }
          } catch (_e) {}
        }
      }
      const vibes = Array.from(aggregatedVibes);
      if (vibes.length === 0 && group.vibes) {
        try {
          const groupVibes = JSON.parse(group.vibes);
          if (Array.isArray(groupVibes)) {
            groupVibes.forEach(v => vibes.push(v));
          }
        } catch (_e) {}
      }

      const firstMemberId = presentMembers[0].userId;
      const historyEntries = await historyRepository.getHistoryForUser(firstMemberId);

      const lowestBudget = presentBudgetSummary.min;

      let draftPlans: any[] = [];
      try {
        draftPlans = await executePlanningEngine(
          group,
          presentMembers,
          presentBudgetSummary,
          presentLocations,
          uniquePreferredCategories,
          vibes,
          historyEntries,
          lowestBudget,
          options
        );
      } catch (engineErr) {
        console.error('[PLANNER-LOCAL] executePlanningEngine failed, falling back to hardcoded plans:', engineErr);
      }

      // Pad to exactly 4 plans if fewer are generated
      if (draftPlans.length < 4) {
        console.warn(`[PLANNER-LOCAL] Only ${draftPlans.length} plans generated by engine. Padding with fallback itineraries.`);
        const mLocs = presentLocations.map((l: any) => ({ lat: l.lat, lng: l.lng }));
        const budget = lowestBudget || presentBudgetSummary?.min || 1000;
        const existingIndexes = new Set(draftPlans.map(d => d.planIndex));

        const usedPlaceIds = new Set<string>();
        draftPlans.forEach(plan => {
          plan.slots?.forEach((slot: any) => {
            if (slot.venueId) usedPlaceIds.add(slot.venueId);
            if (slot.experienceId) usedPlaceIds.add(slot.experienceId);
          });
        });

        for (let fi = 1; fi <= 4; fi++) {
          if (!existingIndexes.has(fi)) {
            const fallbackPlan = buildFallbackItineraryData(fi, group, presentMembers, presentLocations, mLocs, budget, usedPlaceIds);
            fallbackPlan.planIndex = fi;
            draftPlans.push(fallbackPlan);
          }
        }
      }

      const context: ItineraryPromptContext = {
        groupName: group.name,
        groupType: group.groupType as any,
        vibes,
        memberCount: presentMembers.length,
        groupMinBudget: presentBudgetSummary.min,
        groupAvgBudget: presentBudgetSummary.avg,
        groupMaxBudget: presentBudgetSummary.max,
        preferredCategories: uniquePreferredCategories,
        midpointAddress: draftPlans[0]?.name || 'Mumbai Central',
        venues: [],
        experiences: [],
        outingDate: group.outingDate,
        outingTime: group.outingTime,
      };

      const groqResult = await generateItineraries(draftPlans, context);

      const dbPlans: any[] = [];
      const dbSlots: any[] = [];
      const dbMemberTravels: any[] = [];

      const randomUUID = () => {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
          return crypto.randomUUID();
        }
        return require('crypto').randomUUID();
      };

      groqResult.itineraries.forEach((it, idx) => {
        const draft = draftPlans.find(d => d.planIndex === it.id || d.id === it.id) || draftPlans[idx % draftPlans.length];
        const planId = draft.id;

        dbPlans.push({
          id: planId,
          groupId,
          planIndex: idx + 1,
          name: it.name,
          tagline: it.tagline,
          meetupZone: draft.name,
          budgetTier: it.budgetTier || draft.budgetTier,
          totalEstimatedCostPerHead: it.totalEstimatedCostPerHead || draft.totalEstimatedCostPerHead,
          totalDurationMinutes: it.totalDurationMinutes || draft.totalDurationMinutes,
          score: draft.score,

          experienceScore: draft.experienceScore,
          travelScore: draft.travelScore,
          budgetScore: draft.budgetScore,
          fairnessScore: draft.fairnessScore,
          popularityScore: draft.popularityScore,
          groupTypeMatchScore: draft.groupTypeMatchScore,
          vibeMatchScore: draft.vibeMatchScore,
          compositeScore: draft.compositeScore,

          avgTrainTime: draft.avgTrainTime,
          avgCabTime: draft.avgCabTime,
          avgTrainCost: draft.avgTrainCost,
          avgCabCost: draft.avgCabCost,
          longestTravelTime: draft.longestTravelTime,
          shortestTravelTime: draft.shortestTravelTime,
          travelFairnessScore: draft.travelFairnessScore,

          mandatoryCost: draft.mandatoryCost,
          optionalCostMin: draft.optionalCostMin,
          optionalCostMax: draft.optionalCostMax,
          whyRecommended: JSON.stringify(it.whyRecommended || draft.whyRecommended),
          avgAutoTime: draft.avgAutoTime,
          avgAutoCost: draft.avgAutoCost,
          avgTotalTime: draft.avgTotalTime,
          avgTotalCost: draft.avgTotalCost,
          avgWalkTime: draft.avgWalkTime,
          generatedAt: new Date().toISOString()
        });

        it.slots.forEach((s: any) => {
          const draftSlot = draft.slots.find((ds: any) => ds.order === s.order) || draft.slots[s.order - 1];
          const finalVenueId = (draftSlot?.venueId && !draftSlot.venueId.startsWith('fb_') && !draftSlot.venueId.startsWith('fallback_')) ? draftSlot.venueId : null;
          dbSlots.push({
            id: randomUUID(),
            planId,
            slotOrder: s.order,
            venueId: finalVenueId,
            experienceId: draftSlot?.experienceId || null,
            venueName: s.name,
            name: s.name,
            category: s.category,
            arrivalTime: s.arrivalTime,
            durationMinutes: s.durationMinutes,
            travelToNextMinutes: s.travelToNextMinutes || null,
            estimatedCostPerHead: s.estimatedCostPerHead,
            note: s.note,
            travelToNextCost: draftSlot?.travelToNextCost || null,
            imageUrl: s.imageUrl || draftSlot?.imageUrl || null,
            link: s.link || draftSlot?.link || null
          });
        });

        draft.memberTravels.forEach((mt: any) => {
          dbMemberTravels.push({
            id: mt.id,
            planId,
            userId: mt.userId,
            trainTime: mt.trainTime,
            trainCost: mt.trainCost,
            cabTime: mt.autoTime,
            cabCost: mt.autoCost,
            walkTime: mt.walkingTime,
            autoTime: mt.autoTime,
            autoCost: mt.autoCost,
            totalTime: mt.totalTime,
            totalCost: mt.totalCost
          });
        });
      });

      // 12. Transactional Release: delete old plans, write new ones, set status to VOTING
      validateStatusTransition('GENERATING', 'VOTING');
      
      await safeTransaction(async (tx: any) => {
        // Delete old member travel metrics first
        const persistedPlans = await tx.select().from(plans).where(eq(plans.groupId, groupId));
        if (persistedPlans.length > 0) {
          const planIds = persistedPlans.map((p: any) => p.id);
          await tx
            .delete(memberTravelMetrics)
            .where(sql`plan_id IN (${sql.join(planIds.map((id: any) => sql`${id}`), sql`, `)})`);
        }
        await tx.delete(plans).where(eq(plans.groupId, groupId));

        if (dbPlans.length > 0) {
          await tx.insert(plans).values(dbPlans);
        }
        if (dbSlots.length > 0) {
          await tx.insert(planSlots).values(dbSlots);

          // Increment timesGenerated locally for the places
          for (const slot of dbSlots) {
            if (slot.venueId && !slot.venueId.startsWith('fb_') && !slot.venueId.startsWith('fallback_')) {
              await tx.run(sql`
                INSERT INTO ranking_metrics (place_id, times_generated, times_viewed, times_voted, times_won)
                VALUES (${slot.venueId}, 1, 0, 0, 0)
                ON CONFLICT(place_id)
                DO UPDATE SET times_generated = times_generated + 1
              `);
            }
          }
        }
        if (dbMemberTravels.length > 0) {
          await tx.insert(memberTravelMetrics).values(dbMemberTravels);
        }
        
        await tx
          .update(groups)
          .set({
            status: 'VOTING',
            votingStatus: 'OPEN',
            timerExpiresAt: null,
            generationOptions: JSON.stringify(options),
            updatedAt: new Date().toISOString(),
          })
          .where(eq(groups.id, groupId));
      });

      const persistedPlans = await planRepository.getPlansForGroup(groupId);

      return {
        success: true,
        plans: persistedPlans,
      };
    } catch (err) {
      await groupRepository.update(groupId, {
        status: 'READY_TO_GENERATE',
      });
      throw err;
    }
  },
};

async function dbSelectUserActivities(userId: string) {
  const result = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return result[0];
}
