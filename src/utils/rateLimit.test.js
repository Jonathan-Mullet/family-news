const { test } = require('node:test');
const assert = require('node:assert');
const { createRateLimiter } = require('./rateLimit');

// Helper: limiter with a fake clock we can advance manually.
function makeLimiter(opts = {}) {
  let clock = 0;
  const limiter = createRateLimiter({ now: () => clock, ...opts });
  limiter.stop(); // tests drive sweep() manually; no background timer needed
  return { limiter, advance: (ms) => { clock += ms; } };
}

test('allows up to max attempts then blocks', () => {
  const { limiter } = makeLimiter({ max: 3, windowMs: 1000 });
  assert.equal(limiter.consume('k'), true);
  assert.equal(limiter.consume('k'), true);
  assert.equal(limiter.consume('k'), true);
  assert.equal(limiter.consume('k'), false);
  assert.equal(limiter.consume('k'), false);
});

test('keys are independent', () => {
  const { limiter } = makeLimiter({ max: 1, windowMs: 1000 });
  assert.equal(limiter.consume('a'), true);
  assert.equal(limiter.consume('a'), false);
  assert.equal(limiter.consume('b'), true);
});

test('window expiry restores attempts', () => {
  const { limiter, advance } = makeLimiter({ max: 2, windowMs: 1000 });
  assert.equal(limiter.consume('k'), true);
  assert.equal(limiter.consume('k'), true);
  assert.equal(limiter.consume('k'), false);
  advance(999);
  assert.equal(limiter.consume('k'), false, 'still inside the window');
  advance(1);
  assert.equal(limiter.consume('k'), true, 'window expired — fresh bucket');
});

test('blocked attempts do not extend the window (fixed window, not sliding)', () => {
  const { limiter, advance } = makeLimiter({ max: 1, windowMs: 1000 });
  assert.equal(limiter.consume('k'), true);
  advance(500);
  assert.equal(limiter.consume('k'), false); // strike inside window
  advance(500); // 1000ms after the window STARTED
  assert.equal(limiter.consume('k'), true);
});

test('reset clears the bucket (successful login)', () => {
  const { limiter } = makeLimiter({ max: 2, windowMs: 1000 });
  limiter.consume('k');
  limiter.consume('k');
  assert.equal(limiter.consume('k'), false);
  limiter.reset('k');
  assert.equal(limiter.consume('k'), true);
});

test('LRU cap evicts the least recently used key', () => {
  const { limiter } = makeLimiter({ max: 5, windowMs: 1000, maxEntries: 2 });
  limiter.consume('a');
  limiter.consume('b');
  limiter.consume('a'); // touch a — b is now LRU
  limiter.consume('c'); // exceeds cap of 2 — evicts b
  assert.equal(limiter.size(), 2);
  // b was evicted, so it starts a fresh bucket; a kept its count.
  limiter.consume('b');
  assert.equal(limiter.size(), 2, 'cap still enforced after re-adding b');
});

test('size never exceeds maxEntries under a key flood', () => {
  const { limiter } = makeLimiter({ max: 10, windowMs: 1000, maxEntries: 100 });
  for (let i = 0; i < 1000; i++) limiter.consume(`ip-${i}`);
  assert.equal(limiter.size(), 100);
});

test('sweep removes expired entries only', () => {
  const { limiter, advance } = makeLimiter({ max: 5, windowMs: 1000 });
  limiter.consume('old');
  advance(600);
  limiter.consume('fresh');
  advance(400); // old is 1000ms stale, fresh is 400ms old
  limiter.sweep();
  assert.equal(limiter.size(), 1);
  // old got swept — consuming it starts over.
  assert.equal(limiter.consume('old'), true);
});

test('default options block the 11th attempt within 15 minutes', () => {
  const { limiter, advance } = makeLimiter(); // max 10, window 15 min
  for (let i = 0; i < 10; i++) {
    assert.equal(limiter.consume('k'), true, `attempt ${i + 1} allowed`);
  }
  assert.equal(limiter.consume('k'), false, '11th attempt blocked');
  advance(15 * 60 * 1000);
  assert.equal(limiter.consume('k'), true, 'allowed again after 15 min');
});

test('stop() is idempotent and sweep still callable after stop', () => {
  const limiter = createRateLimiter({ max: 1 });
  limiter.stop();
  limiter.stop();
  limiter.consume('k');
  limiter.sweep();
  assert.equal(limiter.size(), 1);
});
