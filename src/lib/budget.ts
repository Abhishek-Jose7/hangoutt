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
 * Calculate per-person cap (minimum budget in the group)
 */
export function calculatePerPersonCap(budgets: (number | null)[]): number {
  const valid = budgets.filter((b): b is number => b !== null && b > 0);
  if (valid.length === 0) return 500;
  return Math.min(...valid);
}
