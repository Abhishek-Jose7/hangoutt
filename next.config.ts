import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Bundle the SQLite seed with any API route that might touch the planner.
  // On Vercel this file is copied into /var/task alongside the compiled JS,
  // then getDb() copies it to /tmp for read/write use.
  // Broadest glob so every route (Pages, App, API, RSC) has access to the
  // bundled seed. Next.js only traces JS imports; local.db is opened at
  // runtime by better-sqlite3, so we have to tell it explicitly.
  outputFileTracingIncludes: {
    '**/*': ['./local.db'],
    'app/**/*': ['./local.db'],
    'api/**/*': ['./local.db'],
    '/api/itinerary/generate': ['./local.db'],
  },
};

export default nextConfig;
