// Comment creation and deletion; fires email + push notifications to the post author on new comments.
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { sendCommentNotification, sendMentionNotification } = require('../email');
const { sendPushToUser } = require('../push');
const { resolveMentions } = require('../utils/mentions');

const MAX_COMMENT = 2000;

// Post a new comment (or reply) on a post and notify the post author.
router.post('/posts/:id/comments', requireAuth, async (req, res) => {
  const { content, parent_id } = req.body;
  if (!content?.trim()) return res.redirect(`/post/${req.params.id}`);
  if (content.trim().length > MAX_COMMENT) {
    req.flash('error', `Comments cannot exceed ${MAX_COMMENT} characters.`);
    return res.redirect(`/post/${req.params.id}`);
  }
  try {
    const { content: resolvedContent, mentionedUserIds } = await resolveMentions(content.trim(), pool);
    await pool.query(
      'INSERT INTO comments (post_id, parent_id, user_id, content) VALUES (?, ?, ?, ?)',
      [req.params.id, parent_id || null, req.session.user.id, resolvedContent]
    );

    // Send notification to post author (with notify_comments preference)
    try {
      const [postRows] = await pool.query(
        'SELECT p.id, p.title, p.user_id, u.email, u.notify_comments FROM posts p JOIN users u ON p.user_id = u.id WHERE p.id = ?',
        [req.params.id]
      );
      if (postRows.length) {
        const post = postRows[0];
        const toUser = { id: post.user_id, email: post.email, notify_comments: post.notify_comments };
        sendCommentNotification(toUser, req.session.user, { id: post.id, title: post.title });
        if (post.user_id !== req.session.user.id) {
          sendPushToUser(
            post.user_id,
            { title: `${req.session.user.name} commented on your post`, body: content.trim().substring(0, 100), url: `/post/${post.id}` },
            { checkColumn: 'push_notify_comments' }
          );
        }
      }
    } catch (notifyErr) {
      console.error('Comment notification error:', notifyErr.message);
    }

    // Fire-and-forget: mention notifications (skip self-mentions)
    if (mentionedUserIds.length) {
      const toNotify = mentionedUserIds.filter(id => id !== req.session.user.id);
      const authorName = req.session.user.name;
      const excerpt = content.trim().substring(0, 80);
      const postUrl = `${process.env.BASE_URL}/post/${req.params.id}`;
      const postId = req.params.id;
      if (toNotify.length) {
        (async () => {
          try {
            const [mentionedUsers] = await pool.query(
              'SELECT id, email, name FROM users WHERE id IN (?)',
              [toNotify]
            );
            for (const mu of mentionedUsers) {
              sendPushToUser(mu.id, { title: `${authorName} mentioned you`, body: excerpt, url: `/post/${postId}` });
              sendMentionNotification(mu.email, mu.name, authorName, excerpt, postUrl);
            }
          } catch (mentionErr) {
            console.error('Mention notification error:', mentionErr.message);
          }
        })();
      }
    }
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
