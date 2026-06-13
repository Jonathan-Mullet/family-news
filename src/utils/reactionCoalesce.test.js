const { test } = require('node:test');
const assert = require('node:assert/strict');
const { summarizeReactors, ReactionBuffer } = require('./reactionCoalesce');

test('summarizeReactors: single reactor names the emoji', () => {
  assert.equal(
    summarizeReactors([{ name: 'Emily', emoji: '❤️' }], 'comment'),
    'Emily reacted ❤️ to your comment'
  );
});
test('summarizeReactors: many reactors collapse to "+N others"', () => {
  const r = [{ name: 'Emily', emoji: '❤️' }, { name: 'Bob', emoji: '👍' }, { name: 'Cy', emoji: '😂' }];
  assert.equal(summarizeReactors(r, 'post'), 'Emily + 2 others reacted to your post');
});
test('summarizeReactors: de-dups the same actor (latest emoji wins) before counting', () => {
  const r = [{ name: 'Emily', emoji: '❤️' }, { name: 'Emily', emoji: '👍' }];
  assert.equal(summarizeReactors(r, 'comment'), 'Emily reacted 👍 to your comment');
});

test('ReactionBuffer: accumulates actors and flushes once after quiet window', () => {
  let nowMs = 1000;
  const flushed = [];
  const buf = new ReactionBuffer({ quietMs: 30000, capMs: 300000, now: () => nowMs, onFlush: (items) => flushed.push(items) });
  buf.add('k', { name: 'Emily', emoji: '❤️' }); nowMs += 10000;
  buf.add('k', { name: 'Bob', emoji: '👍' });   nowMs += 10000;
  buf.tick(); // not quiet yet (10s since last add)
  assert.equal(flushed.length, 0);
  nowMs += 31000; buf.tick(); // quiet window elapsed
  assert.equal(flushed.length, 1);
  assert.equal(flushed[0].length, 2);
});
test('ReactionBuffer: hard cap flushes even while still busy', () => {
  let nowMs = 0;
  const flushed = [];
  const buf = new ReactionBuffer({ quietMs: 30000, capMs: 300000, now: () => nowMs, onFlush: (i) => flushed.push(i) });
  for (let i = 0; i < 20; i++) { buf.add('k', { name: 'U' + i, emoji: '❤️' }); nowMs += 20000; buf.tick(); }
  assert.ok(flushed.length >= 1, 'cap forced at least one flush within the busy window');
});
test('ReactionBuffer: drop removes a pending actor before flush', () => {
  let nowMs = 0; const flushed = [];
  const buf = new ReactionBuffer({ quietMs: 30000, capMs: 300000, now: () => nowMs, onFlush: (i) => flushed.push(i) });
  buf.add('k', { name: 'Emily', emoji: '❤️' });
  buf.drop('k', 'Emily');
  nowMs += 31000; buf.tick();
  assert.equal(flushed.length, 0, 'no flush when the only actor was dropped');
});
