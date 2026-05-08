// Lists the current user's in-app notifications and marks them all as read.
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, async (req, res) => {
  const userId = req.session.user.id;
  try {
    const [notifications] = await pool.query(`
      SELECT n.id, n.type, n.post_id, n.meta, n.read_at, n.created_at,
             u.name AS actor_name, u.avatar_url AS actor_avatar,
             p.title AS post_title
      FROM notifications n
      JOIN users u ON n.actor_id = u.id
      JOIN posts p ON n.post_id = p.id
      WHERE n.user_id = ?
      ORDER BY n.created_at DESC
      LIMIT 50
    `, [userId]);

    await pool.query(
      'UPDATE notifications SET read_at = NOW() WHERE user_id = ? AND read_at IS NULL',
      [userId]
    );

    res.render('notifications', { notifications });
  } catch (err) {
    console.error(err);
    res.render('error', { message: 'Could not load notifications.' });
  }
});

module.exports = router;
