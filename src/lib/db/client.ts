import { drizzle as drizzleD1 } from 'drizzle-orm/d1';
import { drizzle as drizzleBetterSqlite } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import * as schema from './schema';

export type DbClient = ReturnType<typeof drizzleBetterSqlite<typeof schema>> | ReturnType<typeof drizzleD1<typeof schema>>;

let dbInstance: any = null;

function resolveLocalDbPath(): string {
  const configuredPath = process.env.DB_LOCAL_PATH;
  if (configuredPath) {
    return path.isAbsolute(configuredPath)
      ? configuredPath
      : path.resolve(process.cwd(), configuredPath);
  }

  const isServerlessRO = process.env.VERCEL === '1'
    || Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME)
    || process.env.NETLIFY === 'true';

  // Look for the bundled local.db in a few candidate locations. Next.js
  // outputFileTracing sometimes places included files at cwd, sometimes at
  // the project root under .next/server/, and Vercel's launcher can chdir
  // between them. Trying each avoids a single point of failure.
  const candidates = [
    path.resolve(process.cwd(), 'local.db'),
    path.resolve(process.cwd(), '.next/server/local.db'),
    path.resolve(process.cwd(), '..', 'local.db'),
    '/var/task/local.db',
    '/var/task/.next/server/local.db',
  ];

  const bundled = candidates.find(p => {
    try { return fs.existsSync(p); } catch { return false; }
  });

  if (isServerlessRO) {
    const runtime = '/tmp/local.db';
    try {
      if (!fs.existsSync(runtime) && bundled) {
        fs.copyFileSync(bundled, runtime);
        console.log(`[db/client] seeded /tmp/local.db from ${bundled}`);
      }
      if (fs.existsSync(runtime)) return runtime;
    } catch (err: any) {
      console.warn('[db/client] serverless copy to /tmp failed:', err?.message ?? err);
    }
  }

  if (bundled) return bundled;

  // Nothing found — log every candidate we tried so it's easy to see in
  // production what's missing. Return the first candidate (better-sqlite3
  // will throw a legible error).
  console.error('[db/client] local.db not found. Tried:', candidates.join(', '));
  console.error('[db/client] cwd =', process.cwd(), 'VERCEL =', process.env.VERCEL);
  return candidates[0];
}

export function getDb(): DbClient {
  if (dbInstance) return dbInstance;

  // In Cloudflare Workers/Pages, D1 is bound as env.DB.
  // We check process.env.DB or a global env.DB if available.
  const d1Binding = (process.env as any).DB;

  if (d1Binding && typeof d1Binding.prepare === 'function') {
    dbInstance = drizzleD1(d1Binding, { schema });
    return dbInstance;
  }

  // Fallback to local better-sqlite3
  const dbPath = resolveLocalDbPath();
  const dbDir = path.dirname(dbPath);
  try {
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
  } catch {}

  const sqlite = new Database(dbPath);

  // Performance optimization for SQLite
  try {
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('synchronous = NORMAL');
  } catch {
    // WAL requires write access to the directory. If it fails (read-only
    // bundle path), fall back silently — DELETE journal still works.
  }

  dbInstance = drizzleBetterSqlite(sqlite, { schema });
  return dbInstance;
}

export const db: any = new Proxy(
  {},
  {
    get(_target, prop) {
      const realDb = getDb() as any;
      const value = Reflect.get(realDb, prop, realDb);
      return typeof value === 'function' ? value.bind(realDb) : value;
    },
  }
);

export async function safeTransaction<T>(callback: (tx: any) => Promise<T> | T): Promise<T> {
  const d1Binding = (process.env as any).DB;
  if (d1Binding && typeof d1Binding.prepare === 'function') {
    return await db.transaction(callback);
  }
  // Fallback for better-sqlite3: execute the callback directly with db (synchronously/sequentially)
  return await callback(db);
}

export * as schema from './schema';
