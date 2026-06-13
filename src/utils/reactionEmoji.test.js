const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ALLOWED_EMOJI, QUICK_EMOJI, isAllowedEmoji } = require('./reactionEmoji');

test('allowlist contains the canonical 21 emojis', () => {
  assert.equal(ALLOWED_EMOJI.length, 21);
  assert.ok(ALLOWED_EMOJI.includes('❤️'));
});
test('quick set is the 6 iMessage-style emojis, all within the allowlist', () => {
  assert.deepEqual(QUICK_EMOJI, ['❤️', '👍', '😂', '😮', '😢', '🙏']);
  QUICK_EMOJI.forEach(e => assert.ok(ALLOWED_EMOJI.includes(e)));
});
test('isAllowedEmoji rejects non-listed input', () => {
  assert.equal(isAllowedEmoji('❤️'), true);
  assert.equal(isAllowedEmoji('🦄'), false);
  assert.equal(isAllowedEmoji(''), false);
});
