const { ReactionBuffer, summarizeReactors } = require('../utils/reactionCoalesce');
const { sendPushToUser } = require('../push');

const QUIET_MS = 30 * 1000;
const CAP_MS = 5 * 60 * 1000;

// key = recipientId|targetType|targetId. We stash link info on the group via the
// first item so the flush can build a URL.
const buffer = new ReactionBuffer({
  quietMs: QUIET_MS, capMs: CAP_MS, now: () => Date.now(),
  onFlush: (items, key) => {
    const recipientId = Number(key.split('|')[0]);
    const targetType = items[0].targetType;            // 'post' | 'comment'
    const url = items[0].url;
    const body = summarizeReactors(items, targetType);
    sendPushToUser(recipientId, { title: 'New reaction', body, url }, { checkColumn: 'push_notify_reactions' })
      .catch(e => console.error('reaction push error:', e.message));
  },
});
// Single interval drives all groups. Unref so it never holds the process open.
const _timer = setInterval(() => buffer.tick(), 5000);
if (_timer.unref) _timer.unref();

function queueReactionPush({ recipientId, actorName, emoji, targetType, postId, commentId }) {
  const targetId = targetType === 'comment' ? commentId : postId;
  const key = `${recipientId}|${targetType}|${targetId}`;
  const url = targetType === 'comment' ? `/post/${postId}#comment-${commentId}` : `/post/${postId}`;
  buffer.add(key, { name: actorName, emoji, targetType, url });
}
function dropReactionPush({ recipientId, actorName, targetType, postId, commentId }) {
  const targetId = targetType === 'comment' ? commentId : postId;
  buffer.drop(`${recipientId}|${targetType}|${targetId}`, actorName);
}
module.exports = { queueReactionPush, dropReactionPush };
