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
  const budgetTiers = ['BUDGET_FRIENDLY', 'BALANCED', 'PREMIUM', 'BALANCED'] as const;
  
  const planConfigs = [
    {
      name: 'Bandra Creative Hub',
      tagline: 'Explore pottery, escape rooms, and coffee roasters in Bandra West.',
      slots: [
        { name: 'Clay Studio Pottery Workshop, Bandra West', category: 'POTTERY', price: 250, duration: 90, note: 'A hands-on clay pottery session to get your creative juices flowing together.' },
        { name: 'The Escape Hunt, Bandra West', category: 'ESCAPE_ROOM', price: 650, duration: 60, note: 'Work together to solve the mystery and escape the room.' },
        { name: 'Subko Coffee Roasters, Bandra West', category: 'CAFE', price: 120, duration: 60, note: 'Relax and discuss your clay pieces over custom pour-overs.' }
      ]
    },
    {
      name: 'Thane Lakes & Ulhasnagar Food Tour',
      tagline: 'Take a scenic walk in Thane followed by a premium dining experience.',
      slots: [
        { name: 'Upvan Lake Nature Walk, Thane', category: 'FREE_EXPERIENCE', price: 0, duration: 120, note: 'A quiet morning stroll discovering scenic lake views and fresh air.' },
        { name: 'Century Club Premium Restaurant, Ulhasnagar', category: 'RESTAURANT', price: 400, duration: 90, note: 'Enjoy a premium multi-cuisine dinner with the group.' },
        { name: 'Game Zone Bowling, Thane West', category: 'BOWLING', price: 250, duration: 60, note: 'Grab a lane for a friendly match.' }
      ]
    },
    {
      name: 'Vashi Gaming & Panvel Garden',
      tagline: 'Dive into board games and arcade tournament with friends in Vashi.',
      slots: [
        { name: 'Vashi Comic Con & Board Game Center', category: 'BOARD_GAME_EVENT', price: 200, duration: 120, note: 'An engaging, competitive board games tournament with your group.' },
        { name: 'Smaaash Arcade, Vashi', category: 'ARCADE', price: 180, duration: 90, note: 'Play multiplayer retro arcade games followed by gourmet sliders.' },
        { name: 'Garden Desserts & Cafe, Panvel', category: 'DESSERT', price: 100, duration: 45, note: 'Savor gourmet desserts and wrap up the evening on a sweet note.' }
      ]
    },
    {
      name: 'South Mumbai Heritage & Jazz',
      tagline: 'Savor artisan desserts after a concert and sunset walk at Marine Drive.',
      slots: [
        { name: 'Sunset Jazz Concert at antiSOCIAL, CST', category: 'LIVE_MUSIC', price: 600, duration: 150, note: 'Experience incredible acoustics and local bands at an intimate venue near CST.' },
        { name: 'Marine Drive Promenade Walk, CST', category: 'PARK', price: 0, duration: 60, note: 'Take a relaxing sunset walk along the famous queen\'s necklace.' },
        { name: 'Kyani & Co. Irani Cafe, CST Area', category: 'DESSERT', price: 120, duration: 45, note: 'Wrap up the evening with fresh seasonal fruit ice cream and classic pudding.' }
      ]
    }
  ];

  for (let i = 0; i < 4; i++) {
    const config = planConfigs[i];
    const tier = budgetTiers[i];
    const planId = `plan_${i + 1}`;
    
    const realSlots = config.slots.map((s, idx) => {
      let experienceId: string | null = null;
      let venueId: string | null = null;
      let displayName = s.name;
      let cost = s.price;

      if (s.category === 'POTTERY' || s.category === 'LIVE_MUSIC' || s.category === 'BOARD_GAME_EVENT' || s.category === 'FREE_EXPERIENCE') {
        const matchedExp = context.experiences.find(e => e.category === s.category);
        if (matchedExp) {
          experienceId = matchedExp.id;
          displayName = matchedExp.title;
          cost = matchedExp.ticketPrice;
        }
      } else {
        const matchedVenue = context.venues.find(v => v.category === s.category);
        if (matchedVenue) {
          venueId = matchedVenue.id;
          displayName = matchedVenue.name;
          cost = matchedVenue.estimatedCostPerHead;
        }
      }

      return {
        order: idx + 1,
        experienceId,
        venueId,
        name: displayName,
        category: s.category as any,
        arrivalTime: idx === 0 ? '11:00 AM' : idx === 1 ? '01:30 PM' : '03:30 PM',
        durationMinutes: s.duration,
        travelToNextMinutes: idx === 2 ? null : 15,
        estimatedCostPerHead: cost,
        note: s.note
      };
    });

    const totalCost = realSlots.reduce((sum, rs) => sum + rs.estimatedCostPerHead, 0);
    const totalDuration = realSlots.reduce((sum, rs) => sum + rs.durationMinutes, 0) + 30; // 30 mins travel buffer

    itineraries.push({
      id: planId,
      name: config.name,
      tagline: config.tagline,
      budgetTier: tier,
      totalEstimatedCostPerHead: totalCost,
      totalDurationMinutes: totalDuration,
      slots: realSlots
    });
  }

  return { itineraries };
}

export async function generateItineraries(
  context: ItineraryPromptContext
): Promise<ItineraryResponse> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || apiKey === 'placeholder_key' || apiKey.startsWith('gsk_placeholder')) {
    console.log('GROQ_API_KEY is not configured, running mock generator fallback.');
    return generateMockItineraries(context);
  }

  const userPrompt = buildItineraryPrompt(context);

  const callGroq = async (): Promise<ItineraryResponse> => {
    try {
      const completion = await groqClient.chat.completions.create({
        model: process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile',
        max_tokens: parseInt(process.env.GROQ_MAX_TOKENS || '2048'),
        temperature: parseFloat(process.env.GROQ_TEMPERATURE || '0.7'),
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
        console.error('Groq JSON validation failure:', validated.error.format());
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
      return await callGroq();
    }
    throw err;
  }
}
