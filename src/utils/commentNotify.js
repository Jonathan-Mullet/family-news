/**
 * Who hears about a new comment, and why — exactly one notification per person. Someone can be
 * the post's author, the author of the comment being replied to, an earlier commenter and
 * @mentioned all at once; they used to get a separate notification (and push) for each.
 * The most specific reason wins: mention > reply > comment (on your post) > participant.
 *
 * @returns {Map<number, 'mention'|'reply'|'comment'|'participant'>}
 */
const RANK = { mention: 4, reply: 3, comment: 2, participant: 1 };

function planCommentNotifications({ actorId, postAuthorId, parentAuthorId, participantIds = [], mentionedIds = [] }) {
  const out = new Map();
  const add = (id, why) => {
    if (!id || id === actorId) return;
    if (!out.has(id) || RANK[why] > RANK[out.get(id)]) out.set(id, why);
  };
  for (const id of participantIds) add(id, 'participant');
  add(postAuthorId, 'comment');
  add(parentAuthorId, 'reply');
  for (const id of mentionedIds) add(id, 'mention');
  return out;
}

module.exports = { planCommentNotifications };
