/**
 * Canonical admin allowlist. Single source of truth used by:
 *   - src/actions/admin.ts  (admin-only server actions)
 *   - src/middleware.ts     (route gating for /admin/*)
 *   - src/lib/services/rateLimit.ts (bypasses all rate limits)
 *   - src/app/api/admin/usage/route.ts (dashboard auth)
 *
 * Adding an email here grants full admin access.
 */
export const ADMIN_EMAILS: ReadonlySet<string> = new Set([
  'abhishekjose780@gmail.com',
  'johannjoseph232006@gmail.com',
]);

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.has(email.toLowerCase());
}
