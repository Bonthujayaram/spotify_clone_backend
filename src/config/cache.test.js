import test from 'node:test';
import assert from 'node:assert/strict';

// No REDIS_URL here, so this exercises the in-memory path -- which is also what
// runs in production whenever Redis is absent or unreachable.
delete process.env.REDIS_URL;

const { cacheGet, cacheSet, cacheBackend, __memory, __memorySet } = await import('./cache.js');

test('cache', async (t) => {
  t.beforeEach(() => __memory.clear());

  await t.test('round-trips a value', async () => {
    await cacheSet('k', { hello: 'world' }, 60);
    assert.deepEqual(await cacheGet('k'), { hello: 'world' });
  });

  await t.test('misses return null, not undefined', async () => {
    assert.equal(await cacheGet('nope'), null);
  });

  await t.test('expired entries are dropped', async () => {
    __memorySet('stale', 'value', -1); // already past its expiry
    assert.equal(await cacheGet('stale'), null);
    assert.equal(__memory.has('stale'), false, 'expired key should be evicted on read');
  });

  await t.test('a cached null is a hit, not a miss', async () => {
    // The lyrics route caches {lyrics: null} for tracks with no lyrics. If that
    // read as a miss, every play would re-hit both external APIs.
    await cacheSet('miss-cache', { lyrics: null }, 60);
    assert.deepEqual(await cacheGet('miss-cache'), { lyrics: null });
  });

  await t.test('evicts oldest entries past the cap', async () => {
    for (let i = 0; i < 520; i += 1) __memorySet(`k${i}`, i, 60);
    assert.ok(__memory.size <= 500, `expected <=500 entries, got ${__memory.size}`);
    assert.equal(__memory.has('k0'), false, 'oldest key should have been evicted');
    assert.equal(__memory.has('k519'), true, 'newest key should survive');
  });

  await t.test('reports the memory backend when Redis is not configured', () => {
    assert.equal(cacheBackend(), 'memory');
  });
});
