import type { AIItineraryResponse, Mood, Place } from '@/types';

/**
 * Rule-based fallback when Claude fails to generate a valid itinerary
 */
export function buildFallbackItinerary(
  places: Place[],
  perPersonCap: number,
  mood: Mood
): AIItineraryResponse {
  const moodPattern: Record<Mood, Array<Place['type']>> = {
    romantic: ['restaurant', 'activity', 'outdoor'],
    adventure: ['activity', 'restaurant', 'outdoor'],
    chill: ['cafe', 'activity', 'outdoor'],
    fun: ['activity', 'restaurant', 'outdoor'],
  };

  const desired = moodPattern[mood];
  const selected: Place[] = [];
  const used = new Set<string>();

  for (const preferredType of desired) {
    const pick = places.find((p) => p.type === preferredType && !used.has(p.name))
      || (preferredType === 'restaurant' || preferredType === 'cafe'
        ? places.find((p) => (p.type === 'restaurant' || p.type === 'cafe') && !used.has(p.name))
        : null)
      || places.find((p) => !used.has(p.name));

    if (pick) {
      selected.push(pick);
      used.add(pick.name);
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
    estimated_cost_per_person:
      place.estimated_cost !== undefined
        ? Math.min(place.estimated_cost, costPerStop)
        : 0,
    walk_from_previous_mins: i === 0 ? 10 : 15,
    distance_from_previous_km: i === 0 ? 0.8 : 1.1,
    vibe_note: place.description.slice(0, 80),
  }));

  const totalCost = stops.reduce((sum, s) => sum + s.estimated_cost_per_person, 0);

  return {
    stops,
    total_cost_per_person: totalCost,
    contingency_buffer: Math.round(totalCost * 0.15),
    day_summary: `A ${mood}-leaning ${selected.length}-stop hangout built around specific local venues`,
  };
}
