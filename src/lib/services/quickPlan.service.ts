import 'server-only';

import { ValidationError } from '../errors';
import { isHangoutApiConfigured, hangoutApi } from '../cloudflare/hangoutApi';
import {
  executePlanningEngineForEval,
  getVenueZone,
  isVenueOpenAtTime,
  validateCoordinates,
  type PlanningArea,
} from './planner.service';
import { MUMBAI_ZONES } from '../algorithms/zoneSelection';
import { geocodeAddress } from '../maps/geocoding';

export type QuickPlanMode = 'AREA' | 'PIN' | 'VENUE';

export interface QuickPlanInput {
  mode: QuickPlanMode;
  /** Zone name for AREA, address/pin text for PIN, place name for VENUE. */
  location: string;
  headcount: number;
  budget: number;
  /** true → budget is per person; false → total for the group. */
  perPerson: boolean;
  tags: string[];
  outingDate?: string; // "YYYY-MM-DD"
  outingTime?: string; // "18:00"
}

export interface QuickPlanResult {
  plans: any[];
  planningArea: PlanningArea;
  /** VENUE mode: whether the must-visit venue was matched in the catalog and enforced. */
  requiredVenueMatched?: boolean;
  requiredVenueName?: string;
}

// Radius is an implementation detail decided by mode — never exposed to callers.
const MODE_RADIUS_KM: Record<QuickPlanMode, number> = {
  AREA: 4,
  PIN: 2.5,
  VENUE: 2,
};

// Minimum open venues the area must have at the outing time before we spend a
// full engine run on it.
const MIN_VIABLE_VENUES = 8;

// Plain-language tags → planner categories. Same vocabulary the group planner
// scores against; no new planner concepts.
const TAG_CATEGORY_MAP: Record<string, string[]> = {
  food: ['CAFE', 'RESTAURANT', 'DESSERT'],
  cafe: ['CAFE'],
  dessert: ['DESSERT'],
  date: ['CAFE', 'RESTAURANT', 'PARK'],
  chill: ['CAFE', 'PARK'],
  adventure: ['ARCADE', 'BOWLING', 'ESCAPE_ROOM', 'SPORTS'],
  games: ['ARCADE', 'BOWLING', 'ESCAPE_ROOM'],
  creative: ['POTTERY', 'WORKSHOP', 'PAINTING', 'ART_GALLERY'],
  culture: ['MUSEUM', 'ART_GALLERY'],
  nightlife: ['RESTAURANT', 'BOWLING', 'ARCADE'],
  shopping: ['MALL'],
  movie: ['MOVIE'],
  outdoors: ['PARK'],
};

const TAG_VIBE_MAP: Record<string, string> = {
  date: 'ROMANTIC',
  chill: 'CHILL',
  creative: 'CREATIVE',
  adventure: 'ADVENTUROUS',
  nightlife: 'ENERGETIC',
};

function mapTagsToCategories(tags: string[]): string[] {
  const out = new Set<string>();
  for (const tag of tags) {
    const cats = TAG_CATEGORY_MAP[tag.toLowerCase().trim()];
    if (cats) cats.forEach(c => out.add(c));
  }
  return Array.from(out);
}

function mapTagsToVibes(tags: string[]): string[] {
  const out = new Set<string>();
  for (const tag of tags) {
    const vibe = TAG_VIBE_MAP[tag.toLowerCase().trim()];
    if (vibe) out.add(vibe);
  }
  return Array.from(out);
}

function inferGroupType(tags: string[], headcount: number): string {
  const lower = tags.map(t => t.toLowerCase());
  if (lower.includes('date')) return 'DATE';
  if (lower.includes('family')) return 'FAMILY';
  if (lower.includes('work') || lower.includes('team')) return 'WORK';
  if (headcount === 2 && lower.includes('romantic')) return 'DATE';
  return 'FRIENDS';
}

/** Per-head budget regardless of input mode. */
function normalizeBudget(budget: number, perPerson: boolean, headcount: number): number {
  const perHead = perPerson ? budget : Math.floor(budget / Math.max(1, headcount));
  return Math.max(100, Math.round(perHead));
}

// ---------------------------------------------------------------------------
// Location resolution
// ---------------------------------------------------------------------------

