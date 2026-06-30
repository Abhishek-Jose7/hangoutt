import fs from 'fs';
import path from 'path';

export interface RegressionReport {
  previous: string | null;
  current: string;
  diffs: Record<string, { before: number; after: number; delta: number; direction: 'improved' | 'declined' | 'unchanged' }>;
  summary: string;
}

function formatDelta(value: number, higherIsBetter: boolean): string {
  const sign = value > 0 ? '+' : '';
  const indicator = value === 0 ? '→' : higherIsBetter === value > 0 ? '▲' : '▼';
  return `${indicator} ${sign}${value.toFixed(2)}`;
}

export function compareReports(currentPath: string): RegressionReport | null {
  const reportsDir = path.dirname(currentPath);
  const files = fs.readdirSync(reportsDir)
    .filter(f => f.endsWith('.json') && f !== path.basename(currentPath))
    .sort()
    .reverse();

  if (files.length === 0) {
    return null;
  }

  const previousPath = path.join(reportsDir, files[0]);

  let prev: any, curr: any;
  try {
    prev = JSON.parse(fs.readFileSync(previousPath, 'utf-8'));
    curr = JSON.parse(fs.readFileSync(currentPath, 'utf-8'));
  } catch {
    return null;
  }

  const ps = prev.summary ?? {};
  const cs = curr.summary ?? {};

  const metrics: Record<string, { key: string; higherIsBetter: boolean }> = {
    'Overall Score (avg)':  { key: 'avgOverallScore',       higherIsBetter: true  },
    'Fallback Rate %':      { key: 'fallbackRate',          higherIsBetter: false },
    'Budget Respect %':     { key: 'budgetRespectRate',     higherIsBetter: true  },
    'Avg Travel Time (min)':{ key: 'avgTravelTime',         higherIsBetter: false },
    'Diversity Score (avg)':{ key: 'avgDiversityScore',     higherIsBetter: true  },
    'Constraint Viol. %':   { key: 'constraintViolRate',    higherIsBetter: false },
    'Live-Fetch Rate %':    { key: 'liveFetchRate',         higherIsBetter: true  },
    'Engine Fallback %':    { key: 'engineFallbackRate',    higherIsBetter: false },
    'Failure Rate %':       { key: 'failureRate',           higherIsBetter: false },
    'Avg Venue Rating':     { key: 'avgVenueRating',        higherIsBetter: true  },
    'Plans Generated':      { key: 'totalPlansGenerated',   higherIsBetter: true  },
  };

  const diffs: RegressionReport['diffs'] = {};
  const lines: string[] = [];

  for (const [label, { key, higherIsBetter }] of Object.entries(metrics)) {
    const before = ps[key] ?? 0;
    const after = cs[key] ?? 0;
    const delta = after - before;
    const direction: 'improved' | 'declined' | 'unchanged' =
      Math.abs(delta) < 0.001 ? 'unchanged' :
      (higherIsBetter ? delta > 0 : delta < 0) ? 'improved' : 'declined';
    diffs[label] = { before, after, delta, direction };
    lines.push(`  ${label.padEnd(22)} ${String(before.toFixed(2)).padStart(7)} → ${String(after.toFixed(2)).padEnd(7)} ${formatDelta(delta, higherIsBetter)}`);
  }

  const improved = Object.values(diffs).filter(d => d.direction === 'improved').length;
  const declined = Object.values(diffs).filter(d => d.direction === 'declined').length;
  const summary = `${improved} metrics improved, ${declined} declined vs ${path.basename(previousPath)}\n${lines.join('\n')}`;

  return {
    previous: previousPath,
    current: currentPath,
    diffs,
    summary,
  };
}
