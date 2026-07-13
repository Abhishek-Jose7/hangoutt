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

  // Serverless hosts (Vercel, Netlify Functions, AWS Lambda) have a
  // read-only bundle at cwd but a writable /tmp. Copy the bundled seed
  // once at cold start so reads AND writes work. Writes are ephemeral per
  // instance — that's fine, the source of truth is D1 via the worker;
  // local.db here is used for the places/venues catalog reads and a few
  // tracking-metric upserts.
  const runtime = '/tmp/local.db';
  const bundled = path.resolve(process.cwd(), 'local.db');

  const isServerlessRO = process.env.VERCEL === '1'
    || process.env.AWS_LAMBDA_FUNCTION_NAME
    || process.env.NETLIFY === 'true';

  if (isServerlessRO) {
    try {
      if (!fs.existsSync(runtime) && fs.existsSync(bundled)) {
        fs.copyFileSync(bundled, runtime);
      }
      if (fs.existsSync(runtime)) return runtime;
    } catch (err: any) {
      console.warn('[db/client] serverless copy to /tmp failed:', err?.message ?? err);
    }
  }

  return bundled;
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
