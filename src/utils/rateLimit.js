/**
 * Tiny in-memory fixed-window rate limiter (no dependencies).
 *
 * Designed for login / forgot-password brute-force protection:
 *   - `consume(key)` returns true while the key has attempts left in the
 *     current window, false once the limit is exceeded.
 *   - `reset(key)` clears a key (call on successful login so legitimate
 *     users never accumulate strikes).
 *   - The Map is LRU-capped at `maxEntries` so a flood of unique keys
 *     (spoofed IPs / emails) cannot grow memory without bound.
 *   - A periodic sweep drops expired windows; the interval is unref()'d so
 *     it never keeps the process alive.
 *
 * Single-process only by design — this app runs as one Node process in one
 * container, so no shared store is needed.
 */

/**
 * Create an independent rate limiter.
 *
 * @param {object} [options]
 * @param {number} [options.max=10]            Allowed attempts per window.
 * @param {number} [options.windowMs=900000]   Window length (default 15 min).
 * @param {number} [options.maxEntries=10000]  LRU cap on tracked keys.
 * @param {number} [options.sweepIntervalMs=60000] Expired-entry sweep cadence.
 * @param {() => number} [options.now=Date.now] Clock, injectable for tests.
 * @returns {{ consume(key: string): boolean, reset(key: string): void,
 *             sweep(): void, size(): number, stop(): void }}
 */
function createRateLimiter({
  max = 10,
  windowMs = 15 * 60 * 1000,
  maxEntries = 10000,
  sweepIntervalMs = 60 * 1000,
  now = Date.now,
} = {}) {
  // key -> { start: windowStartMs, count: attemptsInWindow }
  // Map iteration order doubles as LRU order: entries are re-inserted on
  // every touch, so the first key is always the least recently used.
  const buckets = new Map();

  function consume(key) {
    const t = now();
    let bucket = buckets.get(key);
    if (bucket) buckets.delete(key); // re-insert below to refresh LRU position
    if (!bucket || t - bucket.start >= windowMs) {
      bucket = { start: t, count: 0 }; // new or expired window
    }
    bucket.count += 1;
    buckets.set(key, bucket);
    if (buckets.size > maxEntries) {
      // Evict the least recently used key to honor the memory cap.
      buckets.delete(buckets.keys().next().value);
    }
    return bucket.count <= max;
  }

  function reset(key) {
    buckets.delete(key);
  }

  function sweep() {
    const t = now();
    for (const [key, bucket] of buckets) {
      if (t - bucket.start >= windowMs) buckets.delete(key);
    }
  }

  function size() {
    return buckets.size;
  }

  const timer = setInterval(sweep, sweepIntervalMs);
  // Never keep the process alive just for the sweeper.
  if (typeof timer.unref === 'function') timer.unref();

  function stop() {
    clearInterval(timer);
  }

  return { consume, reset, sweep, size, stop };
}

module.exports = { createRateLimiter };
