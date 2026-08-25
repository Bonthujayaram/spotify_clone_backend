import Redis from 'ioredis';

/**
 * Small read-through cache.
 *
 * Uses Redis when REDIS_URL is set, otherwise an in-process Map. The fallback
 * is not a lesser option for a single Render instance -- it is the same hit
 * rate with no network hop. Redis earns its keep once there is more than one
 * instance, or when you want the cache to survive a restart/redeploy.
 *
 * Every operation is best-effort: a cache failure must never turn into a
 * request failure, so errors are swallowed and the caller just does the work.
 */

const MEMORY_MAX_ENTRIES = 500;

// key -> { value, expiresAt }
const memory = new Map();

let redis = null;
let redisWarned = false;

if (process.env.REDIS_URL) {
  redis = new Redis(process.env.REDIS_URL, {
    // Don't let a slow/absent Redis hold requests open.
    connectTimeout: 3000,
    commandTimeout: 1000,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: false,
    retryStrategy: (times) => Math.min(times * 500, 5000),
  });

  redis.on('error', (error) => {
    // ioredis retries on its own; log once so a broken URL is visible without
    // filling the logs on every reconnect attempt.
    if (!redisWarned) {
      redisWarned = true;
      console.error('Redis unavailable, falling back to in-memory cache:', error.message);
    }
  });

  redis.on('ready', () => {
    redisWarned = false;
    console.log('Redis connected');
  });
}

const memoryGet = (key) => {
  const entry = memory.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    memory.delete(key);
    return null;
  }
  // Re-insert so Map iteration order approximates least-recently-used.
  memory.delete(key);
  memory.set(key, entry);
  return entry.value;
};

const memorySet = (key, value, ttlSeconds) => {
  if (memory.size >= MEMORY_MAX_ENTRIES) {
    // ponytail: evict the oldest single entry. Fine at this cap; swap for a
    // real LRU only if the cache ever grows past a few thousand keys.
    const oldest = memory.keys().next().value;
    if (oldest !== undefined) memory.delete(oldest);
  }
  memory.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
};

/** Returns the cached JSON value, or null on a miss or any error. */
export const cacheGet = async (key) => {
  if (redis?.status === 'ready') {
    try {
      const raw = await redis.get(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      // Fall through to memory rather than failing the request.
    }
  }
  return memoryGet(key);
};

/** Best-effort write. Never throws. */
export const cacheSet = async (key, value, ttlSeconds) => {
  memorySet(key, value, ttlSeconds);

  if (redis?.status === 'ready') {
    try {
      await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch {
      // The in-memory copy above is still a valid cache.
    }
  }
};

export const cacheBackend = () => (redis?.status === 'ready' ? 'redis' : 'memory');

// Exported for tests.
export const __memory = memory;
export const __memoryGet = memoryGet;
export const __memorySet = memorySet;
