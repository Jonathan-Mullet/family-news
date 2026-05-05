const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { sendCommentNotification } = require('../email');

router.post('/posts/:id/comments', requireAuth, async (req, res) => {
  const { content, parent_id } = req.body;
  if (!content?.trim()) return res.redirect(`/post/${req.params.id}`);
  try {
    await pool.query(
      'INSERT INTO comments (post_id, parent_id, user_id, content) VALUES (?, ?, ?, ?)',
      [req.params.id, parent_id || null, req.session.user.id, content.trim()]
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
      }
    } catch (notifyErr) {
      console.error('Comment notification error:', notifyErr.message);
    }
  } catch (err) { console.error(err); }
  const ref = req.get('Referer') || '';
  try {
    const refPath = new URL(ref).pathname;
    if (refPath === '/' || refPath.match(/^\/member\/\d+$/)) {
      return res.redirect(refPath);
    }
  } catch {}
  res.redirect(`/post/${req.params.id}`);
});

router.post('/comments/:id/delete', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT user_id, post_id FROM comments WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.redirect('/');
    const { user_id, post_id } = rows[0];
    if (user_id !== req.session.user.id && req.session.user.role !== 'admin') return res.status(403).end();
    await pool.query('DELETE FROM comments WHERE id = ?', [req.params.id]);
    res.redirect(`/post/${post_id}`);
  } catch (err) { console.error(err); res.redirect('/'); }
});

module.exports = router;
