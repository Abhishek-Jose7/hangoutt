import { drizzle as drizzleD1 } from 'drizzle-orm/d1';
import { drizzle as drizzleBetterSqlite } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './schema';

export type DbClient = ReturnType<typeof drizzleBetterSqlite<typeof schema>> | ReturnType<typeof drizzleD1<typeof schema>>;

let dbInstance: any = null;

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
  const dbPath = process.env.DB_LOCAL_PATH || './local.db';
  const sqlite = new Database(dbPath);
  
  // Performance optimization for SQLite
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  
  dbInstance = drizzleBetterSqlite(sqlite, { schema });
  return dbInstance;
}

export const db: any = getDb();
export * as schema from './schema';
