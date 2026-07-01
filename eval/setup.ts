// Intercept module resolution BEFORE any Next.js modules are imported.
// This makes 'server-only' resolve to our empty mock so planners can run in Node.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Module = require('module') as any;
const originalResolve = Module._resolveFilename;

Module._resolveFilename = function (request: string, ...args: any[]) {
  if (request === 'server-only') {
    // Return the path to our mock so Node caches it under this key
    return require.resolve('./mocks/server-only');
  }
  return originalResolve.call(this, request, ...args);
};

// Load env configuration from .env files
try {
  const { loadEnvConfig } = require('@next/env');
  loadEnvConfig(process.cwd());
} catch (err) {
  console.warn('Warning: Failed to load env variables using @next/env:', err);
}

// Ensure eval runs as test environment
if (!process.env.NODE_ENV) {
  (process.env as any).NODE_ENV = 'test';
}

