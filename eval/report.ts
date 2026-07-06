import fs from 'fs';
import path from 'path';
import type { Scenario } from './scenarios';
import type { ItineraryMetrics } from './metrics';

export interface ReportEntry {
  scenario: Scenario;
  metrics: ItineraryMetrics;
}

export interface ReportSummary {
  runAt: string;
  totalScenarios: number;
  totalPlansGenerated: number;
  failureRate: number;
  fallbackRate: number;
  engineFallbackRate: number;  // % where engine produced 0 plans and builder was used
  liveFetchRate: number;
  budgetRespectRate: number;
  avgOverallScore: number;
  medianOverallScore: number;
  p10OverallScore: number;
  p90OverallScore: number;
  avgVenueRating: number;
  avgTravelTime: number;
  avgDiversityScore: number;
  avgBudgetUtilization: number;
  constraintViolRate: number;
  avgStructuralEntropy: number;                              // avg distinct families / plans, 0..1
  fullyDiverseRate: number;                                  // % of scenarios where all 4 plans have distinct families
  familyDistribution: Record<string, number>;                // count of plans per archetype family
  preferenceMatchAvg: number;                                // avg preference-match ratio across scenarios
  groupTypeFamilyMatrix: Record<string, Record<string, number>>;  // rows: group type, cols: family
  timeBucketFamilyMatrix: Record<string, Record<string, number>>; // rows: time bucket, cols: family
  sizeBucketFamilyMatrix: Record<string, Record<string, number>>; // rows: size bucket, cols: family
  topVenueShare: number;                                     // % of plans that contain the single most-picked venue
  top10VenueShare: number;                                   // % of plans containing ANY of the top-10 venues
  categoryRepeatWithinPlanRate: number;                      // % of plans that repeat a category (CAFE→CAFE)
  zoneRepetitionAcrossPlans: number;                         // % of scenarios where the 4 plans all use ≤ 2 distinct zones
  bestScenario: ReportEntry | null;
  worstScenario: ReportEntry | null;
  mostCommonVenues: { name: string; count: number }[];
  unusedZones: string[];
  categoryAppearanceRate: Record<string, number>;
  budgetPerformance: Record<string, number>;
  violationBreakdown: Record<string, number>;
}

