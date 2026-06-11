// Emoji reaction toggle (add/remove) and reaction names lookup for tooltips and mobile sheet.
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

// Server-side whitelist of permitted emoji; the frontend emoji picker mirrors this exact list.
const ALLOWED = ['❤️', '👍', '😂', '😮', '😢', '🎉', '🙏', '🔥', '💯', '🫶', '👏', '🥳', '😍', '🤣', '😭', '💪', '🎂', '🌟', '👀', '🤔', '💔'];

// Return the names of everyone who reacted to a post, grouped by emoji; used to populate hover tooltips and the mobile reaction sheet.
router.get('/posts/:id/reaction-names', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT r.emoji, u.name
      FROM reactions r JOIN users u ON r.user_id = u.id
      WHERE r.post_id = ?
      ORDER BY r.emoji, u.name
    `, [req.params.id]);
    const byEmoji = {};
    rows.forEach(r => {
      if (!byEmoji[r.emoji]) byEmoji[r.emoji] = [];
      byEmoji[r.emoji].push(r.name);
    });
    res.json(byEmoji);
  } catch { res.json({}); }
});

// Toggle a reaction on a post — adds it if the user hasn't reacted yet, removes it if they have.
router.post('/posts/:id/react', requireAuth, async (req, res) => {
  const { emoji } = req.body;
  if (!ALLOWED.includes(emoji)) return res.status(400).json({ error: 'Invalid emoji' });
  const postId = req.params.id;
  const userId = req.session.user.id;
  try {
    // The target post must exist, not be in the trash, and be published —
    // authors may react to their own scheduled (not yet published) posts.
    const [[targetPost]] = await pool.query(
      'SELECT id FROM posts WHERE id = ? AND deleted_at IS NULL AND (publish_at IS NULL OR publish_at <= NOW() OR user_id = ?)',
      [postId, userId]
    );
    if (!targetPost) return res.status(404).json({ error: 'Post not found' });

    const [existing] = await pool.query(
      'SELECT id FROM reactions WHERE post_id = ? AND user_id = ? AND emoji = ?',
      [postId, userId, emoji]
    );
    let userReacted;
    if (existing.length) {
      await pool.query('DELETE FROM reactions WHERE id = ?', [existing[0].id]);
      userReacted = false;
    } else {
      await pool.query('INSERT INTO reactions (post_id, user_id, emoji) VALUES (?, ?, ?)', [postId, userId, emoji]);
      userReacted = true;
      // Insert reaction notification (fire-and-forget)
      (async () => {
        try {
          const [[post]] = await pool.query(
            'SELECT user_id FROM posts WHERE id = ?',
            [postId]
          );
          if (post && post.user_id !== userId) {
            pool.query(
              'INSERT INTO notifications (user_id, actor_id, type, post_id, meta) VALUES (?, ?, ?, ?, ?)',
              [post.user_id, userId, 'reaction', postId, emoji]
            ).catch(e => console.error('Reaction notification insert error:', e.message));
          }
        } catch (e) {
          console.error('Reaction notification error:', e.message);
        }
      })();
    }
    const [[{ count }]] = await pool.query(
      'SELECT COUNT(*) AS count FROM reactions WHERE post_id = ? AND emoji = ?',
      [postId, emoji]
    );
    res.json({ emoji, count, userReacted });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
