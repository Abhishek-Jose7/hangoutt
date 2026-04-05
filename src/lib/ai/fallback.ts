import type { AIItineraryResponse, Place } from '@/types';

/**
 * Rule-based fallback when Claude fails to generate a valid itinerary
 */
export function buildFallbackItinerary(
  places: Place[],
  perPersonCap: number
): AIItineraryResponse {
  // Sort places by typical time-of-day: café → activity → restaurant → outdoor
  const typeOrder: Record<string, number> = {
    cafe: 0,
    outdoor: 1,
    activity: 2,
    restaurant: 3,
  };

  const sorted = [...places].sort(
    (a, b) => (typeOrder[a.type] ?? 2) - (typeOrder[b.type] ?? 2)
  );

  // Pick top 3, one per type if possible
  const selectedTypes = new Set<string>();
  const selected: Place[] = [];

  for (const place of sorted) {
    if (selected.length >= 3) break;
    if (!selectedTypes.has(place.type)) {
      selectedTypes.add(place.type);
      selected.push(place);
    }
  }

  // Fill remaining if less than 3
  if (selected.length < 3) {
    for (const place of sorted) {
      if (selected.length >= 3) break;
      if (!selected.includes(place)) {
        selected.push(place);
      }
    }
  }

  const costPerStop = Math.round(perPersonCap / Math.max(selected.length, 1));
  const timeSlots = ['11:00', '13:30', '16:00'];

  const stops = selected.map((place, i) => ({
    stop_number: i + 1,
    place_name: place.name,
    place_type: place.type,
    start_time: timeSlots[i] || `${11 + i * 2}:00`,
    duration_mins: i === selected.length - 1 ? 120 : 90,
    estimated_cost_per_person: Math.min(
      place.estimated_cost || costPerStop,
      costPerStop
    ),
    walk_from_previous_mins: i === 0 ? 10 : 15,
    vibe_note: place.description.slice(0, 80),
  }));

  const totalCost = stops.reduce((sum, s) => sum + s.estimated_cost_per_person, 0);

  return {
    stops,
    total_cost_per_person: totalCost,
    contingency_buffer: Math.round(totalCost * 0.15),
    day_summary: `A ${selected.length}-stop hangout near the station area`,
  };
}
