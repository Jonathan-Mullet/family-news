const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const ALLOWED = ['❤️', '👍', '😂', '😮', '😢', '🎉', '🙏', '🔥', '💯', '🫶', '👏', '🥳', '😍', '🤣', '😭', '💪', '🎂', '🌟', '👀', '🤔', '💔'];

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

router.post('/posts/:id/react', requireAuth, async (req, res) => {
  const { emoji } = req.body;
  if (!ALLOWED.includes(emoji)) return res.status(400).json({ error: 'Invalid emoji' });
  const postId = req.params.id;
  const userId = req.session.user.id;
  try {
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
