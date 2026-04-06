/**
 * Budget label mapping for Tavily search queries.
 */
export function getBudgetLabel(budget: number): string {
  if (budget <= 300) return 'budget-friendly';
  if (budget <= 800) return 'mid-range';
  return 'premium';
}

/**
 * Calculate average budget from an array of budgets (ignoring nulls)
 */
export function calculateAverageBudget(budgets: (number | null)[]): number {
  const valid = budgets.filter((b): b is number => b !== null && b > 0);
  if (valid.length === 0) return 500; // sensible default
  return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
}

/**
 * Calculate per-person cap using a conservative strategy:
 * - respect the minimum member budget, and
 * - avoid overfitting to outliers with a safe-average floor.
 */
export function calculatePerPersonCap(budgets: (number | null)[]): number {
  const valid = budgets.filter((b): b is number => b !== null && b > 0);
  if (valid.length === 0) return 500;

  const minBudget = Math.min(...valid);
  const average = Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
  const safeAverage = Math.round(average * 0.82);

  // Usually anchored by the minimum, but protected from a single extreme low outlier.
  return Math.max(minBudget, safeAverage);
}
