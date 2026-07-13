import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Bundle the SQLite seed with any API route that might touch the planner.
  // On Vercel this file is copied into /var/task alongside the compiled JS,
  // then getDb() copies it to /tmp for read/write use.
  outputFileTracingIncludes: {
    '/api/**/*': ['./local.db'],
    '/**/*': ['./local.db'],
  },
};

export default nextConfig;
