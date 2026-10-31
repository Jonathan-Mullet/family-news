const { test } = require('node:test');
const assert = require('node:assert');
const { planCommentNotifications } = require('./commentNotify');

const plan = (o) => Object.fromEntries(planCommentNotifications({ actorId: 1, postAuthorId: 2, parentAuthorId: null, participantIds: [], mentionedIds: [], ...o }));

test('one notification per person, most specific reason wins', () => {
  // Post author who also wrote the comment being replied to, and is mentioned: just "mention".
  assert.deepStrictEqual(plan({ parentAuthorId: 2, mentionedIds: [2] }), { 2: 'mention' });
  // Post author who wrote the parent comment: "reply", not "comment" too.
  assert.deepStrictEqual(plan({ parentAuthorId: 2 }), { 2: 'reply' });
  // A participant who is mentioned: "mention", not "also commented".
  assert.deepStrictEqual(plan({ participantIds: [3, 4], mentionedIds: [3] }), { 2: 'comment', 3: 'mention', 4: 'participant' });
});

test('the commenter never notifies themself', () => {
  assert.deepStrictEqual(plan({ postAuthorId: 1, parentAuthorId: 1, participantIds: [1], mentionedIds: [1] }), {});
});

test('plain comment: post author + other participants', () => {
  assert.deepStrictEqual(plan({ participantIds: [5, 2] }), { 2: 'comment', 5: 'participant' });
});
