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
      name: 'Creative Spark & Coffee',
      tagline: 'Dabble in clay before unwinding at a cozy local cafe.',
      slots: [
        { name: 'Clay Studio Pottery Workshop', category: 'POTTERY', price: 250, duration: 90, note: 'A hands-on clay pottery session to get your creative juices flowing together.' },
        { name: 'Coffee Roasters Cafe', category: 'CAFE', price: 120, duration: 60, note: 'Relax after the workshop and discuss your clay pieces over custom pour-overs.' }
      ]
    },
    {
      name: 'Historic Walk & Dinner',
      tagline: 'Take a scenic walk before dining at a premium restaurant.',
      slots: [
        { name: 'Heritage Street Scenic Walk', category: 'FREE_EXPERIENCE', price: 0, duration: 120, note: 'A quiet, guided morning stroll discovering historical street murals and stories.' },
        { name: 'Lakeside Bistro & Grill', category: 'RESTAURANT', price: 400, duration: 90, note: 'Enjoy a premium multi-cuisine dinner by the water.' }
      ]
    },
    {
      name: 'Pop Culture & Gaming',
      tagline: 'Dive into board games and arcade tournament with friends.',
      slots: [
        { name: 'Comic Con & Board Game Center', category: 'BOARD_GAME_EVENT', price: 200, duration: 120, note: 'An engaging, competitive board games tournament with your group.' },
        { name: 'Cyber Arcade & Burgers', category: 'ARCADE', price: 180, duration: 90, note: 'Play multiplayer retro arcade games followed by gourmet sliders.' }
      ]
    },
    {
      name: 'Live Music & Dessert',
      tagline: 'Savor artisan desserts after an intimate live music performance.',
      slots: [
        { name: 'Sunset Jazz & Blues Concert', category: 'LIVE_MUSIC', price: 600, duration: 150, note: 'Experience incredible acoustics and local bands at an intimate venue.' },
        { name: 'Pâtisserie & Waffles', category: 'DESSERT', price: 150, duration: 45, note: 'Savor gourmet desserts and wrap up the evening on a sweet note.' }
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

      if (idx === 0) {
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
        arrivalTime: idx === 0 ? '11:00 AM' : '01:30 PM',
        durationMinutes: s.duration,
        travelToNextMinutes: idx === 0 ? 15 : null,
        estimatedCostPerHead: cost,
        note: s.note
      };
    });

    const totalCost = realSlots.reduce((sum, rs) => sum + rs.estimatedCostPerHead, 0);
    const totalDuration = realSlots.reduce((sum, rs) => sum + rs.durationMinutes, 0) + 15;

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
