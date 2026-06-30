// eval/run.ts — Hangout Itinerary Engine Evaluation Framework
//
// Usage:
//   npx tsx --tsconfig eval/tsconfig.json eval/run.ts
//   npx tsx --tsconfig eval/tsconfig.json eval/run.ts --sample 50
//   npx tsx --tsconfig eval/tsconfig.json eval/run.ts --regression

import { generateScenarios } from './scenarios';
import { runScenario } from './runner';
import { computeMetrics } from './metrics';
import { buildSummary, writeReports, type ReportEntry } from './report';
import { compareReports } from './regression';

const args = process.argv.slice(2);
const sampleArg = args.find(a => a.startsWith('--sample=') || a === '--sample');
const sampleCount = sampleArg
  ? parseInt(args[args.indexOf('--sample') + 1] ?? sampleArg.split('=')[1] ?? '750', 10)
  : 750;
const doRegression = args.includes('--regression');

async function main() {
  console.log(`\n🔬  Hangout Eval Framework`);
  console.log(`    Scenarios: ${sampleCount} | Regression: ${doRegression}\n`);

  const scenarios = generateScenarios(sampleCount);
  const entries: ReportEntry[] = [];

  let completed = 0;
  let failed = 0;
  let fallback = 0;

  const BATCH = 5; // Run in batches to avoid overwhelming the DB
  for (let i = 0; i < scenarios.length; i += BATCH) {
    const batch = scenarios.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(async s => {
      const result = await runScenario(s);
      const metrics = computeMetrics(s, result.plans, result.durationMs, result.usedFallback, result.error);
      return { scenario: s, metrics };
    }));

    for (const entry of results) {
      entries.push(entry);
      if (entry.metrics.error || entry.metrics.planCount === 0) failed++;
      else if (entry.metrics.isFallbackOnly) fallback++;
      completed++;
    }

    // Progress update every 50
    if (completed % 50 === 0 || completed === scenarios.length) {
      const pct = Math.round(completed / scenarios.length * 100);
      const avgScore = entries.reduce((s, e) => s + e.metrics.overallScore, 0) / entries.length;
      process.stdout.write(`\r  [${completed}/${scenarios.length}] ${pct}% · avg score ${avgScore.toFixed(1)} · failures ${failed} · fallbacks ${fallback}   `);
    }
  }

  console.log('\n');

  const summary = buildSummary(entries);

  let regressionText: string | undefined;
  const tempPath = `eval/reports/tmp_${Date.now()}.json`;
  const { writeFileSync, mkdirSync } = await import('fs');
  mkdirSync('eval/reports', { recursive: true });
  writeFileSync(tempPath, JSON.stringify({ summary, entries }, null, 2));

  if (doRegression) {
    const reg = compareReports(tempPath);
    if (reg) {
      regressionText = reg.summary;
      console.log('📊 Regression vs previous run:\n');
      console.log(reg.summary);
      console.log();
    } else {
      console.log('ℹ  No previous report found for regression comparison.\n');
    }
  }

  // Clean up temp file (real report written by writeReports)
  const { unlinkSync } = await import('fs');
  try { unlinkSync(tempPath); } catch {}

  const htmlPath = writeReports(entries, summary, regressionText);

  // Print executive summary
  console.log('━'.repeat(60));
  console.log(`  📊  Evaluation Complete`);
  console.log(`  Scenarios     : ${summary.totalScenarios}`);
  console.log(`  Plans gen.    : ${summary.totalPlansGenerated}`);
  console.log(`  Quality score : ${summary.avgOverallScore}/100 avg  (p10: ${summary.p10OverallScore}  p90: ${summary.p90OverallScore})`);
  console.log(`  Fallback rate : ${summary.fallbackRate}%`);
  console.log(`  Budget respect: ${summary.budgetRespectRate}%`);
  console.log(`  Avg travel    : ${summary.avgTravelTime} min`);
  console.log(`  Violations    : ${summary.constraintViolRate}%`);
  console.log(`  Failure rate  : ${summary.failureRate}%`);
  if (summary.unusedZones.length > 0) {
    console.log(`  ⚠ Unused zones: ${summary.unusedZones.join(', ')}`);
  }
  if (summary.fallbackRate > 10) {
    console.log(`  ⚠ HIGH FALLBACK RATE — run bootstrap discovery`);
  }
  console.log('━'.repeat(60));
  console.log(`\n  HTML report → ${htmlPath}\n`);
}

main().catch(err => {
  console.error('\n❌ Eval framework error:', err);
  process.exit(1);
});