function matchZone(name: string) {
  const q = name.toLowerCase().trim();
  return MUMBAI_ZONES.find(z => z.name.toLowerCase() === q)
    ?? MUMBAI_ZONES.find(z => q.includes(z.name.toLowerCase()) || z.name.toLowerCase().includes(q))
    ?? null;
}

async function fetchAreaVenues(lat: number, lng: number, radiusKm: number): Promise<any[]> {
  if (isHangoutApiConfigured()) {
    const res = await hangoutApi<any>('/internal/places/by-zone', {
      method: 'POST',
      body: { lat, lng, radiusKm },
    });
    return res?.success && Array.isArray(res.data) ? res.data : [];
  }
  const { db } = await import('../db/client');
  const { places, placeCategories, placeCosts } = await import('../db/schema');
  const { and, between, eq } = await import('drizzle-orm');
  const latDiff = radiusKm / 111.0;
  const lngDiff = radiusKm / (111.0 * Math.cos(lat * Math.PI / 180));
  return db
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
      isHidden: places.isHidden,
    })
    .from(places)
    .innerJoin(placeCategories, eq(placeCategories.placeId, places.id))
    .innerJoin(placeCosts, eq(placeCosts.placeId, places.id))
    .where(and(
      eq(places.isHidden, 0),
      eq(places.businessStatus, 'OPERATIONAL'),
      between(places.lat, lat - latDiff, lat + latDiff),
      between(places.lng, lng - lngDiff, lng + lngDiff),
    ));
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

