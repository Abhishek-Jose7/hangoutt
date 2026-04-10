import type { Place } from '@/types';

export type CostRange = {
  min: number;
  max: number;
};

type CostInferenceInput = {
  name: string;
  type: Place['type'];
  description?: string;
  tags?: string[];
  estimatedCost?: number;
};

const BRAND_COST_OVERRIDES: Array<{ pattern: RegExp; range: CostRange }> = [
  { pattern: /\b(blue tokai|third wave|starbucks|chaayos|tim hortons|costa|ccd)\b/i, range: { min: 200, max: 350 } },
  { pattern: /\b(vietnom)\b/i, range: { min: 400, max: 700 } },
  { pattern: /\b(the bagel shop|bagel shop)\b/i, range: { min: 250, max: 450 } },
  { pattern: /\b(burger king|mcdonald|kfc|subway|dominos|pizza hut)\b/i, range: { min: 200, max: 400 } },
  { pattern: /\b(timezone|smaaash|fun city|game zone|arcade)\b/i, range: { min: 300, max: 700 } },
];

function normalizeText(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeRange(range: CostRange): CostRange {
  const min = Math.round(clamp(range.min, 0, 4000));
  const max = Math.round(clamp(range.max, min, 5000));
  return { min, max };
}

function midpoint(range: CostRange): number {
  return Math.round((range.min + range.max) / 2);
}

function hasAny(text: string, pattern: RegExp): boolean {
  return pattern.test(text);
}

function baseRangeByType(type: Place['type']): CostRange {
  if (type === 'cafe') return { min: 170, max: 340 };
  if (type === 'restaurant') return { min: 280, max: 620 };
  if (type === 'activity') return { min: 0, max: 300 };
  return { min: 0, max: 150 };
}

function dynamicRangeAdjustments(input: CostInferenceInput, base: CostRange): CostRange {
  const text = normalizeText(`${input.name} ${input.description || ''} ${(input.tags || []).join(' ')}`);

  if (input.type === 'restaurant' && hasAny(text, /\b(fast food|quick bite|burger|pizza|fries|sandwich|shawarma)\b/)) {
    return { min: 200, max: 400 };
  }

  if (input.type === 'restaurant' && hasAny(text, /\b(hotel|mess|udupi|thali|canteen|snack|snacks|shack|stall|street food)\b/)) {
    return { min: 180, max: 420 };
  }

  if (input.type === 'restaurant' && hasAny(text, /\b(fine dining|degustation|chef s table|premium|rooftop dining)\b/)) {
    return { min: 550, max: 1200 };
  }

  if (input.type === 'cafe' && hasAny(text, /\b(local cafe|tea stall|chai|tapri|snack corner)\b/)) {
    return { min: 120, max: 260 };
  }

  if (input.type === 'activity') {
    if (hasAny(text, /\b(bowling|arcade|trampoline|escape room|gaming|laser tag|kart|amusement|theme park|cinema|movie|theatre|theater|pvr|inox)\b/)) {
      return { min: 200, max: 600 };
    }

    if (hasAny(text, /\b(promenade|seaface|beach|park|garden|fort|viewpoint|walk|trail|gallery)\b/)) {
      return { min: 0, max: 150 };
    }
  }

  return base;
}

function estimateObservedRange(estimatedCost?: number): CostRange | null {
  if (typeof estimatedCost !== 'number' || !Number.isFinite(estimatedCost) || estimatedCost <= 0) {
    return null;
  }

  if (estimatedCost <= 120) {
    return normalizeRange({ min: 0, max: Math.max(150, Math.round(estimatedCost * 1.8)) });
  }

  const min = Math.round(estimatedCost * 0.72);
  const max = Math.round(estimatedCost * 1.28);
  return normalizeRange({ min, max });
}

export function inferCostRange(input: CostInferenceInput): CostRange {
  let range = baseRangeByType(input.type);
  range = dynamicRangeAdjustments(input, range);

  const normalizedName = normalizeText(input.name);
  for (const override of BRAND_COST_OVERRIDES) {
    if (override.pattern.test(normalizedName)) {
      range = override.range;
      break;
    }
  }

  const observed = estimateObservedRange(input.estimatedCost);
  if (observed) {
    const blended: CostRange = {
      min: Math.round((range.min + observed.min) / 2),
      max: Math.round((range.max + observed.max) / 2),
    };
    return normalizeRange(blended);
  }

  return normalizeRange(range);
}

export function midpointCostRange(range: CostRange): number {
  return midpoint(normalizeRange(range));
}
