import 'server-only';
import { groqClient } from './client';
import { ITINERARY_SYSTEM_PROMPT, buildItineraryPrompt } from './prompts';
import { itineraryResponseSchema, ItineraryResponse } from '../validators/itinerary.schema';
import { ItineraryPromptContext } from '../types/planner.types';
import {
  GroqTimeoutError,
  GroqParseError,
  GroqInvalidSchemaError,
  GroqRateLimitedError,
  GroqUnavailableError,
  GroqMisconfiguredError,
} from '../errors';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function isRetryable(err: unknown): boolean {
  if (err instanceof SyntaxError) return true; // malformed JSON
  if (err instanceof Error && err.message.includes('429')) return true; // rate limit
  if (err instanceof Error && err.message.includes('timeout')) return true;
  return false;
}

function generateMockItineraries(context: ItineraryPromptContext): ItineraryResponse {
  const itineraries: any[] = [];
  const tiers = ['BUDGET_FRIENDLY', 'BALANCED', 'PREMIUM'] as const;

  const getCategoryImage = (cat: string) => {
    switch (cat) {
      case 'CAFE': return 'https://placehold.co/600x400/0f0f0f/DC143C.png?text=CAFE';
      case 'RESTAURANT': return 'https://placehold.co/600x400/0f0f0f/DC143C.png?text=RESTAURANT';
      case 'DESSERT': return 'https://placehold.co/600x400/0f0f0f/DC143C.png?text=DESSERT';
      case 'PARK': return 'https://placehold.co/600x400/0f0f0f/DC143C.png?text=PARK';
      case 'ARCADE': return 'https://placehold.co/600x400/0f0f0f/DC143C.png?text=ARCADE';
      case 'BOWLING': return 'https://placehold.co/600x400/0f0f0f/DC143C.png?text=BOWLING';
      case 'ESCAPE_ROOM': return 'https://placehold.co/600x400/0f0f0f/DC143C.png?text=ESCAPE_ROOM';
      case 'POTTERY': return 'https://placehold.co/600x400/0f0f0f/DC143C.png?text=POTTERY';
      case 'LIVE_MUSIC': return 'https://placehold.co/600x400/0f0f0f/DC143C.png?text=LIVE_MUSIC';
      default: return 'https://placehold.co/600x400/0f0f0f/DC143C.png?text=OUTING';
    }
  };

  const usedVenueIds = new Set<string>();
  const usedExperienceIds = new Set<string>();

  const getUnusedVenue = (categories: string[], maxCost: number): any | null => {
    const found = context.venues.find(v => 
      categories.includes(v.category) && 
      !usedVenueIds.has(v.id) && 
      v.estimatedCostPerHead <= maxCost
    );
    if (found) {
      usedVenueIds.add(found.id);
    }
    return found || null;
  };

  const getUnusedExperience = (maxCost: number): any | null => {
    const found = context.experiences.find(e => 
      !usedExperienceIds.has(e.id) && 
      e.ticketPrice <= maxCost
    );
    if (found) {
      usedExperienceIds.add(found.id);
    }
    return found || null;
  };

  for (let i = 0; i < 3; i++) {
    const tier = tiers[i];
    const planId = `plan_${i + 1}`;
    
    let maxTotalCost = context.groupAvgBudget;
    if (tier === 'BUDGET_FRIENDLY') maxTotalCost = context.groupMinBudget;
    else if (tier === 'PREMIUM') maxTotalCost = context.groupMaxBudget;

    const slot1Max = Math.round(maxTotalCost * 0.5);
    const slot2Max = Math.round(maxTotalCost * 0.4);
    const slot3Max = Math.round(maxTotalCost * 0.2);

    const slotsData: any[] = [];

    // Slot 1: Primary Experience
    let primary = getUnusedExperience(slot1Max);
    if (primary) {
      slotsData.push({
        type: 'EXPERIENCE',
        id: primary.id,
        name: primary.title,
        category: primary.category,
        cost: primary.ticketPrice,
        duration: 120,
        imageUrl: primary.imageUrl || getCategoryImage(primary.category),
        link: primary.sourceUrl || `https://example.com/experience/${primary.id}`,
        note: `Start the day with a unique ${primary.title.toLowerCase()} matching the group's vibe.`,
      });
    } else {
      const activityVenue = getUnusedVenue(['ESCAPE_ROOM', 'ARCADE', 'BOWLING', 'MUSEUM', 'SPORTS', 'PARK', 'MALL'], slot1Max);
      if (activityVenue) {
        slotsData.push({
          type: 'VENUE',
          id: activityVenue.id,
          name: activityVenue.name,
          category: activityVenue.category,
          cost: activityVenue.estimatedCostPerHead,
          duration: 90,
          imageUrl: getCategoryImage(activityVenue.category),
          link: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(activityVenue.name + ' ' + activityVenue.address)}`,
          note: `Start the day at ${activityVenue.name}, a great ${activityVenue.category.toLowerCase().replace('_', ' ')} in ${context.midpointAddress}.`,
        });
      }
    }

    // Slot 2: Dining
    const diningVenue = getUnusedVenue(['RESTAURANT', 'CAFE'], slot2Max) || getUnusedVenue(['RESTAURANT', 'CAFE'], 5000);
    if (diningVenue) {
      slotsData.push({
        type: 'VENUE',
        id: diningVenue.id,
        name: diningVenue.name,
        category: diningVenue.category,
        cost: diningVenue.estimatedCostPerHead,
        duration: 90,
        imageUrl: getCategoryImage(diningVenue.category),
        link: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(diningVenue.name + ' ' + diningVenue.address)}`,
        note: `Enjoy a delicious meal at ${diningVenue.name} with the group.`,
      });
    }

    // Slot 3: Dessert or Scenic Leisure
    const leisureVenue = getUnusedVenue(['DESSERT', 'PARK', 'MALL', 'CAFE'], slot3Max) || getUnusedVenue(['DESSERT', 'PARK', 'MALL', 'CAFE'], 5000);
    if (leisureVenue) {
      slotsData.push({
        type: 'VENUE',
        id: leisureVenue.id,
        name: leisureVenue.name,
        category: leisureVenue.category,
        cost: leisureVenue.estimatedCostPerHead,
        duration: 60,
        imageUrl: getCategoryImage(leisureVenue.category),
        link: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(leisureVenue.name + ' ' + leisureVenue.address)}`,
        note: `Unwind afterwards at ${leisureVenue.name} for some relaxing time.`,
      });
    }

    if (slotsData.length === 0) {
      slotsData.push(
        {
          type: 'VENUE',
          id: `fallback_cafe_${planId}`,
          name: `${context.midpointAddress} Local Cafe`,
          category: 'CAFE',
          cost: Math.min(250, slot1Max),
          duration: 60,
          imageUrl: getCategoryImage('CAFE'),
          link: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(context.midpointAddress + ' Cafe')}`,
          note: `A pleasant cafe hangout in ${context.midpointAddress} to get together.`,
        },
        {
          type: 'VENUE',
          id: `fallback_rest_${planId}`,
          name: `${context.midpointAddress} Popular Diner`,
          category: 'RESTAURANT',
          cost: Math.min(500, slot2Max),
          duration: 90,
          imageUrl: getCategoryImage('RESTAURANT'),
          link: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(context.midpointAddress + ' Restaurant')}`,
          note: `A wonderful culinary experience with the group in ${context.midpointAddress}.`,
        }
      );
    }

    const slots = slotsData.map((s, idx) => ({
      order: idx + 1,
      experienceId: s.type === 'EXPERIENCE' ? s.id : null,
      venueId: s.type === 'VENUE' ? s.id : null,
      name: s.name,
      category: s.category,
      arrivalTime: idx === 0 ? '11:00 AM' : idx === 1 ? '01:30 PM' : '03:30 PM',
      durationMinutes: s.duration,
      travelToNextMinutes: idx === slotsData.length - 1 ? null : 15,
      estimatedCostPerHead: s.cost,
      note: s.note,
      imageUrl: s.imageUrl,
      link: s.link,
    }));

    const totalCost = slots.reduce((sum, s) => sum + s.estimatedCostPerHead, 0);
    const totalDuration = slots.reduce((sum, s) => sum + s.durationMinutes, 0) + (slots.length > 1 ? (slots.length - 1) * 15 : 0);

    const tagline = `A custom ${tier.toLowerCase().replace('_', ' ')} itinerary blended dynamically in ${context.midpointAddress}.`;

    itineraries.push({
      id: planId,
      name: context.midpointAddress,
      tagline,
      budgetTier: tier,
      totalEstimatedCostPerHead: totalCost,
      totalDurationMinutes: totalDuration,
      slots,
    });
  }

  return { itineraries };
}

export async function generateItineraries(
  draftItineraries: any[],
  context: ItineraryPromptContext
): Promise<ItineraryResponse> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || apiKey === 'placeholder_key' || apiKey.startsWith('gsk_placeholder')) {
    console.log('GROQ_API_KEY is not configured, returning draft itineraries directly.');
    return { itineraries: draftItineraries };
  }

  const groupContext = {
    groupName: context.groupName,
    groupType: context.groupType,
    vibes: context.vibes,
    memberCount: context.memberCount,
    groupMinBudget: context.groupMinBudget,
    groupAvgBudget: context.groupAvgBudget,
    groupMaxBudget: context.groupMaxBudget,
    preferredCategories: context.preferredCategories,
    midpointAddress: context.midpointAddress,
    outingDate: context.outingDate,
    outingTime: context.outingTime,
  };

  const userPrompt = buildItineraryPrompt(draftItineraries, groupContext);

  const callGroq = async (): Promise<ItineraryResponse> => {
    try {
      const completion = await groqClient.chat.completions.create({
        model: process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile',
        max_tokens: parseInt(process.env.GROQ_MAX_TOKENS || '2048'),
        temperature: parseFloat(process.env.GROQ_TEMPERATURE || '0.2'), // lower temperature for strict format adherence
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: ITINERARY_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
      });

      const raw = completion.choices[0]?.message?.content;
      if (!raw) {
        throw new GroqParseError('Groq returned an empty response.');
      }

      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch (_e) {
        throw new GroqParseError('Failed to parse Groq response as valid JSON.');
      }

      const validated = itineraryResponseSchema.safeParse(parsed);
      if (!validated.success) {
        console.error('Groq JSON validation failure:', JSON.stringify(validated.error.issues, null, 2));
        console.error('Raw Groq content:', raw);
        throw new GroqInvalidSchemaError('Generated output failed layout validation.');
      }

      return validated.data;
    } catch (err: any) {
      if (err instanceof GroqParseError || err instanceof GroqInvalidSchemaError) {
        throw err;
      }
      
      const status = err?.status;
      if (status === 429) {
        throw new GroqRateLimitedError();
      } else if (status >= 500) {
        throw new GroqUnavailableError();
      } else if (err?.message?.includes('timeout')) {
        throw new GroqTimeoutError();
      }

      throw new GroqUnavailableError(err?.message || 'Error occurred calling Groq.');
    }
  };

  try {
    return await callGroq();
  } catch (err) {
    if (isRetryable(err)) {
      console.log('Retryable error encountered, retrying in 2 seconds...');
      await sleep(2000);
      try {
        return await callGroq();
      } catch (retryErr) {
        console.warn('Groq retry failed, falling back to draft itineraries:', retryErr);
        return { itineraries: draftItineraries };
      }
    }
    console.warn('Non-retryable Groq error, falling back to draft itineraries:', err);
    return { itineraries: draftItineraries };
  }
}
