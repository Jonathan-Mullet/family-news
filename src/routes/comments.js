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
    // The target post must exist, not be in the trash, and be published —
    // authors may comment on their own scheduled (not yet published) posts.
    const [[targetPost]] = await pool.query(
      'SELECT id FROM posts WHERE id = ? AND deleted_at IS NULL AND (publish_at IS NULL OR publish_at <= NOW() OR user_id = ?)',
      [req.params.id, req.session.user.id]
    );
    if (!targetPost) return res.redirect('/');

    const { content: resolvedContent, mentionedUserIds } = await resolveMentions(content.trim(), pool);
    const [commentResult] = await pool.query(
      'INSERT INTO comments (post_id, parent_id, user_id, content) VALUES (?, ?, ?, ?)',
      [req.params.id, parent_id || null, req.session.user.id, resolvedContent]
    );
    const commentId = commentResult.insertId;

    // Send notification to post author (with notify_comments preference)
    try {
      const [postRows] = await pool.query(
        'SELECT p.id, p.title, p.user_id, u.email, u.notify_comments FROM posts p JOIN users u ON p.user_id = u.id WHERE p.id = ?',
        [req.params.id]
      );
      if (postRows.length) {
        const post = postRows[0];
        const toUser = { id: post.user_id, email: post.email, notify_comments: post.notify_comments };
        sendCommentNotification(toUser, req.session.user, { id: post.id, title: post.title })
          .catch(err => console.error('Comment email error:', err));
        if (post.user_id !== req.session.user.id) {
          sendPushToUser(
            post.user_id,
            { title: `${req.session.user.name} commented on your post`, body: content.trim().substring(0, 100), url: `/post/${post.id}` },
            { checkColumn: 'push_notify_comments' }
          ).catch(err => console.error('Comment push error:', err));
          pool.query(
            'INSERT INTO notifications (user_id, actor_id, type, post_id, comment_id) VALUES (?, ?, ?, ?, ?)',
            [post.user_id, req.session.user.id, 'comment', post.id, commentId]
          ).catch(e => console.error('Notification insert error:', e.message));
        }
      }
    } catch (notifyErr) {
      console.error('Comment notification error:', notifyErr.message);
    }

    // Fire-and-forget: reply notification
    if (parent_id) {
      (async () => {
        try {
          const [[parentComment]] = await pool.query(
            'SELECT user_id FROM comments WHERE id = ?',
            [parent_id]
          );
          if (parentComment && parentComment.user_id !== req.session.user.id) {
            await pool.query(
              'INSERT INTO notifications (user_id, actor_id, type, post_id, comment_id) VALUES (?, ?, ?, ?, ?)',
              [parentComment.user_id, req.session.user.id, 'reply', req.params.id, commentId]
            );
          }
        } catch (e) { console.error('Reply notification error:', e.message); }
      })();
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
              sendPushToUser(mu.id, { title: `${authorName} mentioned you`, body: excerpt, url: `/post/${postId}` })
                .catch(err => console.error('Mention push error:', err));
              sendMentionNotification(mu.email, mu.name, authorName, excerpt, postUrl)
                .catch(err => console.error('Mention email error:', err));
              pool.query(
                'INSERT INTO notifications (user_id, actor_id, type, post_id, comment_id) VALUES (?, ?, ?, ?, ?)',
                [mu.id, req.session.user.id, 'mention', postId, commentId]
              ).catch(e => console.error('Mention notification insert error:', e.message));
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
