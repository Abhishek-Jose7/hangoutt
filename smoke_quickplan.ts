// Smoke: verify quick-plan locality, venue reality, budget, and common situations.
import 'dotenv/config';

// Neutralize 'server-only' guard for standalone execution.
import Module from 'module';
const origResolve = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (request: string, ...args: any[]) {
  if (request === 'server-only') return __filename;
  return origResolve.call(this, request, ...args);
};

type Scenario = {
  name: string;
  input: {
    mode: 'AREA';
    location: string;
    headcount: number;
    budget: number;
    perPerson: boolean;
    tags: string[];
    outingTime?: string;
  };
  expectedZone: string;
  expectSuccess?: boolean;
};

const scenarios: Scenario[] = [
  {
    name: 'Bandra date evening',
    expectedZone: 'Bandra',
    input: { mode: 'AREA', location: 'Bandra', headcount: 2, budget: 1200, perPerson: true, tags: ['food', 'date'], outingTime: '18:00' },
  },
  {
    name: 'Colaba culture afternoon',
    expectedZone: 'Colaba',
    input: { mode: 'AREA', location: 'Colaba', headcount: 3, budget: 1500, perPerson: true, tags: ['culture', 'food'], outingTime: '14:00' },
  },
  {
    name: 'Andheri friends games',
    expectedZone: 'Andheri',
    input: { mode: 'AREA', location: 'Andheri', headcount: 4, budget: 1400, perPerson: true, tags: ['adventure', 'games', 'food'], outingTime: '17:30' },
  },
  {
    name: 'Powai chill outdoors',
    expectedZone: 'Powai',
    input: { mode: 'AREA', location: 'Powai', headcount: 3, budget: 1000, perPerson: true, tags: ['chill', 'outdoors', 'food'], outingTime: '16:00' },
  },
  {
    name: 'Vashi group food',
    expectedZone: 'Vashi',
    input: { mode: 'AREA', location: 'Vashi', headcount: 5, budget: 1300, perPerson: true, tags: ['food', 'shopping'], outingTime: '18:30' },
  },
  {
    name: 'Bandra low budget',
    expectedZone: 'Bandra',
    input: { mode: 'AREA', location: 'Bandra', headcount: 2, budget: 500, perPerson: true, tags: ['chill', 'outdoors'], outingTime: '16:00' },
  },
];

function distKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function isFallbackId(id?: string | null) {
  return !id || id.startsWith('fb_') || id.startsWith('fallback_');
}

async function main() {
  process.env.GROQ_API_KEY = 'placeholder_key';
  process.env.GOOGLE_MAPS_API_KEY = '';
  process.env.OLA_MAPS_API_KEY = '';
  process.env.HANGOUT_API_URL = '';
  process.env.HANGOUT_API_SECRET = '';

  const { quickPlanService } = await import('./src/lib/services/quickPlan.service');
  const { getVenueZone } = await import('./src/lib/services/planner.service');

  const realLog = console.log;
  const realWarn = console.warn;
  console.log = (...args: any[]) => {
    const first = String(args[0] ?? '');
    if (first.startsWith('[PLANNER] candidates') || first.startsWith('[PLANNER] archetype')) {
      realLog(...args);
    }
  };
  console.warn = (...args: any[]) => {
    const first = String(args[0] ?? '');
    if (first.includes('Only') || first.includes('Skipping')) realWarn(...args);
  };

  const failures: string[] = [];
  const summaries: string[] = [];

  for (const scenario of scenarios) {
    try {
      const res = await quickPlanService.generate(`smoke_${scenario.expectedZone}`, scenario.input);
      const center = res.planningArea;
      const plans = res.plans || [];

      if (plans.length < 2) {
        failures.push(`${scenario.name}: expected at least 2 plans, got ${plans.length}`);
      }

      for (const plan of plans) {
        const slots = plan.slots || [];
        if (slots.length < 2 || slots.length > 3) {
          failures.push(`${scenario.name}/${plan.planIndex}: bad slot count ${slots.length}`);
        }

        const categories = new Set<string>();
        for (const slot of slots) {
          const venueId = slot.venueId as string | null | undefined;
          if (isFallbackId(venueId) && !slot.experienceId) {
            failures.push(`${scenario.name}/${plan.planIndex}: fallback slot ${slot.name}`);
          }
          if (slot.lat && slot.lng) {
            const d = distKm(center, { lat: slot.lat, lng: slot.lng });
            if (d > center.radiusKm + 0.01) {
              failures.push(`${scenario.name}/${plan.planIndex}: ${slot.name} ${d.toFixed(1)}km outside ${center.radiusKm}km radius`);
            }
            const zone = getVenueZone(slot.lat, slot.lng, slot.name, slot.address || '');
            if (zone !== scenario.expectedZone) {
              failures.push(`${scenario.name}/${plan.planIndex}: ${slot.name} resolved ${zone}, expected ${scenario.expectedZone}`);
            }
          }
          categories.add(String(slot.category ?? '').toUpperCase());
        }

        if (categories.size < Math.min(2, slots.length)) {
          failures.push(`${scenario.name}/${plan.planIndex}: weak category variety ${Array.from(categories).join(',')}`);
        }

        const ceiling = scenario.input.budget * 1.10;
        if (scenario.input.perPerson && plan.totalEstimatedCostPerHead > ceiling) {
          failures.push(`${scenario.name}/${plan.planIndex}: over budget ${plan.totalEstimatedCostPerHead} > ${ceiling}`);
        }
      }

      const planDetails = plans.map((p: any, idx: number) => {
        const slots = p.slots || [];
        const parts: string[] = [];
        for (let i = 0; i < slots.length; i++) {
          const s = slots[i];
          parts.push(`${s.name} (${s.category}, ₹${s.estimatedCostPerHead ?? '?'})`);
          if (i < slots.length - 1) {
            const next = slots[i + 1];
            if (s.lat && s.lng && next.lat && next.lng) {
              const d = distKm({ lat: s.lat, lng: s.lng }, { lat: next.lat, lng: next.lng });
              const travelMin = Math.round(d * 4 + 3);
              parts.push(` ──[ ${d.toFixed(1)} km, ~${travelMin} mins ]──> `);
            } else {
              parts.push(' ──> ');
            }
          }
        }
        const label = p.name ? ` (${p.name})` : '';
        return `  Plan ${idx + 1}${label} [₹${p.totalEstimatedCostPerHead}/head]: ${parts.join('')}`;
      }).join('\n');
      summaries.push(`\n=== SCENARIO: ${scenario.name} (${scenario.expectedZone}) ===\n${planDetails}`);
    } catch (err: any) {
      if (scenario.expectSuccess === false) {
        summaries.push(`\n=== SCENARIO: ${scenario.name} (${scenario.expectedZone}) ===\n  PASS clean failure "${err?.message ?? err}"`);
      } else {
        failures.push(`${scenario.name}: threw ${err?.message ?? err}`);
      }
    }
  }

  console.log = realLog;
  console.warn = realWarn;

  for (const line of summaries) console.log(line);
  if (failures.length > 0) {
    console.error('\nSMOKE FAILURES');
    failures.forEach(f => console.error(`- ${f}`));
    process.exit(1);
  }
  console.log('\nAll quick-plan smoke scenarios passed.');
}

main().then(() => process.exit(0)).catch(e => {
  console.error('SMOKE FAIL:', e?.message ?? e);
  process.exit(1);
});