export interface ReportPaths {
  jsonPath: string;
  htmlPath: string;
  markdownPath: string;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function buildSummary(entries: ReportEntry[]): ReportSummary {
  const now = new Date().toISOString();
  const total = entries.length;
  if (total === 0) {
    return {
      runAt: now, totalScenarios: 0, totalPlansGenerated: 0,
      failureRate: 0, fallbackRate: 0, engineFallbackRate: 0, liveFetchRate: 0, budgetRespectRate: 0,
      avgOverallScore: 0, medianOverallScore: 0, p10OverallScore: 0, p90OverallScore: 0,
      avgVenueRating: 0, avgTravelTime: 0, avgDiversityScore: 0, avgBudgetUtilization: 0,
      constraintViolRate: 0,
      avgStructuralEntropy: 0, fullyDiverseRate: 0, familyDistribution: {},
      preferenceMatchAvg: 0,
      groupTypeFamilyMatrix: {}, timeBucketFamilyMatrix: {}, sizeBucketFamilyMatrix: {},
      topVenueShare: 0, top10VenueShare: 0, categoryRepeatWithinPlanRate: 0, zoneRepetitionAcrossPlans: 0,
      bestScenario: null, worstScenario: null,
      mostCommonVenues: [], unusedZones: [], categoryAppearanceRate: {}, budgetPerformance: {}, violationBreakdown: {},
    };
  }

  const scores = entries.map(e => e.metrics.overallScore).sort((a, b) => a - b);
  const failed = entries.filter(e => e.metrics.planCount === 0);
  const fallback = entries.filter(e => e.metrics.isFallbackOnly && e.metrics.planCount > 0);
  const engineFallback = entries.filter(e => e.metrics.engineFallback);
  const liveFetch = entries.filter(e => e.metrics.hasLiveFetch);
  const budgetOk = entries.filter(e => e.metrics.budgetRespected);
  const withViol = entries.filter(e => e.metrics.constraintViolations.length > 0);

  // Venue frequency
  const venueCounts: Record<string, number> = {};
  const usedZones = new Set<string>();
  const catCounts: Record<string, number> = {};
  const catTotal: Record<string, number> = {};
  const violCounts: Record<string, number> = {};

  for (const entry of entries) {
    for (const plan of entry.metrics.plans) {
      usedZones.add(plan.meetupZone);
      for (const slot of plan.slots) {
        venueCounts[slot.name] = (venueCounts[slot.name] ?? 0) + 1;
        const cat = slot.category?.toUpperCase();
        if (cat) {
          catCounts[cat] = (catCounts[cat] ?? 0) + 1;
        }
      }
    }
    for (const v of entry.metrics.constraintViolations) {
      const key = v.split(':')[0];
      violCounts[key] = (violCounts[key] ?? 0) + 1;
    }
  }

  const ALL_CATS = ['CAFE', 'RESTAURANT', 'ARCADE', 'BOWLING', 'MUSEUM', 'MALL', 'PARK', 'DESSERT', 'ESCAPE_ROOM', 'SPORTS', 'MOVIE'];
  const categoryAppearanceRate: Record<string, number> = {};
  for (const cat of ALL_CATS) {
    categoryAppearanceRate[cat] = Math.round(((catCounts[cat] ?? 0) / (total * 3 + 1)) * 100); // approx 3 slots per plan
  }

  const budgetPerformance: Record<string, number> = {};
  for (const entry of entries) {
    const bKey = `₹${entry.scenario.budget}`;
    if (!budgetPerformance[bKey]) budgetPerformance[bKey] = 0;
    budgetPerformance[bKey] = Math.round(
      (budgetPerformance[bKey] + entry.metrics.overallScore) / 2
    );
  }

  const sortedByScore = [...entries].sort((a, b) => b.metrics.overallScore - a.metrics.overallScore);
  const allZones = ['Bandra', 'Dadar', 'Andheri', 'Kurla', 'Ghatkopar', 'Borivali', 'Lower Parel', 'Worli', 'Thane', 'Vashi', 'Belapur'];
  const unusedZones = allZones.filter(z => !usedZones.has(z));

  // Archetype family diversity aggregates
  const familyDistribution: Record<string, number> = {};
  const groupTypeFamilyMatrix: Record<string, Record<string, number>> = {};
  const timeBucketFamilyMatrix: Record<string, Record<string, number>> = {};
  const sizeBucketFamilyMatrix: Record<string, Record<string, number>> = {};
  const timeBucketFrom = (t?: string): string => {
    if (!t) return 'AFTERNOON';
    const m = t.match(/^(\d{1,2}):/); const h = m ? parseInt(m[1]) : 12;
    if (h < 12) return 'MORNING';
    if (h < 17) return 'AFTERNOON';
    if (h < 21) return 'EVENING';
    return 'NIGHT';
  };
  const sizeBucketFrom = (n: number): string => {
    if (n <= 2) return 'PAIR';
    if (n <= 4) return 'SMALL';
    if (n <= 6) return 'MEDIUM';
    return 'LARGE';
  };
  let entropySum = 0;
  let fullyDiverseCount = 0;
  let prefMatchSum = 0;
  for (const entry of entries) {
    const fams = entry.metrics.archetypeFamilies ?? [];
    for (const f of fams) {
      if (!f) continue;
      familyDistribution[f] = (familyDistribution[f] ?? 0) + 1;
      const gt = entry.scenario.groupType;
      const tb = timeBucketFrom(entry.scenario.outingTime);
      const sb = sizeBucketFrom(entry.scenario.groupSize);
      groupTypeFamilyMatrix[gt] = groupTypeFamilyMatrix[gt] ?? {};
      groupTypeFamilyMatrix[gt][f] = (groupTypeFamilyMatrix[gt][f] ?? 0) + 1;
      timeBucketFamilyMatrix[tb] = timeBucketFamilyMatrix[tb] ?? {};
      timeBucketFamilyMatrix[tb][f] = (timeBucketFamilyMatrix[tb][f] ?? 0) + 1;
      sizeBucketFamilyMatrix[sb] = sizeBucketFamilyMatrix[sb] ?? {};
      sizeBucketFamilyMatrix[sb][f] = (sizeBucketFamilyMatrix[sb][f] ?? 0) + 1;
    }
    entropySum += entry.metrics.structuralEntropy ?? 0;
    if ((entry.metrics.distinctFamilyCount ?? 0) >= 4 && (entry.metrics.planCount ?? 0) >= 4) {
      fullyDiverseCount++;
    }
    prefMatchSum += entry.metrics.preferenceMatchRatio ?? 0;
  }
  const avgStructuralEntropy = +(entropySum / total).toFixed(3);
  const fullyDiverseRate = +((fullyDiverseCount / total) * 100).toFixed(1);
  const preferenceMatchAvg = +((prefMatchSum / total) * 100).toFixed(1);

  // Venue-repetition + realism metrics
  const totalPlansGeneratedCount = entries.reduce((s, e) => s + e.metrics.planCount, 0);
  const sortedVenueCounts = Object.entries(venueCounts).sort(([, a], [, b]) => b - a);
  const topVenueCount = sortedVenueCounts[0]?.[1] ?? 0;
  const top10Names = new Set(sortedVenueCounts.slice(0, 10).map(([n]) => n));
  const topVenueShare = totalPlansGeneratedCount > 0
    ? +((topVenueCount / totalPlansGeneratedCount) * 100).toFixed(2)
    : 0;
  let plansWithTop10 = 0;
  let plansTotal = 0;
  let plansWithCategoryRepeat = 0;
  let scenariosWithZoneRepeat = 0;
  for (const entry of entries) {
    const zonesUsed = new Set<string>();
    for (const plan of entry.metrics.plans) {
      plansTotal++;
      zonesUsed.add(plan.meetupZone);
      // Category repeat within plan
      const cats = plan.slots.map(s => (s.category ?? '').toUpperCase()).filter(Boolean);
      if (cats.length !== new Set(cats).size) plansWithCategoryRepeat++;
      // Top-10 hit
      if (plan.slots.some(s => top10Names.has(s.name))) plansWithTop10++;
    }
    if (zonesUsed.size <= 2 && entry.metrics.plans.length >= 3) scenariosWithZoneRepeat++;
  }
  const top10VenueShare = plansTotal > 0 ? +((plansWithTop10 / plansTotal) * 100).toFixed(1) : 0;
  const categoryRepeatWithinPlanRate = plansTotal > 0 ? +((plansWithCategoryRepeat / plansTotal) * 100).toFixed(1) : 0;
  const zoneRepetitionAcrossPlans = +((scenariosWithZoneRepeat / total) * 100).toFixed(1);

  return {
    runAt: now,
    totalScenarios: total,
    totalPlansGenerated: entries.reduce((s, e) => s + e.metrics.planCount, 0),
    failureRate: +(failed.length / total * 100).toFixed(1),
    fallbackRate: +((failed.length + fallback.length) / total * 100).toFixed(1),
    engineFallbackRate: +(engineFallback.length / total * 100).toFixed(1),
    liveFetchRate: +(liveFetch.length / total * 100).toFixed(1),
    budgetRespectRate: +(budgetOk.length / total * 100).toFixed(1),
    avgOverallScore: +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1),
    medianOverallScore: +percentile(scores, 50).toFixed(1),
    p10OverallScore: +percentile(scores, 10).toFixed(1),
    p90OverallScore: +percentile(scores, 90).toFixed(1),
    avgVenueRating: +(entries.reduce((s, e) => s + e.metrics.avgVenueRating, 0) / total).toFixed(2),
    avgTravelTime: +(entries.reduce((s, e) => s + e.metrics.avgTravelTimeMinutes, 0) / total).toFixed(1),
    avgDiversityScore: +(entries.reduce((s, e) => s + (e.metrics.uniqueVenueCount / Math.max(1, (e.metrics.plans[0]?.slots?.length ?? 3))), 0) / total).toFixed(2),
    avgBudgetUtilization: +(entries.reduce((s, e) => s + e.metrics.budgetUtilization, 0) / total * 100).toFixed(1),
    constraintViolRate: +(withViol.length / total * 100).toFixed(1),
    avgStructuralEntropy,
    fullyDiverseRate,
    familyDistribution,
    preferenceMatchAvg,
    groupTypeFamilyMatrix,
    timeBucketFamilyMatrix,
    sizeBucketFamilyMatrix,
    topVenueShare,
    top10VenueShare,
    categoryRepeatWithinPlanRate,
    zoneRepetitionAcrossPlans,
    bestScenario: sortedByScore[0] ?? null,
    worstScenario: sortedByScore[sortedByScore.length - 1] ?? null,
    mostCommonVenues: Object.entries(venueCounts).sort(([, a], [, b]) => b - a).slice(0, 20).map(([name, count]) => ({ name, count })),
    unusedZones,
    categoryAppearanceRate,
    budgetPerformance,
    violationBreakdown: violCounts,
  };
}

