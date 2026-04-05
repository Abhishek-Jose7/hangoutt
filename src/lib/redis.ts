import { Redis } from '@upstash/redis';

let redis: Redis | null = null;

export function getRedis(): Redis | null {
  if (redis) return redis;
  
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  
  if (!url || !token) {
    console.warn('[Redis] Missing UPSTASH env variables — caching disabled');
    return null;
  }
  
  try {
    redis = new Redis({ url, token });
    return redis;
  } catch (err) {
    console.error('[Redis] Init failed:', err);
    return null;
  }
}

/**
 * Safe cache get — returns null on any error
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  const r = getRedis();
  if (!r) return null;
  try {
    return await r.get<T>(key);
  } catch (err) {
    console.error('[Redis] GET error:', err);
    return null;
  }
}

/**
 * Safe cache set — silently fails on error
 */
export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await r.set(key, value, { ex: ttlSeconds });
  } catch (err) {
    console.error('[Redis] SET error:', err);
  }
}

/**
 * Safe increment — returns the new count or null on error
 */
export async function cacheIncr(key: string, ttlSeconds?: number): Promise<number | null> {
  const r = getRedis();
  if (!r) return null;
  try {
    const val = await r.incr(key);
    if (ttlSeconds) {
      await r.expire(key, ttlSeconds);
    }
    return val;
  } catch (err) {
    console.error('[Redis] INCR error:', err);
    return null;
  }
}