async function resolveLocation(input: QuickPlanInput): Promise<{
  area: PlanningArea;
  requiredVenueId?: string;
  requiredVenueName?: string;
  requiredVenueMatched?: boolean;
}> {
  const radiusKm = MODE_RADIUS_KM[input.mode];

  if (input.mode === 'AREA') {
    const zone = matchZone(input.location);
    if (zone) {
      return { area: { lat: zone.lat, lng: zone.lng, name: zone.name, radiusKm, allowedZoneNames: [zone.name] } };
    }
    // Unrecognized area name — geocode it and keep the user's wording.
    const geo = await geocodeAddress(input.location);
    if (!validateCoordinates(geo.lat, geo.lng)) {
      throw new ValidationError(`"${input.location}" is outside the supported Mumbai, Navi Mumbai, and Thane region.`);
    }
    return { area: { lat: geo.lat, lng: geo.lng, name: input.location, radiusKm } };
  }

  if (input.mode === 'PIN') {
    const geo = await geocodeAddress(input.location);
    if (!validateCoordinates(geo.lat, geo.lng)) {
      throw new ValidationError(`"${input.location}" is outside the supported Mumbai, Navi Mumbai, and Thane region.`);
    }
    return { area: { lat: geo.lat, lng: geo.lng, name: geo.formattedAddress || input.location, radiusKm } };
  }

  // VENUE: locate the must-visit place, prefer the catalog so the engine can
  // enforce it as a required venue.
  const geo = await geocodeAddress(input.location);
  if (!validateCoordinates(geo.lat, geo.lng)) {
    throw new ValidationError(`"${input.location}" is outside the supported Mumbai, Navi Mumbai, and Thane region.`);
  }
  const nearby = await fetchAreaVenues(geo.lat, geo.lng, radiusKm);
  const q = input.location.toLowerCase().trim();
  const catalogMatch = nearby
    .filter((v: any) => v.isHidden !== 1)
    .map((v: any) => ({ v, dist: haversineKm({ lat: v.lat, lng: v.lng }, geo) }))
    .filter(({ v }: any) => {
      const n = String(v.name ?? '').toLowerCase();
      return n.includes(q) || q.includes(n);
    })
    .sort((a: any, b: any) => a.dist - b.dist)[0]?.v ?? null;

  if (catalogMatch) {
    return {
      area: { lat: catalogMatch.lat, lng: catalogMatch.lng, name: catalogMatch.name, radiusKm },
      requiredVenueId: catalogMatch.id,
      requiredVenueName: catalogMatch.name,
      requiredVenueMatched: true,
    };
  }
  // Not in catalog: still honor the locality (build around the point), but we
  // can't force an unknown venue into the plans.
  return {
    area: { lat: geo.lat, lng: geo.lng, name: input.location, radiusKm },
    requiredVenueName: input.location,
    requiredVenueMatched: false,
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export const quickPlanService = {
  /**
   * Quick Plan: the user already knows where they want to go. Generates
   * complete itineraries centred on a single chosen area or venue using the
   * SAME planning engine as the group planner — every suggested stop stays
   * within the selected locality. Nothing is persisted; results live in
   * memory until the user saves one.
   */
  async generate(userId: string, input: QuickPlanInput): Promise<QuickPlanResult> {
    if (!input.location?.trim()) throw new ValidationError('Enter a location.');
    if (!input.headcount || input.headcount < 1 || input.headcount > 20) {
      throw new ValidationError('Headcount must be between 1 and 20.');
    }
    if (!input.budget || input.budget < 50) throw new ValidationError('Enter a valid budget.');

    const resolved = await resolveLocation(input);
    const { area } = resolved;

    // Preflight viability: enough OPEN venues at the outing time, before we
    // pay for a full engine run.
    const areaVenues = await fetchAreaVenues(area.lat, area.lng, area.radiusKm);
    const within = areaVenues.filter((v: any) =>
      v.isHidden !== 1
      && haversineKm({ lat: v.lat, lng: v.lng }, area) <= area.radiusKm
      && (!area.allowedZoneNames || area.allowedZoneNames.includes(getVenueZone(v.lat, v.lng, v.name, v.address || '')))
    );
    const openAtTime = within.filter((v: any) => isVenueOpenAtTime(String(v.category ?? ''), input.outingTime));
    if (openAtTime.length < MIN_VIABLE_VENUES) {
      throw new ValidationError(
        `Not enough open venues near ${area.name}${input.outingTime ? ` at ${input.outingTime}` : ''}. ` +
        `Try a wider area, a different time, or a nearby landmark.`
      );
    }

    const perHeadBudget = normalizeBudget(input.budget, input.perPerson, input.headcount);
    const groupType = inferGroupType(input.tags, input.headcount);
    const preferredCategories = mapTagsToCategories(input.tags);
    const vibes = mapTagsToVibes(input.tags);

    const quickId = `quick_${typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : require('crypto').randomUUID()}`;

    // Synthetic group: N members at identical coordinates with a normalized
    // budget. Every downstream engine stage behaves naturally — no quick-mode
    // conditionals inside the planner.
    const groupData = {
      id: quickId,
      name: `Quick Plan — ${area.name}`,
      groupType,
      vibes: JSON.stringify(vibes),
      status: 'READY_TO_GENERATE',
      outingDate: input.outingDate ?? new Date().toISOString().split('T')[0],
      outingTime: input.outingTime ?? '12:00',
      generationOptions: null,
      activity: null,
      outingType: null,
      outingIntent: undefined,
      requiredPreferences: [],
    };

    const presentMembers = Array.from({ length: input.headcount }, (_, i) => ({
      userId: i === 0 ? userId : `${quickId}_m${i}`,
      clerkId: null,
      name: i === 0 ? 'You' : `Guest ${i}`,
      role: i === 0 ? 'ADMIN' : 'MEMBER',
      isPresent: 1,
      vibes: null,
    }));

    // One location row PER member — the engine defaults members missing from
    // presentLocations to the Mumbai centroid, which would break the lock.
    const presentLocations = presentMembers.map(m => ({
      userId: m.userId,
      lat: area.lat,
      lng: area.lng,
      locationName: area.name,
    }));

    const budgetSummary = {
      min: perHeadBudget,
      avg: perHeadBudget,
      max: perHeadBudget,
      total: perHeadBudget * input.headcount,
      submittedCount: input.headcount,
      totalMembers: input.headcount,
    };

    const plans = await executePlanningEngineForEval(
      groupData,
      presentMembers,
      budgetSummary,
      presentLocations,
      preferredCategories,
      vibes,
      [], // history
      perHeadBudget,
      [], // options
      area,
      resolved.requiredVenueId,
    );

    if (!plans || plans.length === 0) {
      throw new ValidationError(
        `Couldn't build a full outing near ${area.name} within ₹${perHeadBudget}/head. ` +
        `Try raising the budget, widening the area, or different tags.`
      );
    }

    return {
      plans,
      planningArea: area,
      requiredVenueMatched: resolved.requiredVenueMatched,
      requiredVenueName: resolved.requiredVenueName,
    };
  },
};

export type QuickPlanService = typeof quickPlanService;
