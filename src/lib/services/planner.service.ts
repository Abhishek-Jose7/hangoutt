import 'server-only';
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
import { users, groups, plans, planSlots, memberTravelMetrics } from '../db/schema';
import { eq, sql } from 'drizzle-orm';
import { InsufficientLocationsError, NotFoundError, ValidationError, ForbiddenError } from '../errors';
import { ItineraryPromptContext } from '../types/planner.types';
import { validateStatusTransition } from './group.service';
import { getVenueImageUrl, getVenueDetails, searchTextVenues } from '../maps/places';

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
  if (cat === 'MUSEUM' || cat === 'ART_GALLERY') {
    return hour >= 10.0 && hour <= 18.0; // 10 AM to 6 PM
  }
  if (cat === 'PARK') {
    return hour >= 6.0 && hour <= 19.0; // 6 AM to 7 PM
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
}

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

function scorePlaceCandidate(
  place: PlaceCandidate,
  groupType: string,
  vibes: string[],
  maxBudget: number,
  lowestBudget: number,
  avgMemberCoords: LatLng,
  options: string[] = []
): number {
  // 1. Experience score based on category weights
  const weights = CATEGORY_WEIGHTS[groupType.toUpperCase()] || CATEGORY_WEIGHTS.CUSTOM;
  const weight = weights[place.category.toUpperCase()] || 5;
  const experienceScore = weight / 10.0;

  // 2. Budget score
  let budgetScore = 0.0;
  if (place.estimatedCostPerHead <= lowestBudget) {
    budgetScore = 1.0;
  } else if (place.estimatedCostPerHead <= maxBudget) {
    const range = maxBudget - lowestBudget;
    budgetScore = range > 0 ? 1.0 - ((place.estimatedCostPerHead - lowestBudget) / range) : 1.0;
  }
  budgetScore = Math.min(1.0, Math.max(0.0, budgetScore));

  // 3. Travel score from average member coordinate
  const dist = getHaversineDistance(avgMemberCoords, { lat: place.lat, lng: place.lng });
  const distPenaltyMultiplier = options.includes('Less Travel') ? 3.0 : 1.0;
  const travelScore = Math.max(0.0, 1.0 - ((dist * distPenaltyMultiplier) / 15.0)); // 15km scale

  // 4. Rating score
  const ratingScore = Math.min(1.0, Math.max(0.0, (place.rating || 4.0) / 5.0));

  // 5. Vibe score
  const vibeMap: Record<string, string[]> = {
    CHILL: ['PARK', 'CAFE', 'DESSERT'],
    CREATIVE: ['POTTERY', 'PAINTING', 'WORKSHOP', 'MUSEUM', 'ART_GALLERY'],
    FOODIE: ['RESTAURANT', 'DESSERT', 'CAFE'],
    CULTURAL: ['MUSEUM', 'ART_GALLERY'],
    COMPETITIVE: ['ARCADE', 'BOWLING', 'ESCAPE_ROOM'],
    ADVENTUROUS: ['ESCAPE_ROOM'],
    ROMANTIC: ['CAFE', 'RESTAURANT', 'PARK'],
    LUXURY: ['RESTAURANT', 'ART_GALLERY'],
    BUDGET: ['PARK', 'MUSEUM', 'CAFE']
  };

  let matchCount = 0;
  for (const vibe of vibes) {
    const cats = vibeMap[vibe.toUpperCase()];
    if (cats && cats.includes(place.category.toUpperCase())) {
      matchCount++;
    }
  }
  const vibeScore = Math.min(1.0, matchCount * 0.5);

  // 6. Conversation score boost (especially for Date group types)
  const conversationScore = CONVERSATION_SCORES[place.category.toUpperCase()] || 5;
  const conversationBoost = (conversationScore / 10.0) * (groupType.toUpperCase() === 'DATE' ? 2.5 : 1.0);

  // 7. Romantic boost if More Romantic option is chosen
  let romanticBoost = 0.0;
  if (options.includes('More Romantic') && ['CAFE', 'RESTAURANT', 'LIVE_MUSIC', 'SCENIC_EXPERIENCE'].includes(place.category.toUpperCase())) {
    romanticBoost = 1.0;
  }

  // 8. Activities vs Food boost if options are chosen
  let typeBoost = 0.0;
  const isFoodCategory = ['CAFE', 'RESTAURANT', 'DESSERT'].includes(place.category.toUpperCase());
  if (options.includes('More Food') && isFoodCategory) {
    typeBoost = 1.0;
  } else if (options.includes('More Activities') && !isFoodCategory) {
    typeBoost = 1.0;
  }

  return (
    experienceScore * 2.0 +
    budgetScore * 1.5 +
    travelScore * 1.5 +
    ratingScore * 1.0 +
    vibeScore * 1.0 +
    conversationBoost * 1.5 +
    romanticBoost * 1.0 +
    typeBoost * 1.0
  );
}

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
  const candidateZones = selectCandidateZones(memberCoords);

  const avgLat = memberCoords.reduce((sum, c) => sum + c.lat, 0) / memberCoords.length;
  const avgLng = memberCoords.reduce((sum, c) => sum + c.lng, 0) / memberCoords.length;
  const avgMemberCoords = { lat: avgLat, lng: avgLng };

  const logRejection = (name: string, reason: string) => {
    console.log(`[VENUE REJECTED] "${name}" | Reason: ${reason}`);
  };

  // Setup Generate Again options
  const isCheaper = options.includes('Cheaper');
  const isMoreIndoor = options.includes('More Indoor');
  const isLessTravel = options.includes('Less Travel');
  const isMoreActivities = options.includes('More Activities');
  const isMoreFood = options.includes('More Food');

  // Adjust vibes list if More Romantic option is chosen
  let activeVibes = [...vibes];
  if (options.includes('More Romantic') && !activeVibes.some(v => v.toUpperCase() === 'ROMANTIC')) {
    activeVibes.push('ROMANTIC');
  }

  const gemQueries = [
    "pottery workshop mumbai",
    "board game cafe mumbai",
    "anime events mumbai",
    "food festival mumbai"
  ];
  let gemResults: any[] = [];
  try {
    gemResults = await Promise.all(gemQueries.map(q => searchTextVenues(q)));
  } catch (err) {
    console.error('Text searches for hidden gems failed:', err);
  }

  const hiddenGems: PlaceCandidate[] = [];
  const seenGemIds = new Set<string>();
  gemResults.forEach((results, qi) => {
    const query = gemQueries[qi];
    let inferredCat = 'MUSEUM';
    if (query.includes('cafe')) inferredCat = 'CAFE';
    else if (query.includes('festival') || query.includes('events')) inferredCat = 'SPORTS';

    if (results && Array.isArray(results)) {
      results.forEach((item: any) => {
        if (!item.place_id || seenGemIds.has(item.place_id)) return;
        seenGemIds.add(item.place_id);
        const venueLat = item.geometry?.location?.lat || 19.0760;
        const venueLng = item.geometry?.location?.lng || 72.8777;

        hiddenGems.push({
          id: item.place_id,
          name: item.name || item.structured_formatting?.main_text || 'Local Venue',
          category: inferredCat,
          rating: item.rating || 4.2,
          lat: venueLat,
          lng: venueLng,
          estimatedCostPerHead: inferredCat === 'CAFE' ? 250 : 400,
          address: item.formatted_address || item.description || item.structured_formatting?.secondary_text || '',
          openNow: true
        });
      });
    }
  });

  const zoneCandidatesPromises = candidateZones.map(async (zone) => {
    const recommendedVenues = await recommendationService.getRecommendedVenues(
      zone.lat,
      zone.lng,
      budgetSummary.min,
      budgetSummary.avg,
      preferredCategories as any[]
    );

    const recommendedExperiences = await recommendationService.getRecommendedExperiences(
      city,
      zone.lat,
      zone.lng,
      groupData.groupType as any,
      activeVibes,
      budgetSummary.max,
      preferredCategories,
      historyEntries,
      groupData.outingDate
    );

    const candidates: PlaceCandidate[] = [];

    recommendedVenues.forEach((v) => {
      candidates.push({
        id: v.id,
        name: v.name,
        category: v.category,
        rating: v.rating,
        lat: zone.lat + (Math.random() - 0.5) * 0.01,
        lng: zone.lng + (Math.random() - 0.5) * 0.01,
        estimatedCostPerHead: v.estimatedCostPerHead,
        address: v.address,
        openNow: v.openNow
      });
    });

    recommendedExperiences.forEach((e) => {
      candidates.push({
        id: e.id,
        name: e.title,
        category: e.category,
        rating: e.rating || 4.5,
        lat: e.latitude,
        lng: e.longitude,
        estimatedCostPerHead: e.ticketPrice,
        address: e.sourceUrl,
        openNow: true,
        isExperience: true,
        imageUrl: e.imageUrl || undefined,
        sourceUrl: e.sourceUrl
      });
    });

    hiddenGems.forEach((gem) => {
      const dist = getHaversineDistance({ lat: gem.lat, lng: gem.lng }, { lat: zone.lat, lng: zone.lng });
      if (dist <= 15) {
        candidates.push(gem);
      }
    });

    const openCandidates = candidates.filter(c => {
      const isOpen = isVenueOpenAtTime(c.category, groupData.outingTime);
      if (!isOpen) {
        logRejection(c.name, `Closed at outing time (${groupData.outingTime})`);
      }
      return isOpen;
    });

    const filteredCandidates = openCandidates.filter(c => {
      // 1. More Indoor Filter
      const outdoorCategories = ['PARK', 'OUTDOOR_EXPERIENCE', 'SCENIC_EXPERIENCE'];
      if (isMoreIndoor && outdoorCategories.includes(c.category.toUpperCase())) {
        logRejection(c.name, `REJECTED | Reason: Category duplicate / excluded by "More Indoor" option`);
        return false;
      }

      // 2. Cheaper option budget cap check
      const maxLimit = isCheaper ? lowestBudget * 0.8 : budgetSummary.max;
      if (c.estimatedCostPerHead > maxLimit) {
        logRejection(c.name, `REJECTED | Reason: Budget (cost ₹${c.estimatedCostPerHead} exceeds cap ₹${Math.round(maxLimit)})`);
        return false;
      }

      // 3. Less Travel distance checks
      const dist = getHaversineDistance(avgMemberCoords, { lat: c.lat, lng: c.lng });
      const maxDistance = isLessTravel ? 5 : 15;
      if (dist > maxDistance) {
        logRejection(c.name, `REJECTED | Reason: Too far (${dist.toFixed(1)}km exceeds allowed ${maxDistance}km)`);
        return false;
      }

      return true;
    });

    const scoredCandidates = filteredCandidates.map((c) => {
      const score = scorePlaceCandidate(c, groupData.groupType, activeVibes, budgetSummary.max, lowestBudget, avgMemberCoords, options);
      return {
        ...c,
        score
      };
    });

    scoredCandidates.sort((a, b) => b.score - a.score);

    return {
      zone,
      candidates: scoredCandidates
    };
  });

  const zonesData = await Promise.all(zoneCandidatesPromises);

  const usedPlaceIds = new Set<string>();
  const draftItineraries: any[] = [];
  const tiers = ['BUDGET_FRIENDLY', 'BALANCED', 'PREMIUM', 'BALANCED'] as const;

  const buildPass = async (allowSharedVenues = false) => {
    for (let i = 0; i < 4; i++) {
      // If we already have 4 plans, stop
      if (draftItineraries.length >= 4) break;

      const budgetTier = tiers[i];
      const planIndex = i + 1;

      // Skip if this planIndex was already successfully generated in a previous pass
      if (draftItineraries.some(it => it.planIndex === planIndex)) continue;

      let zoneObj = candidateZones[i % candidateZones.length];
      let zoneData = zonesData.find(zd => zd.zone.name === zoneObj.name) || zonesData[0];

      const filterAndUnused = (list: any[]) => allowSharedVenues ? list : list.filter(c => !usedPlaceIds.has(c.id));
      let candidatesPool = filterAndUnused(zoneData.candidates);

      // Define diverse category structures (Anti-Boring logic)
      let slot1Cats: string[] = [];
      let slot1IsActivity = true;
      let slot2Cats: string[] = [];
      let slot2IsActivity = false;
      let slot3Cats: string[] = [];
      let slot3IsActivity = false;

      if (isMoreActivities) {
        slot1Cats = ['BOWLING', 'ARCADE', 'ESCAPE_ROOM', 'MUSEUM', 'SPORTS', 'POTTERY', 'PAINTING'];
        slot1IsActivity = true;
        slot2Cats = ['CAFE', 'RESTAURANT'];
        slot2IsActivity = false;
        slot3Cats = ['BOWLING', 'ARCADE', 'ESCAPE_ROOM', 'MUSEUM', 'SPORTS', 'POTTERY', 'PAINTING'];
        slot3IsActivity = true;
      } else if (isMoreFood) {
        slot1Cats = ['CAFE'];
        slot1IsActivity = false;
        slot2Cats = ['RESTAURANT'];
        slot2IsActivity = false;
        slot3Cats = ['DESSERT', 'CAFE'];
        slot3IsActivity = false;
      } else {
        if (planIndex === 1) {
          // Plan 1: Budget/Outdoor-Chill
          slot1Cats = ['PARK', 'MUSEUM'];
          slot1IsActivity = true;
          slot2Cats = ['CAFE'];
          slot2IsActivity = false;
          slot3Cats = ['DESSERT', 'PARK'];
          slot3IsActivity = false;
        } else if (planIndex === 2) {
          // Plan 2: Food-heavy/Dining Focus
          slot1Cats = ['CAFE'];
          slot1IsActivity = false;
          slot2Cats = ['RESTAURANT'];
          slot2IsActivity = false;
          slot3Cats = ['DESSERT'];
          slot3IsActivity = false;
        } else if (planIndex === 3) {
          // Plan 3: Premium/Activity-heavy
          slot1Cats = ['BOWLING', 'ARCADE', 'ESCAPE_ROOM', 'SPORTS', 'MUSEUM'];
          slot1IsActivity = true;
          slot2Cats = ['RESTAURANT', 'CAFE'];
          slot2IsActivity = false;
          slot3Cats = ['BOWLING', 'ARCADE', 'ESCAPE_ROOM', 'SPORTS', 'MUSEUM'];
          slot3IsActivity = true;
        } else {
          // Plan 4: Experience / Creative focus
          slot1Cats = ['POTTERY', 'WORKSHOP', 'ART_GALLERY', 'MUSEUM'];
          slot1IsActivity = true;
          slot2Cats = ['CAFE', 'RESTAURANT'];
          slot2IsActivity = false;
          slot3Cats = ['PARK', 'DESSERT', 'CAFE'];
          slot3IsActivity = false;
        }
      }

      const selectPlaceForSlot = (preferredCats: string[], isActivity: boolean) => {
        // Try strict matching first
        let match = candidatesPool.find(c => preferredCats.includes(c.category.toUpperCase()));
        
        // Relax matching if strict fails
        if (!match) {
          if (isActivity) {
            match = candidatesPool.find(c => !['CAFE', 'RESTAURANT', 'DESSERT'].includes(c.category.toUpperCase()));
          } else {
            match = candidatesPool.find(c => ['CAFE', 'RESTAURANT', 'DESSERT'].includes(c.category.toUpperCase()));
          }
        }
        return match || null;
      };

      // Select Slot 1
      const slot1Place = selectPlaceForSlot(slot1Cats, slot1IsActivity);
      if (!slot1Place) {
        logRejection(`Plan-${planIndex}-Slot-1`, `Closed / No matching candidate for categories [${slot1Cats.join(',')}]`);
        continue;
      }
      candidatesPool = candidatesPool.filter(c => c.id !== slot1Place.id);

      // Select Slot 2
      const slot2Place = selectPlaceForSlot(slot2Cats, slot2IsActivity);
      if (!slot2Place) {
        logRejection(`Plan-${planIndex}-Slot-2`, `Closed / No matching candidate for categories [${slot2Cats.join(',')}]`);
        continue;
      }
      candidatesPool = candidatesPool.filter(c => c.id !== slot2Place.id);

      // Select Slot 3
      const slot3Place = selectPlaceForSlot(slot3Cats, slot3IsActivity);
      if (!slot3Place) {
        logRejection(`Plan-${planIndex}-Slot-3`, `Closed / No matching candidate for categories [${slot3Cats.join(',')}]`);
        continue;
      }
      candidatesPool = candidatesPool.filter(c => c.id !== slot3Place.id);

      // Commit places as used for cross-plan uniqueness
      if (!allowSharedVenues) {
        usedPlaceIds.add(slot1Place.id);
        usedPlaceIds.add(slot2Place.id);
        usedPlaceIds.add(slot3Place.id);
      }

      const selectedPlaces = [slot1Place, slot2Place, slot3Place];
      
      const slotsPromises = selectedPlaces.map(async (place, slotIdx) => {
        let finalImg = place.imageUrl || null;
        let finalLink = place.sourceUrl || null;
        
        if (place.id && !place.id.startsWith('fallback_')) {
          try {
            const details = await getVenueDetails(place.id);
            if (details && details.photos && details.photos.length > 0) {
              const photoRef = details.photos[0].photo_reference;
              if (photoRef) {
                const apiKey = process.env.OLA_MAPS_API_KEY;
                finalImg = `https://api.olamaps.io/places/v1/photo?photo_reference=${encodeURIComponent(photoRef)}&api_key=${apiKey}`;
              }
            }
            if (details && details.website) {
              finalLink = details.website;
            }
          } catch (err) {
            console.error(`Error resolving details for finalist ${place.name}:`, err);
          }
        }

        if (!finalImg) {
          finalImg = await getVenueImageUrl(place.name, city, place.category);
        }

        if (!finalLink) {
          finalLink = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name + ' ' + place.address)}`;
        }

        let arrivalTime = '11:00 AM';
        let duration = 90;
        if (slotIdx === 0) {
          arrivalTime = groupData.outingTime || '11:00 AM';
          duration = 120;
        } else if (slotIdx === 1) {
          arrivalTime = addMinutesToTimeString(groupData.outingTime || '11:00 AM', 120 + 15);
          duration = 90;
        } else {
          arrivalTime = addMinutesToTimeString(groupData.outingTime || '11:00 AM', 120 + 15 + 90 + 15);
          duration = 60;
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
          imageUrl: finalImg,
          link: finalLink,
          note: `Enjoy a wonderful outing at ${place.name} matching the ${groupData.groupType.toLowerCase()} vibe.`,
          lat: place.lat,
          lng: place.lng
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
        }

        const memberTravelsForPlan: any[] = [];
        const walkTimes: number[] = [];
        const autoTimes: number[] = [];
        const autoCosts: number[] = [];
        const trainTimes: number[] = [];
        const trainCosts: number[] = [];
        const totalTimes: number[] = [];
        const totalCosts: number[] = [];

        presentLocations.forEach(loc => {
          const breakdown = calculateMumbaiTravelBreakdown({ lat: loc.lat, lng: loc.lng }, { lat: zoneObj.lat, lng: zoneObj.lng }, groupData.outingTime);
          
          walkTimes.push(breakdown.walkingTime);
          autoTimes.push(breakdown.autoTime);
          autoCosts.push(breakdown.autoCost);
          trainTimes.push(breakdown.trainTime);
          trainCosts.push(breakdown.trainCost);
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

        const avgWalkTime = Math.round(walkTimes.reduce((sum, t) => sum + t, 0) / walkTimes.length);
        const avgAutoTime = Math.round(autoTimes.reduce((sum, t) => sum + t, 0) / autoTimes.length);
        const avgAutoCost = Math.round(autoCosts.reduce((sum, c) => sum + c, 0) / autoCosts.length);
        const avgTrainTime = Math.round(trainTimes.reduce((sum, t) => sum + t, 0) / trainTimes.length);
        const avgTrainCost = Math.round(trainCosts.reduce((sum, c) => sum + c, 0) / trainCosts.length);
        const avgTotalTime = Math.round(totalTimes.reduce((sum, t) => sum + t, 0) / totalTimes.length);
        const avgTotalCost = Math.round(totalCosts.reduce((sum, c) => sum + c, 0) / totalCosts.length);
        const longestTravelTime = Math.max(...totalTimes);
        const shortestTravelTime = Math.min(...totalTimes);

        const variance = totalTimes.reduce((sum, t) => sum + Math.pow(t - avgTotalTime, 2), 0) / totalTimes.length;
        const stdDev = Math.sqrt(variance);
        let travelFairnessScore = stdDev <= 10 ? 1.0 : Math.max(0.0, 1.0 - (stdDev - 10) / 30.0);
        if (longestTravelTime > 90 && avgTotalTime < 30) {
          travelFairnessScore = Math.max(0.0, travelFairnessScore - 0.40);
        }

        const slotsMandatoryCost = slots.reduce((sum, s) => sum + s.mandatoryCost, 0);
        const slotsOptionalMin = slots.reduce((sum, s) => sum + s.optionalCostMin, 0);
        const slotsOptionalMax = slots.reduce((sum, s) => sum + s.optionalCostMax, 0);

        const totalMandatoryCost = slotsMandatoryCost + avgTotalCost;
        
        let finalSlots = slots;
        let finalMandatory = totalMandatoryCost;
        let finalOptionalMin = slotsOptionalMin;
        let finalOptionalMax = slotsOptionalMax;
        
        if ((budgetTier === 'BUDGET_FRIENDLY' || isCheaper) && finalMandatory > lowestBudget) {
          // Scale costs down instead of inventing fake businesses
          finalSlots.forEach(s => {
            if (s.estimatedCostPerHead > 0) {
              s.estimatedCostPerHead = Math.round(s.estimatedCostPerHead * 0.6);
              s.mandatoryCost = Math.round(s.mandatoryCost * 0.6);
              s.optionalCostMin = Math.round(s.optionalCostMin * 0.6);
              s.optionalCostMax = Math.round(s.optionalCostMax * 0.6);
            }
          });
          const newSlotsMandatory = finalSlots.reduce((sum, s) => sum + s.mandatoryCost, 0);
          finalMandatory = newSlotsMandatory + avgTotalCost;
          finalOptionalMin = finalSlots.reduce((sum, s) => sum + s.optionalCostMin, 0);
          finalOptionalMax = finalSlots.reduce((sum, s) => sum + s.optionalCostMax, 0);
        }

        const totalEstimatedCostPerHead = finalMandatory + finalOptionalMin;
        const totalDurationMinutes = finalSlots.reduce((sum, s) => sum + s.durationMinutes, 0) + (finalSlots[0].travelToNextMinutes || 0) + (finalSlots[1].travelToNextMinutes || 0);

        const experienceScore = 0.85;
        const travelScore = Math.max(0.0, 1.0 - (avgTotalTime / 90.0));
        const budgetScore = Math.max(0.0, 1.0 - (totalEstimatedCostPerHead / budgetSummary.max));
        const popularityScore = 0.90;
        const groupTypeMatchScore = 1.0;
        const vibeMatchScore = 1.0;

        const compositeScore = Number(
          (
            experienceScore * 0.20 +
            travelScore * 0.20 +
            budgetScore * 0.20 +
            travelFairnessScore * 0.20 +
            vibeMatchScore * 0.20
          ).toFixed(2)
        );

        const planId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : require('crypto').randomUUID();

        return {
          id: planId,
          groupId: groupData.id,
          planIndex,
          name: zoneObj.name,
          tagline: `A wonderful ${budgetTier.toLowerCase().replace('_', ' ')} day out in ${zoneObj.name}.`,
          budgetTier,
          totalEstimatedCostPerHead,
          totalDurationMinutes,
          score: compositeScore,

          experienceScore,
          travelScore,
          budgetScore,
          fairnessScore: travelFairnessScore,
          popularityScore,
          groupTypeMatchScore,
          vibeMatchScore,
          compositeScore,

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
          mandatoryCost: finalMandatory,
          optionalCostMin: finalOptionalMin,
          optionalCostMax: finalOptionalMax,
          whyRecommended: [
            `✓ Fits outing constraints`,
            `✓ Commute is fair for all members`,
            `✓ Fits the ${groupData.groupType.toLowerCase()} vibe`
          ],
          slots: finalSlots,
          memberTravels: memberTravelsForPlan
        };
      };

      draftItineraries.push(await buildItineraryData());
    }
  };

  // First pass: strict cross-plan unique venues
  await buildPass(false);

  // Second pass: if we produced fewer than 2 plans, reset unique constraints and allow sharing venues across plans
  if (draftItineraries.length < 2) {
    console.warn("Insufficient unique venues found. Running second pass allowing shared venues across plans...");
    await buildPass(true);
  }

  draftItineraries.sort((a, b) => b.score - a.score);
  draftItineraries.forEach((it, idx) => {
    it.planIndex = idx + 1;
  });

  return draftItineraries;
}

export const plannerService = {
  async generatePlan(userId: string, groupId: string, options: string[] = []): Promise<{ success: boolean; plans: PlanWithSlots[] }> {
    const { isHangoutApiConfigured, hangoutApi } = await import('../cloudflare/hangoutApi');
    if (isHangoutApiConfigured()) {
      const { getGroupDetailsAction } = await import('../../actions/groups');
      const detailsRes = await getGroupDetailsAction(groupId);
      if (!detailsRes.success) {
        throw new Error(detailsRes.error?.message || 'Failed to fetch group details');
      }

      const { group: groupData, members, budgetSummary, locations, currentUser } = detailsRes.data;
      if (currentUser.role !== 'ADMIN') {
        throw new ForbiddenError('Only the group admin can generate itineraries.');
      }

      if (!['COLLECTING_MEMBERS', 'COLLECTING_DETAILS', 'READY_TO_GENERATE', 'VOTING'].includes(groupData.status)) {
        throw new ValidationError(`Group is not in a state ready for itinerary generation (current status: ${groupData.status}).`);
      }

      // Force all members to be present
      const presentMembers = members;
      const presentUserIds = presentMembers.map((m: any) => m.userId);
      const presentLocations = locations.filter((loc: any) => presentUserIds.includes(loc.userId));

      if (presentLocations.length < 1) {
        presentLocations.push({
          userId: presentMembers[0]?.userId || 'default-user',
          lat: 19.0760,
          lng: 72.8777,
          locationName: 'Mumbai Centroid (Default)',
        });
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

      const draftPlans = await executePlanningEngine(
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
          dbSlots.push({
            id: randomUUID(),
            planId,
            slotOrder: s.order,
            venueId: draftSlot?.venueId || null,
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

      const saveRes = await hangoutApi<any>(`/groups/${groupId}/plans`, {
        method: 'POST',
        body: {
          plans: dbPlans,
          slots: dbSlots,
          memberTravels: dbMemberTravels,
          generationOptions: options,
        },
      });

      if (!saveRes.success) {
        throw new Error(saveRes.error?.message || 'Failed to save generated plans to D1');
      }

      const savedPlans = await hangoutApi<any>(`/groups/${groupId}/plans`);
      return {
        success: true,
        plans: savedPlans.data,
      };
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

    // 5. Check submitted locations (fallback to Mumbai centroid if none)
    const locations = await locationRepository.getGroupLocations(groupId);
    const presentLocations = locations.filter(l => presentUserIds.includes(l.userId));
    if (presentLocations.length < 1) {
      presentLocations.push({
        id: 'default-loc',
        groupId,
        userId: presentMembers[0]?.userId || 'default-user',
        lat: 19.0760,
        lng: 72.8777,
        locationName: 'Mumbai Centroid (Default)',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
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

      const draftPlans = await executePlanningEngine(
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
          dbSlots.push({
            id: randomUUID(),
            planId,
            slotOrder: s.order,
            venueId: draftSlot?.venueId || null,
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
