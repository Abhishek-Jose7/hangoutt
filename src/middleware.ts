import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { isAdminEmail } from '@/lib/auth/adminEmails';

// Define public routes that do not require authentication
const isPublicRoute = createRouteMatcher([
  '/',
  '/join(.*)',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/health/db',
  '/api/webhooks/clerk(.*)',
  '/api/places/photo(.*)',
  '/share/(.*)',
  '/api/share/(.*)',
]);

const isAdminRoute = createRouteMatcher([
  '/admin(.*)',
]);

export default clerkMiddleware(async (auth, req) => {
  if (isAdminRoute(req)) {
    const session = await auth();
    if (!session.userId) {
      await auth.protect();
    }

    const claims = session.sessionClaims as Record<string, any> | null;
    const claimEmail =
      claims?.email ||
      claims?.email_address ||
      claims?.primary_email_address ||
      claims?.['https://clerk.dev/email'];

    let userEmail = claimEmail ? String(claimEmail) : null;

    if (!userEmail && session.userId) {
      try {
        const { clerkClient } = await import('@clerk/nextjs/server');
        const client = await clerkClient();
        const clerkUser = await client.users.getUser(session.userId);
        userEmail = clerkUser.emailAddresses[0]?.emailAddress || null;
      } catch (err) {
        console.error('Error fetching clerk user email in middleware:', err);
      }
    }

    if (!isAdminEmail(userEmail)) {
      return NextResponse.redirect(new URL('/', req.url));
    }
  } else if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html|css|js(?!on)|jpeg|jpg|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};
