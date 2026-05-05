const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

router.get('/member/:id', requireAuth, async (req, res) => {
  try {
    const memberId = parseInt(req.params.id);
    if (!memberId) return res.render('error', { message: 'Member not found.' });

    const [[profileUser]] = await pool.query(
      'SELECT id, name, avatar_url, created_at FROM users WHERE id = ? AND active = 1',
      [memberId]
    );
    if (!profileUser) return res.render('error', { message: 'Member not found.' });

    const [posts] = await pool.query(`
      SELECT p.*, u.name AS author_name, u.avatar_url AS author_avatar,
        (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count,
        lp.og_title, lp.og_description, lp.og_image, lp.url AS preview_url
      FROM posts p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN link_previews lp ON lp.post_id = p.id
      WHERE p.user_id = ? AND (p.publish_at IS NULL OR p.publish_at <= NOW() OR p.user_id = ?)
      ORDER BY p.created_at DESC
    `, [memberId, req.session.user.id]);

    posts.forEach(p => { p.photos = []; });
    let reactionsByPost = {};
    let reactionNames = {};
    let latestCommentByPost = {};

    if (posts.length) {
      const ids = posts.map(p => p.id);
      const userId = req.session.user.id;

      const [reactions] = await pool.query(`
        SELECT post_id, emoji, COUNT(*) AS count,
          MAX(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS user_reacted
        FROM reactions WHERE post_id IN (?)
        GROUP BY post_id, emoji
      `, [userId, ids]);
      reactions.forEach(r => {
        if (!reactionsByPost[r.post_id]) reactionsByPost[r.post_id] = {};
        reactionsByPost[r.post_id][r.emoji] = { count: r.count, userReacted: r.user_reacted === 1 };
      });

      const [nameRows] = await pool.query(`
        SELECT r.post_id, r.emoji, u.name
        FROM reactions r JOIN users u ON r.user_id = u.id
        WHERE r.post_id IN (?)
        ORDER BY r.post_id, r.emoji, u.name
      `, [ids]);
      nameRows.forEach(r => {
        if (!reactionNames[r.post_id]) reactionNames[r.post_id] = {};
        if (!reactionNames[r.post_id][r.emoji]) reactionNames[r.post_id][r.emoji] = [];
        reactionNames[r.post_id][r.emoji].push(r.name);
      });

      const [photoRows] = await pool.query(
        'SELECT post_id, photo_url FROM post_photos WHERE post_id IN (?) ORDER BY sort_order',
        [ids]
      );
      photoRows.forEach(ph => {
        const post = posts.find(p => p.id === ph.post_id);
        if (post) post.photos.push(ph.photo_url);
      });

      const [latestCommentRows] = await pool.query(`
        SELECT c.post_id, c.content, u.name AS author_name, u.avatar_url AS author_avatar, u.id AS author_id
        FROM comments c JOIN users u ON c.user_id = u.id
        WHERE c.id IN (SELECT MAX(id) FROM comments WHERE post_id IN (?) GROUP BY post_id)
      `, [ids]);
      latestCommentRows.forEach(c => { latestCommentByPost[c.post_id] = c; });
    }

    res.render('member', { profileUser, posts, reactionsByPost, reactionNames, latestCommentByPost });
  } catch (err) {
    console.error(err);
    res.render('error', { message: 'Could not load member page.' });
  }
});

module.exports = router;