export function writeReports(entries: ReportEntry[], summary: ReportSummary, regression?: string): ReportPaths {
  const reportsDir = path.resolve(process.cwd(), 'eval/reports');
  fs.mkdirSync(reportsDir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const jsonPath = path.join(reportsDir, `${ts}.json`);
  const htmlPath = path.join(reportsDir, `${ts}.html`);
  const markdownPath = path.join(reportsDir, `${ts}-best-itineraries.md`);

  fs.writeFileSync(jsonPath, JSON.stringify({ summary, entries }, null, 2));

  const html = generateHtml(summary, entries, regression);
  fs.writeFileSync(htmlPath, html);

  fs.writeFileSync(markdownPath, generateBestItinerariesMarkdown(summary, entries, regression));

  return { jsonPath, htmlPath, markdownPath };
}

function formatCurrency(value: number | string | undefined): string {
  if (value === undefined || value === null || value === '') return 'Rs --';
  return `Rs ${value}`;
}

function formatMinutes(value: number | undefined): string {
  if (!value || value <= 0) return '-- min';
  return `${Math.round(value)} min`;
}

function cleanCell(value: string | undefined | null): string {
  return String(value ?? '--').replace(/\s+/g, ' ').trim();
}

function planLine(entry: ReportEntry, rank: number): string {
  const plan = entry.metrics.plans[0];
  const stops = plan?.slots.map((slot, index) => {
    const category = slot.category ? ` (${slot.category})` : '';
    return `${index + 1}. ${slot.name}${category}`;
  }).join(' -> ') || 'No stops generated';
  const violations = entry.metrics.constraintViolations.length > 0
    ? entry.metrics.constraintViolations.join('; ')
    : 'None';

  return [
    `### ${rank + 1}. ${cleanCell(entry.scenario.locationSetName)} - ${cleanCell(entry.scenario.groupType)} - ${cleanCell(entry.scenario.outingTimeLabel)}`,
    ``,
    `- Score: ${entry.metrics.overallScore}/100`,
    `- Zone: ${cleanCell(plan?.meetupZone)}`,
    `- Budget: ${formatCurrency(entry.scenario.budget)} per head; estimated: ${formatCurrency(plan?.totalEstimatedCostPerHead)} per head`,
    `- Travel: ${formatMinutes(entry.metrics.avgTravelTimeMinutes)} average`,
    `- Venue rating: ${entry.metrics.avgVenueRating.toFixed(2)}`,
    `- Preference match: ${Math.round(entry.metrics.preferenceMatchRatio * 100)}%`,
    `- Fallback used: ${entry.metrics.engineFallback || entry.metrics.isFallbackOnly ? 'Yes' : 'No'}`,
    `- Violations: ${violations}`,
    `- Stops: ${stops}`,
    ``,
  ].join('\n');
}

function generateBestItinerariesMarkdown(summary: ReportSummary, entries: ReportEntry[], regression?: string): string {
  const validEntries = entries
    .filter(entry => entry.metrics.planCount > 0)
    .filter(entry => entry.metrics.constraintViolations.length === 0)
    .sort((a, b) => {
      if (b.metrics.overallScore !== a.metrics.overallScore) return b.metrics.overallScore - a.metrics.overallScore;
      return a.metrics.avgTravelTimeMinutes - b.metrics.avgTravelTimeMinutes;
    });

  const topOverall = validEntries.slice(0, 25);
  const topDate = validEntries
    .filter(entry => entry.scenario.groupType.toLowerCase().includes('date'))
    .slice(0, 10);
  const topBudget = validEntries
    .filter(entry => entry.metrics.budgetUtilization <= 0.9)
    .slice(0, 10);
  const topLowTravel = validEntries
    .filter(entry => entry.metrics.avgTravelTimeMinutes > 0)
    .sort((a, b) => {
      if (b.metrics.overallScore !== a.metrics.overallScore) return b.metrics.overallScore - a.metrics.overallScore;
      return a.metrics.avgTravelTimeMinutes - b.metrics.avgTravelTimeMinutes;
    })
    .slice(0, 10);

  const violationRows = Object.entries(summary.violationBreakdown)
    .sort(([, a], [, b]) => b - a)
    .map(([name, count]) => `| ${name} | ${count} |`)
    .join('\n') || '| None | 0 |';

  return [
    `# Hangout Eval Best Itineraries`,
    ``,
    `Generated: ${summary.runAt}`,
    ``,
    `## Run Summary`,
    ``,
    `| Metric | Value |`,
    `| --- | ---: |`,
    `| Scenarios | ${summary.totalScenarios} |`,
    `| Plans generated | ${summary.totalPlansGenerated} |`,
    `| Average score | ${summary.avgOverallScore}/100 |`,
    `| Median score | ${summary.medianOverallScore}/100 |`,
    `| p10 / p90 score | ${summary.p10OverallScore} / ${summary.p90OverallScore} |`,
    `| Budget respect | ${summary.budgetRespectRate}% |`,
    `| Constraint violation rate | ${summary.constraintViolRate}% |`,
    `| Fallback rate | ${summary.fallbackRate}% |`,
    `| Engine fallback rate | ${summary.engineFallbackRate}% |`,
    `| Failure rate | ${summary.failureRate}% |`,
    `| Average travel | ${summary.avgTravelTime} min |`,
    `| Average venue rating | ${summary.avgVenueRating.toFixed(2)} |`,
    ``,
    `## Best Overall Valid Itineraries`,
    ``,
    topOverall.length > 0 ? topOverall.map(planLine).join('\n') : `No violation-free itineraries were generated.`,
    ``,
    `## Best Date Itineraries`,
    ``,
    topDate.length > 0 ? topDate.map(planLine).join('\n') : `No violation-free date itineraries were generated.`,
    ``,
    `## Best Budget-Safe Itineraries`,
    ``,
    topBudget.length > 0 ? topBudget.map(planLine).join('\n') : `No violation-free budget-safe itineraries were generated.`,
    ``,
    `## Best Low-Travel Itineraries`,
    ``,
    topLowTravel.length > 0 ? topLowTravel.map(planLine).join('\n') : `No violation-free low-travel itineraries were generated.`,
    ``,
    `## Most Common Venues`,
    ``,
    `| Venue | Appearances |`,
    `| --- | ---: |`,
    ...summary.mostCommonVenues.slice(0, 20).map(venue => `| ${venue.name} | ${venue.count} |`),
    ``,
    `## Constraint Violations`,
    ``,
    `| Violation | Count |`,
    `| --- | ---: |`,
    violationRows,
    ``,
    summary.unusedZones.length > 0 ? `Unused zones: ${summary.unusedZones.join(', ')}` : `Unused zones: None`,
    ``,
    regression ? `## Regression\n\n\`\`\`\n${regression}\n\`\`\`\n` : ``,
  ].join('\n');
}

function bar(pct: number, color = '#00E1AB'): string {
  const w = Math.round(pct);
  return `<div style="background:#1c1b1b;border-radius:3px;height:10px;width:100%;"><div style="background:${color};border-radius:3px;height:10px;width:${w}%;"></div></div>`;
}

function generateHtml(summary: ReportSummary, entries: ReportEntry[], regression?: string): string {
  const violRows = Object.entries(summary.violationBreakdown).map(([k, v]) =>
    `<tr><td>${k}</td><td>${v}</td><td>${(v / summary.totalScenarios * 100).toFixed(1)}%</td></tr>`
  ).join('');

  const catRows = Object.entries(summary.categoryAppearanceRate).map(([cat, pct]) =>
    `<tr><td>${cat}</td><td>${bar(pct)}</td><td>${pct}%</td></tr>`
  ).join('');

  const venueRows = summary.mostCommonVenues.map(v =>
    `<tr><td>${v.name}</td><td>${v.count}</td></tr>`
  ).join('');

  const budgetRows = Object.entries(summary.budgetPerformance).map(([b, score]) =>
    `<tr><td>${b}</td><td>${bar(score)}</td><td>${score}/100</td></tr>`
  ).join('');

  const worstRows = [...entries]
    .sort((a, b) => a.metrics.overallScore - b.metrics.overallScore)
    .slice(0, 10)
    .map(e => `<tr>
      <td>${e.scenario.id}</td>
      <td>${e.scenario.locationSetName}</td>
      <td>₹${e.scenario.budget}</td>
      <td>${e.scenario.groupType}</td>
      <td>${e.scenario.outingTimeLabel}</td>
      <td style="color:#DC143C">${e.metrics.overallScore}/100</td>
      <td>${e.metrics.constraintViolations.join(', ') || '—'}</td>
      <td>${e.metrics.error ?? (e.metrics.isFallbackOnly ? 'FALLBACK' : '—')}</td>
    </tr>`).join('');

  const scoreHist = buildHistogram(entries.map(e => e.metrics.overallScore), 10, 0, 100);
  const histBars = scoreHist.map(b =>
    `<div style="display:flex;align-items:center;gap:8px;margin:2px 0">
      <span style="width:60px;font-size:11px;color:#999">${b.label}</span>
      <div style="flex:1;background:#1c1b1b;border-radius:2px;height:16px;position:relative">
        <div style="background:#00E1AB;border-radius:2px;height:16px;width:${Math.round(b.pct)}%"></div>
      </div>
      <span style="font-size:11px;color:#999;width:30px">${b.count}</span>
    </div>`
  ).join('');

  const allItinRows = entries.slice(0, 300).map((e, i) => {
    const plan = e.metrics.plans[0];
    const slots = plan?.slots ?? [];
    const slotCell = (idx: number) => slots[idx]
      ? `${slots[idx].name}<br><span style="font-size:9px;color:#666">${slots[idx].category} · ₹${slots[idx].estimatedCostPerHead}</span>`
      : '—';
    const color = e.metrics.overallScore >= 70 ? '#00E1AB' : e.metrics.overallScore >= 50 ? '#aaa' : '#DC143C';
    const viol = e.metrics.constraintViolations.length > 0
      ? `<span style="color:#DC143C;font-size:9px">${e.metrics.constraintViolations[0]}</span>`
      : '<span style="color:#00E1AB;font-size:9px">✓ clean</span>';
    return `<tr>
      <td style="color:#555;font-size:10px">${i + 1}</td>
      <td>${e.scenario.locationSetName}</td>
      <td>₹${e.scenario.budget}</td>
      <td>${e.scenario.groupType}</td>
      <td>${e.scenario.outingTimeLabel}</td>
      <td style="color:${color};font-weight:bold">${e.metrics.overallScore}/100</td>
      <td style="font-size:10px;color:${e.metrics.engineFallback ? '#DC143C' : '#00E1AB'}">${e.metrics.engineFallback ? '⚠ fallback' : '✓ live'}</td>
      <td style="font-size:10px">${plan?.meetupZone ?? '—'}</td>
      <td style="font-size:10px">${slotCell(0)}</td>
      <td style="font-size:10px">${slotCell(1)}</td>
      <td style="font-size:10px">${slotCell(2)}</td>
      <td style="font-size:10px">₹${plan?.totalEstimatedCostPerHead ?? '—'}</td>
      <td>${viol}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hangout Eval Report — ${summary.runAt}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0a0a0a; color: #e0e0e0; font-family: 'Courier New', monospace; font-size: 13px; padding: 24px; }
  h1 { color: #00E1AB; font-size: 20px; margin-bottom: 4px; }
  h2 { color: #DC143C; font-size: 13px; text-transform: uppercase; letter-spacing: 2px; margin: 24px 0 12px; border-bottom: 1px solid #353534; padding-bottom: 6px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 16px; }
  .kpi { background: #1c1b1b; border: 1px solid #353534; border-radius: 6px; padding: 12px; }
  .kpi-val { font-size: 26px; font-weight: bold; color: #00E1AB; }
  .kpi-lab { font-size: 10px; color: #666; text-transform: uppercase; letter-spacing: 1px; margin-top: 4px; }
  .kpi.warn .kpi-val { color: #DC143C; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { background: #1c1b1b; color: #999; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; padding: 6px 10px; text-align: left; border-bottom: 1px solid #353534; }
  td { padding: 6px 10px; border-bottom: 1px solid #1c1b1b; color: #ccc; font-size: 11px; }
  tr:hover td { background: #1c1b1b; }
  .badge { display: inline-block; padding: 2px 6px; border-radius: 3px; font-size: 10px; }
  .badge-ok { background: #00E1AB22; color: #00E1AB; border: 1px solid #00E1AB44; }
  .badge-warn { background: #DC143C22; color: #DC143C; border: 1px solid #DC143C44; }
  pre { background: #1c1b1b; border: 1px solid #353534; border-radius: 6px; padding: 12px; color: #00E1AB; white-space: pre-wrap; font-size: 12px; }
</style>
</head>
<body>
<h1>🔬 Hangout Itinerary Evaluation Report</h1>
<p style="color:#666;font-size:11px;margin:4px 0 16px">${summary.runAt} · ${summary.totalScenarios} scenarios</p>
 
<h2>Executive Summary</h2>
<div class="grid">
  <div class="kpi"><div class="kpi-val">${summary.avgOverallScore}</div><div class="kpi-lab">Avg Quality Score /100</div></div>
  <div class="kpi ${summary.fallbackRate > 5 ? 'warn' : ''}"><div class="kpi-val">${summary.fallbackRate}%</div><div class="kpi-lab">Fallback Rate</div></div>
  <div class="kpi"><div class="kpi-val">${summary.budgetRespectRate}%</div><div class="kpi-lab">Budget Respected</div></div>
  <div class="kpi"><div class="kpi-val">${summary.avgTravelTime}m</div><div class="kpi-lab">Avg Travel Time</div></div>
  <div class="kpi ${summary.failureRate > 2 ? 'warn' : ''}"><div class="kpi-val">${summary.failureRate}%</div><div class="kpi-lab">Failure Rate</div></div>
  <div class="kpi"><div class="kpi-val">${summary.liveFetchRate}%</div><div class="kpi-lab">Live-Fetch Rate</div></div>
  <div class="kpi ${summary.engineFallbackRate > 20 ? 'warn' : ''}"><div class="kpi-val">${summary.engineFallbackRate}%</div><div class="kpi-lab">Engine Fallback Rate</div></div>
  <div class="kpi"><div class="kpi-val">${summary.avgVenueRating.toFixed(1)}★</div><div class="kpi-lab">Avg Venue Rating</div></div>
  <div class="kpi"><div class="kpi-val">${summary.constraintViolRate}%</div><div class="kpi-lab">Constraint Violation Rate</div></div>
</div>

<h2>Score Distribution</h2>
<div style="max-width:500px">${histBars}</div>
<p style="color:#666;font-size:11px;margin-top:8px">p10: ${summary.p10OverallScore} · median: ${summary.medianOverallScore} · p90: ${summary.p90OverallScore}</p>

<h2>Archetype Diversity</h2>
<div class="grid">
  <div class="kpi ${summary.avgStructuralEntropy < 0.7 ? 'warn' : ''}">
    <div class="kpi-val">${(summary.avgStructuralEntropy * 100).toFixed(0)}%</div>
    <div class="kpi-lab">Avg Structural Entropy</div>
  </div>
  <div class="kpi ${summary.fullyDiverseRate < 60 ? 'warn' : ''}">
    <div class="kpi-val">${summary.fullyDiverseRate}%</div>
    <div class="kpi-lab">Fully Diverse (4 distinct families)</div>
  </div>
  <div class="kpi ${summary.preferenceMatchAvg < 60 ? 'warn' : ''}">
    <div class="kpi-val">${summary.preferenceMatchAvg}%</div>
    <div class="kpi-lab">Avg Preference-Match Ratio</div>
  </div>
</div>
<p style="color:#666;font-size:11px;margin-top:8px">Family distribution across all generated plans:</p>
<table><thead><tr><th>Family</th><th>Count</th></tr></thead><tbody>${
  Object.entries(summary.familyDistribution).sort(([, a], [, b]) => b - a).map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')
}</tbody></table>

<h3 style="color:#DC143C;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-top:16px">Family × Group Type</h3>
${familyMatrixHtml(summary.groupTypeFamilyMatrix)}
<h3 style="color:#DC143C;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-top:16px">Family × Time Bucket</h3>
${familyMatrixHtml(summary.timeBucketFamilyMatrix)}
<h3 style="color:#DC143C;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-top:16px">Family × Group Size</h3>
${familyMatrixHtml(summary.sizeBucketFamilyMatrix)}

${regression ? `<h2>Regression vs Previous Run</h2><pre>${regression}</pre>` : ''}

<h2>Worst 10 Itineraries</h2>
<table>
  <thead><tr><th>ID</th><th>Location</th><th>Budget</th><th>Group</th><th>Time</th><th>Score</th><th>Violations</th><th>Error</th></tr></thead>
  <tbody>${worstRows}</tbody>
</table>

<h2>Category Appearance Rate</h2>
<table><thead><tr><th>Category</th><th>Frequency</th><th>Rate</th></tr></thead><tbody>${catRows}</tbody></table>
${summary.unusedZones.length > 0 ? `<p style="color:#DC143C;margin-top:8px;font-size:11px">⚠ Zones never receiving plans: ${summary.unusedZones.join(', ')}</p>` : ''}

<h2>Most Common Venues</h2>
<table><thead><tr><th>Venue</th><th>Appearances</th></tr></thead><tbody>${venueRows}</tbody></table>

<h2>Budget Performance</h2>
<table><thead><tr><th>Budget</th><th>Avg Score</th><th></th></tr></thead><tbody>${budgetRows}</tbody></table>

<h2>Constraint Violations</h2>
${Object.keys(summary.violationBreakdown).length === 0
  ? '<p style="color:#00E1AB">✓ No constraint violations detected</p>'
  : `<table><thead><tr><th>Violation Type</th><th>Count</th><th>Rate</th></tr></thead><tbody>${violRows}</tbody></table>`}

<h2>All Generated Itineraries (first 300)</h2>
<table id="all-plans" style="font-size:11px">
  <thead><tr>
    <th>#</th><th>Location</th><th>Budget</th><th>Group</th><th>Time</th>
    <th>Score</th><th>Source</th><th>Zone</th>
    <th>Stop 1</th><th>Stop 2</th><th>Stop 3</th>
    <th>Cost/head</th><th>Violations</th>
  </tr></thead>
  <tbody>${allItinRows}</tbody>
</table>

<h2>Suggested Improvements</h2>
<ul style="color:#999;font-size:12px;padding-left:16px;line-height:2">
${summary.fallbackRate > 10 ? '<li style="color:#DC143C">⚠ HIGH FALLBACK RATE — run bootstrap discovery for all zones</li>' : ''}
${summary.budgetRespectRate < 80 ? '<li style="color:#DC143C">⚠ BUDGET VIOLATIONS — tighten cost estimation in reactive fetch</li>' : ''}
${summary.unusedZones.length > 0 ? `<li>Zones never used: ${summary.unusedZones.join(', ')} — consider seeding their discovery queues</li>` : ''}
${Object.entries(summary.categoryAppearanceRate).filter(([, r]) => r < 5).map(([cat]) => `<li>${cat} rarely appears — check discovery coverage for this category</li>`).join('')}
${summary.avgTravelTime > 45 ? '<li>Average travel time is high — consider tightening zone scoring weights</li>' : ''}
<li>Run <code>npx tsx eval/run.ts --regression</code> to compare against this run after next planner change</li>
</ul>

<p style="color:#333;font-size:10px;margin-top:32px">Generated by Hangout eval framework · ${summary.runAt}</p>
</body>
</html>`;
}

function familyMatrixHtml(matrix: Record<string, Record<string, number>>): string {
  const rows = Object.keys(matrix);
  if (rows.length === 0) return '<p style="color:#666;font-size:11px">No data.</p>';
  const cols = Array.from(new Set(rows.flatMap(r => Object.keys(matrix[r])))).sort();
  const head = ['<tr><th></th>', ...cols.map(c => `<th>${c}</th>`), '</tr>'].join('');
  const body = rows.map(r => {
    const total = cols.reduce((s, c) => s + (matrix[r][c] ?? 0), 0);
    const cells = cols.map(c => {
      const v = matrix[r][c] ?? 0;
      const pct = total > 0 ? Math.round((v / total) * 100) : 0;
      const color = pct >= 30 ? '#00E1AB' : pct >= 15 ? '#e0e0e0' : '#666';
      return `<td style="color:${color}">${v} <span style="color:#555;font-size:9px">(${pct}%)</span></td>`;
    }).join('');
    return `<tr><td style="color:#999;font-weight:bold">${r}</td>${cells}</tr>`;
  }).join('');
  return `<table><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

function buildHistogram(values: number[], buckets: number, min: number, max: number) {
  const step = (max - min) / buckets;
  const counts = Array(buckets).fill(0);
  for (const v of values) {
    const i = Math.min(buckets - 1, Math.floor((v - min) / step));
    counts[i]++;
  }
  const maxCount = Math.max(...counts, 1);
  return counts.map((count, i) => ({
    label: `${Math.round(min + i * step)}–${Math.round(min + (i + 1) * step)}`,
    count,
    pct: (count / maxCount) * 100,
  }));
}
