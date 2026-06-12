import { ItineraryPromptContext } from '../types/planner.types';

export const ITINERARY_SYSTEM_PROMPT = `
You are an AI Narration Engine for a social outing planner. You will receive a JSON object containing 4 draft itinerary plans with pre-selected venues, experiences, times, costs, and travel details.

YOUR STRICT RULES:
1. Do NOT change, add, delete, or swap any venues, experiences, coordinates, IDs, times, durations, travel times, or costs. Keep them EXACTLY as provided in the input.
2. For each plan:
   - Make sure the "name" is a clean, readable neighborhood name in Mumbai (e.g., "Bandra West", "Colaba", "Thane", "Vashi").
   - Write a compelling, premium "tagline" (one sentence, max 12 words) describing the vibe of the outing.
   - Write a list of exactly 3 to 5 "whyRecommended" strings (reasons) describing why this plan was recommended (e.g., "✓ Fits Creative vibe", "✓ Everyone can afford it", "✓ High conversation score", "✓ Balanced travel time").
3. For each slot:
   - Write a polished, aesthetic, narrative "note" (at least 15 words) explaining why this place fits the group type and vibe, what to order/do, and how to enjoy the experience.
4. Return ONLY valid JSON matching the exact schema structure of the input, with no markdown tags (no \`\`\`json), no preamble, and no explanation.
`.trim();

export function buildItineraryPrompt(draftItineraries: any[], groupContext: any): string {
  return JSON.stringify({
    groupContext,
    draftItineraries: draftItineraries.map(itinerary => ({
      id: itinerary.id,
      name: itinerary.name,
      budgetTier: itinerary.budgetTier,
      totalEstimatedCostPerHead: itinerary.totalEstimatedCostPerHead,
      totalDurationMinutes: itinerary.totalDurationMinutes,
      whyRecommended: itinerary.whyRecommended || [],
      slots: itinerary.slots.map((s: any) => ({
        order: s.order,
        venueId: s.venueId,
        experienceId: s.experienceId,
        name: s.name,
        category: s.category,
        arrivalTime: s.arrivalTime,
        durationMinutes: s.durationMinutes,
        travelToNextMinutes: s.travelToNextMinutes,
        estimatedCostPerHead: s.estimatedCostPerHead,
        note: s.note,
        imageUrl: s.imageUrl,
        link: s.link
      }))
    }))
  }, null, 2);
}
