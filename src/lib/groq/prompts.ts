import { ItineraryPromptContext } from '../types/planner.types';

export const ITINERARY_SYSTEM_PROMPT = `
You are a group outing planner. Given a list of available venues and group context, 
generate exactly 3 or 4 distinct itinerary plans.

STRICT RULES:
- Return ONLY valid JSON. No preamble, no markdown, no explanation.
- Generate 3 or 4 itineraries (never fewer than 3).
- Each itinerary must have 3 to 5 venue slots.
- Each itinerary must include at least one meal slot (category CAFE or RESTAURANT).
- No venue may appear in more than one itinerary.
- Total estimated cost per head must not exceed the groupAvgBudget.
- Each itinerary must have a unique name (2–4 words) and a tagline (one sentence, max 12 words).
- Slot arrival times must be realistic (start from 11:00 AM by default unless specified).
- Include at least 15 minutes travel buffer between consecutive venue slots.
- The "note" field for each slot must be specific and helpful — why this venue, what to order or do.
- Itineraries must differ meaningfully in vibe, category mix, or price point.
- If groupType is DATE: romantic or intimate tone, max 2 people in mind.
- If groupType is FAMILY: family-friendly venues, avoid late-night venues.
- If groupType is WORK: professional tone, suitable for colleagues.

REQUIRED JSON STRUCTURE:
{
  "itineraries": [
    {
      "id": "plan_1",
      "name": "Short Catchy Name",
      "tagline": "One sentence describing the vibe.",
      "totalEstimatedCostPerHead": 450,
      "totalDurationMinutes": 240,
      "slots": [
        {
          "order": 1,
          "venueId": "venue_id_from_input",
          "venueName": "Venue Name",
          "category": "CAFE",
          "arrivalTime": "11:00 AM",
          "durationMinutes": 60,
          "travelToNextMinutes": 15,
          "estimatedCostPerHead": 200,
          "note": "Specific note about this venue and why it fits here."
        }
      ]
    }
  ]
}
`.trim();

export function buildItineraryPrompt(context: ItineraryPromptContext): string {
  return JSON.stringify({
    groupContext: {
      groupName: context.groupName,
      groupType: context.groupType,
      memberCount: context.memberCount,
      groupMinBudget: context.groupMinBudget,
      groupAvgBudget: context.groupAvgBudget,
      preferredCategories: context.preferredCategories,
      midpointAddress: context.midpointAddress,
    },
    availableVenues: context.venues.map(v => ({
      id: v.id,
      name: v.name,
      category: v.category,
      rating: v.rating,
      distanceFromMidpoint: `${v.distanceKm.toFixed(1)} km`,
      estimatedCostPerHead: v.estimatedCostPerHead,
      openNow: v.openNow,
      address: v.address,
    })),
  }, null, 2);
}
