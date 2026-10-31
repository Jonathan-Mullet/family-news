// Comment creation and deletion; fires email + push notifications to the post author on new comments.
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { sendCommentNotification, sendMentionNotification } = require('../email');
const { sendPushToUser } = require('../push');
const { resolveMentions, ambiguousNote } = require('../utils/mentions');
const { planCommentNotifications } = require('../utils/commentNotify');

const MAX_COMMENT = 2000;

// Post a new comment (or reply) on a post and notify the post author.
router.post('/posts/:id/comments', requireAuth, async (req, res) => {
  // Form fields can arrive as arrays (content[]=…): anything but a string is treated as empty, so
  // .trim() can't throw outside the try (Express 4 would leave the request hanging).
  const content = typeof req.body.content === 'string' ? req.body.content : '';
  const parent_id = req.body.parent_id;
  if (!content.trim()) return res.redirect(`/post/${req.params.id}`);
  if (content.trim().length > MAX_COMMENT) {
    req.flash('error', `Comments cannot exceed ${MAX_COMMENT} characters.`);
    return res.redirect(`/post/${req.params.id}`);
  }
  try {
    // The target post must exist, not be in the trash, and be published —
    // authors may comment on their own scheduled (not yet published) posts.
    const [[targetPost]] = await pool.query(
      'SELECT id FROM posts WHERE id = ? AND deleted_at IS NULL AND (publish_at IS NULL OR publish_at <= NOW() OR user_id = ?)',
      [req.params.id, req.session.user.id]
    );
    if (!targetPost) return res.redirect('/');

    // A reply must answer a comment on this same post (a forged parent_id would attach it to another
    // thread and notify that comment's author).
    let parentId = null;
    if (parent_id) {
      const [[parent]] = await pool.query(
        'SELECT id FROM comments WHERE id = ? AND post_id = ? AND deleted_at IS NULL',
        [String(parent_id), req.params.id]
      );
      if (!parent) {
        req.flash('error', 'That comment was deleted, so your reply couldn’t be added.');
        return res.redirect(`/post/${req.params.id}`);
      }
      parentId = parent.id;
    }

    const { content: resolvedContent, mentionedUserIds, ambiguous } = await resolveMentions(content.trim(), pool);
    const mentionNote = ambiguousNote(ambiguous);
    if (mentionNote) req.flash('info', mentionNote);
    const [commentResult] = await pool.query(
      'INSERT INTO comments (post_id, parent_id, user_id, content) VALUES (?, ?, ?, ?)',
      [req.params.id, parentId, req.session.user.id, resolvedContent]
    );
    const commentId = commentResult.insertId;

    // Who hears about it — one notification (row + push, and email where the person wants one)
    // per person, for the most specific reason (utils/commentNotify.js). Fire-and-forget.
    const actor = req.session.user;
    const postId = Number(req.params.id);
    const text = content.trim();
    (async () => {
      try {
        const [[post]] = await pool.query('SELECT id, title, user_id FROM posts WHERE id = ?', [postId]);
        if (!post) return;
        let parentAuthorId = null;
        if (parentId) {
          const [[pc]] = await pool.query('SELECT user_id FROM comments WHERE id = ?', [parentId]);
          parentAuthorId = pc ? pc.user_id : null;
        }
        const [participants] = await pool.query(
          'SELECT DISTINCT user_id FROM comments WHERE post_id = ? AND deleted_at IS NULL', [postId]);
        const plan = planCommentNotifications({
          actorId: actor.id, postAuthorId: post.user_id, parentAuthorId,
          participantIds: participants.map((r) => r.user_id), mentionedIds: mentionedUserIds,
        });
        if (!plan.size) return;
        const [people] = await pool.query(
          'SELECT id, email, name, notify_comments FROM users WHERE id IN (?) AND active = 1', [[...plan.keys()]]);
        const PUSH_TITLE = {
          mention: `${actor.name} mentioned you`,
          reply: `${actor.name} replied to your comment`,
          comment: `${actor.name} commented on your post`,
          participant: `${actor.name} also commented`,
        };
        for (const u of people) {
          const why = plan.get(u.id);
          pool.query(
            'INSERT INTO notifications (user_id, actor_id, type, post_id, comment_id) VALUES (?, ?, ?, ?, ?)',
            [u.id, actor.id, why === 'participant' ? 'comment' : why, postId, commentId]
          ).catch((e) => console.error('Comment notification insert error:', e.message));
          // Mentions always push (as before); the rest follow the member's comment-push setting.
          sendPushToUser(u.id, { title: PUSH_TITLE[why], body: text.substring(0, 100), url: `/post/${postId}` },
            why === 'mention' ? {} : { checkColumn: 'push_notify_comments' })
            .catch((err) => console.error('Comment push error:', err));
          if (why === 'mention') {
            sendMentionNotification(u.email, u.name, actor.name, text.substring(0, 80), `${process.env.BASE_URL}/post/${postId}`)
              .catch((err) => console.error('Mention email error:', err));
          } else if (why === 'comment') {
            sendCommentNotification({ id: u.id, email: u.email, notify_comments: u.notify_comments }, actor, { id: post.id, title: post.title })
              .catch((err) => console.error('Comment email error:', err));
          }
        }
      } catch (e) {
        console.error('Comment notification error:', e.message);
      }
    })();
  } catch (err) { console.error(err); }
  // Redirect back to wherever the user came from — the main feed or a member profile page — so they
  // stay in context rather than always being bounced to the individual post detail view.
  const ref = req.get('Referer') || '';
  try {
    const refPath = new URL(ref).pathname;
    if (refPath === '/' || refPath.match(/^\/member\/\d+$/)) {
      return res.redirect(refPath);
    }
  } catch {}
  res.redirect(`/post/${req.params.id}`);
});

// Soft-delete a comment; only the comment author, a moderator, or an admin may delete.
router.post('/comments/:id/delete', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT user_id, post_id FROM comments WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    if (!rows.length) return res.redirect('/');
    const { user_id, post_id } = rows[0];
    if (user_id !== req.session.user.id && req.session.user.role !== 'admin' && req.session.user.role !== 'moderator') return res.status(403).end();
    await pool.query('UPDATE comments SET deleted_at = NOW() WHERE id = ?', [req.params.id]);
    res.redirect(`/post/${post_id}`);
  } catch (err) { console.error(err); res.redirect('/'); }
});

module.exports = router;
