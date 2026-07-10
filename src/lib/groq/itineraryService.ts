import 'server-only';
import { groqClient } from './client';
import { ITINERARY_SYSTEM_PROMPT, buildItineraryPrompt } from './prompts';
import { itineraryResponseSchema, ItineraryResponse } from '../validators/itinerary.schema';
import { ItineraryPromptContext } from '../types/planner.types';
import { recordCost } from '../services/costLedger';
import {
  GroqTimeoutError,
  GroqParseError,
  GroqInvalidSchemaError,
  GroqRateLimitedError,
  GroqUnavailableError,
} from '../errors';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function isRetryable(err: unknown): boolean {
  if (err instanceof SyntaxError) return true; // malformed JSON
  if (err instanceof Error && err.message.includes('429')) return true; // rate limit
  if (err instanceof Error && err.message.includes('timeout')) return true;
  return false;
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

      // Cost accounting — Groq bills by tokens.
      const usage: any = (completion as any).usage;
      const totalTokens = Number(usage?.total_tokens ?? usage?.prompt_tokens ?? 0) + Number(usage?.completion_tokens ?? 0);
      recordCost({
        operation: 'AI_GROQ',
        provider: 'GROQ',
        units: totalTokens || 1,
        metadata: {
          model: process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile',
          promptTokens: usage?.prompt_tokens,
          completionTokens: usage?.completion_tokens,
        },
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
