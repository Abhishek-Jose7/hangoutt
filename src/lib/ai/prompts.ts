import type { Mood, ItineraryProfile } from '@/types';

function profileBrief(profile: ItineraryProfile): string {
  switch (profile) {
    case 'chill_walk':
      return 'Chill plan: cafe + relaxed walk/outdoor + easy food stop.';
    case 'activity_food':
      return 'Activity plan: one strong named activity + one good food stop.';
    case 'premium_dining':
      return 'Premium plan: upscale dining-led experience with polished pacing.';
    case 'budget_bites':
      return 'Budget plan: low-cost but high-value hangout with simple logistics.';
    default:
      return 'Balanced plan with diverse stop types.';
  }
}

export function buildItineraryPrompt(params: {
  hubName: string;
  hubStation: string;
  memberCount: number;
  mood: Mood;
  profile: ItineraryProfile;
  perPersonCap: number;
  startTime: string;
  endTime: string;
  candidates: string;
}): string {
  return `You are a Mumbai hangout planner. Return ONLY valid JSON. No prose, no markdown, no explanation.

Hub area: ${params.hubName}, Mumbai
Group: ${params.memberCount} people
Mood: ${params.mood}
Option style: ${params.profile} (${profileBrief(params.profile)})
Budget: ₹${params.perPersonCap} per person
Available time: ${params.startTime} to ${params.endTime}
Primary transport: Mumbai local train (nearest station: ${params.hubStation})

Candidate places near ${params.hubName} (pre-scored):
${params.candidates}

Create a 3-stop itinerary starting from ${params.hubStation} area.

Constraints:
- Total estimated cost per person ≤ ₹${params.perPersonCap} (exclude train fare)
- No two consecutive stops of same type
- Build a logical time-energy-cost arc: engaging opener -> change of pace -> relaxed/social closer
- First stop within 10 min walk of ${params.hubStation}
- Gaps between stops must allow for walking time (estimate 10–15 min between stops in same area)
- Include realistic distance from station/previous stop for each stop
- Keep travel practical for the group by staying around this balanced hub area
- Reflect the "${params.mood}" vibe in all choices
- Choose only specific, real venues/activities from the candidate list (no generic recommendations)
- If a candidate name looks like a search result, article title, listicle, or page title, ignore it and use a real venue/activity instead
- Do NOT output listicle or website titles like "Top places", "Things to do", "... in Mumbai", "Justdial", "Wanderlog", "Tripadvisor", "Best cafes", "Top lounges"
- No links, no URLs, and no page titles. Each stop must be a venue or activity people can actually do on the day.
- Estimated cost should be realistic for that venue type and local Mumbai pricing. Do not inflate prices.
- If one high-rated activity is expensive, prefer cheaper food stops (e.g., quick-service options) to keep total budget practical.
- Use activity search intent and eatery search intent separately when choosing stops: activities/events must be specific, eateries must be specific cafes/restaurants.
- Prefer top-rated venues that still fit budget and mood.
- Keep stop names as exact real venue/activity names, never source pages.
- This option must be clearly distinct in style from other options by following the Option style above.
- Do not stack similar experiences (forbidden pattern examples: cafe -> restaurant -> dessert, cafe -> dessert -> cafe).
- Prefer diverse sequencing examples like: cafe -> walk/activity -> light food/dessert OR activity -> food -> chill add-on.
- Mood flow examples (adapt dynamically, not rigid):
  - romantic: stylish lunch or cafe, then experience/dessert/ice-cream, then cozy evening stop
  - adventure: action activity (e.g. trampoline/bowling/escape room), then budget-friendly meal, then optional short add-on
  - chill: slow cafe + relaxed activity + easy dinner/walk
  - fun: social activity/event + lively meal + dessert or quick hangout

Return exactly this JSON structure:
{
  "stops": [
    {
      "stop_number": 1,
      "place_name": "...",
      "place_type": "cafe|activity|restaurant|outdoor",
      "start_time": "11:00",
      "duration_mins": 90,
      "estimated_cost_per_person": 250,
      "walk_from_previous_mins": 10,
      "distance_from_previous_km": 0.8,
      "vibe_note": "one sentence — why this fits ${params.mood} energy"
    }
  ],
  "total_cost_per_person": 700,
  "contingency_buffer": 105,
  "day_summary": "one punchy sentence describing the day",
  "short_title": "5-7 word option title",
  "area": "hub area name",
  "vibe_tags": ["cozy", "walkable", "foodie"],
  "flow_summary": "Actual stop names in sequence with simple transitions"
}`;
}

export const RETRY_SUFFIX =
  'RESPOND WITH ONLY THE JSON OBJECT. Start your response with { and end with }. No other characters.';
