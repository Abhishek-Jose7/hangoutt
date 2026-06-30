// Must be the very first import to mock server-only before loading Next.js modules
import './setup';

import type { Scenario } from './scenarios';

function buildSyntheticGroupData(scenario: Scenario) {
  const presentMembers = scenario.locations.map((loc, i) => ({
    userId: `eval_user_${scenario.id}_${i}`,
    role: i === 0 ? 'ADMIN' : 'MEMBER',
    isPresent: 1,
    name: `EvalUser${i + 1}`,
    email: `eval${i + 1}@hangout.test`,
    vibes: '[]',
  }));

  const presentLocations = scenario.locations.map((loc, i) => ({
    userId: `eval_user_${scenario.id}_${i}`,
    lat: loc.lat,
    lng: loc.lng,
    locationName: loc.label,
  }));

  const presentBudgetSummary = {
    min: scenario.budget,
    avg: scenario.budget,
    max: scenario.budget,
  };

  const groupData = {
    id: `eval_group_${scenario.id}`,
    name: `EvalGroup_${scenario.id}`,
    groupType: scenario.groupType,
    status: 'READY_TO_GENERATE',
    votingStatus: 'CLOSED',
    vibes: '[]',
    outingDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    outingTime: scenario.outingTime,
    isFastTrack: 0,
  };

  return { groupData, presentMembers, presentLocations, presentBudgetSummary };
}

export interface RunResult {
  plans: any[];
  durationMs: number;
  usedFallback: boolean;
  error?: string;
}

export async function runScenario(scenario: Scenario): Promise<RunResult> {
  const start = Date.now();
  try {
    const { executePlanningEngineForEval, buildFallbackItineraryDataForEval } = await import('../src/lib/services/planner.service');
    const { groupData, presentMembers, presentLocations, presentBudgetSummary } = buildSyntheticGroupData(scenario);

    let plans = await executePlanningEngineForEval(
      groupData,
      presentMembers,
      presentBudgetSummary,
      presentLocations,
      scenario.preferences,
      [],
      [],
      scenario.budget,
      []
    );

    let usedFallback = false;

    // Mirror production behaviour: if engine returns 0 plans, use budget+location-aware fallback
    if (plans.length === 0) {
      usedFallback = true;
      const memberLocations = scenario.locations.map(l => ({ lat: l.lat, lng: l.lng }));
      const fallbackPlans: any[] = [];
      for (let fi = 1; fi <= 3; fi++) {
        try {
          fallbackPlans.push(buildFallbackItineraryDataForEval(
            fi, groupData, presentMembers, presentLocations, memberLocations, scenario.budget
          ));
        } catch {
          // If fallback also fails, leave plan count at what we have
        }
      }
      plans = fallbackPlans;
    }

    return { plans, durationMs: Date.now() - start, usedFallback };
  } catch (err: any) {
    return {
      plans: [],
      durationMs: Date.now() - start,
      usedFallback: false,
      error: err?.message ?? String(err),
    };
  }
}
