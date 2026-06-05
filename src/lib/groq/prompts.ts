import { ItineraryPromptContext } from '../types/planner.types';

export const ITINERARY_SYSTEM_PROMPT = `
You are an expert experience planner. Given a list of local experiences (including FREE_EXPERIENCE listings), available venues, and group context, generate exactly 3 or 4 distinct itinerary plans.

STRICT ITINERARY FORMAT RULES:
- Return ONLY valid JSON. No preamble, no markdown, no explanation.
- Generate 3 or 4 itineraries (never fewer than 3).
- Each itinerary must have 2 to 4 slots.
- Every itinerary must be built around a Primary Experience (category like CONCERT, WORKSHOP, EXHIBITION, FREE_EXPERIENCE, etc.).
- Follow a narrative story-driven flow:
  Primary Experience -> Complementary Dining (category CAFE or RESTAURANT) -> Optional Secondary Activity/Scenic Walk.
- Budget Tiering: Each itinerary must be assigned to one of the following budget tiers and marked in the "budgetTier" field:
  * BUDGET_FRIENDLY: Total cost per head <= groupMinBudget.
  * BALANCED: Total cost per head <= groupAvgBudget.
  * PREMIUM: Total cost per head <= groupMaxBudget.
  * You must generate at least one itinerary in each tier.
- No experience or venue may appear in more than one itinerary.
- Each itinerary must have a unique name (2–4 words) and a tagline (one sentence, max 12 words) that describes its character and vibe.
- Slot arrival times must be realistic. Start at 11:00 AM by default unless the event time dictates otherwise.
- Include at least 15 minutes travel buffer between consecutive slots.
- The "note" field for each slot must be specific and helpful — why this fits the group type and vibe, what to order or do.
- If groupType is DATE: customize for a couple with a romantic/intimate tone. Factor in the vibe (e.g., ROMANTIC, CREATIVE) and prioritize experiences that foster High Conversation Quality (e.g. workshops, pottery, galleries, or museum tours). Avoid silent movie/concert slots unless specifically fitting the vibe.
- If groupType is FAMILY: prioritize family-friendly venues and events, avoiding late-night slots.
- If groupType is WORK: use a professional, collaborative team-building tone.

REQUIRED JSON STRUCTURE:
{
  "itineraries": [
    {
      "id": "plan_1",
      "name": "Creative Spark & Coffee",
      "tagline": "Dabble in clay before unwinding at a cozy local cafe.",
      "budgetTier": "BUDGET_FRIENDLY",
      "totalEstimatedCostPerHead": 370,
      "totalDurationMinutes": 180,
      "slots": [
        {
          "order": 1,
          "experienceId": "exp_pottery_1",
          "venueId": null,
          "name": "Clay Studio Pottery Workshop",
          "category": "POTTERY",
          "arrivalTime": "02:00 PM",
          "durationMinutes": 90,
          "travelToNextMinutes": 15,
          "estimatedCostPerHead": 250,
          "note": "A hands-on clay pottery session to get your creative juices flowing together."
        },
        {
          "order": 2,
          "experienceId": null,
          "venueId": "venue_cafe_1",
          "name": "Indiranagar Coffee Roasters",
          "category": "CAFE",
          "arrivalTime": "03:45 PM",
          "durationMinutes": 60,
          "travelToNextMinutes": null,
          "estimatedCostPerHead": 120,
          "note": "Relax after the workshop and discuss your clay pieces over custom pour-overs."
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
      vibes: context.vibes,
      memberCount: context.memberCount,
      groupMinBudget: context.groupMinBudget,
      groupAvgBudget: context.groupAvgBudget,
      groupMaxBudget: context.groupMaxBudget,
      preferredCategories: context.preferredCategories,
      midpointAddress: context.midpointAddress,
    },
    availableExperiences: context.experiences.map(e => ({
      id: e.id,
      title: e.title,
      category: e.category,
      ticketPrice: e.ticketPrice,
      rating: e.rating,
      distanceFromMidpoint: `${e.distanceKm.toFixed(1)} km`,
      address: e.sourceUrl, // using sourceUrl as display address fallback
    })),
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
