// Emoji reaction toggle (add/remove) and reaction names lookup for comments.
// Mirrors routes/reactions.js (post reactions) but targets the comment_reactions table.
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { isAllowedEmoji } = require('../utils/reactionEmoji');
const { queueReactionPush, dropReactionPush } = require('../services/reactionPush');

// Return the names of everyone who reacted to a comment, grouped by emoji; used to populate hover tooltips and the mobile reaction sheet.
router.get('/comments/:id/reaction-names', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT r.emoji, u.name
      FROM comment_reactions r JOIN users u ON r.user_id = u.id
      WHERE r.comment_id = ?
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

// Toggle a reaction on a comment — adds it if the user hasn't reacted yet, removes it if they have.
router.post('/comments/:id/react', requireAuth, async (req, res) => {
  const { emoji } = req.body;
  if (!isAllowedEmoji(emoji)) return res.status(400).json({ error: 'Invalid emoji' });
  const commentId = req.params.id;
  const userId = req.session.user.id;
  try {
    // The target comment must exist and not be soft-deleted.
    const [[comment]] = await pool.query(
      'SELECT id, user_id, post_id FROM comments WHERE id = ? AND deleted_at IS NULL',
      [commentId]
    );
    if (!comment) return res.status(404).json({ error: 'Comment not found' });

    const [existing] = await pool.query(
      'SELECT id FROM comment_reactions WHERE comment_id = ? AND user_id = ? AND emoji = ?',
      [commentId, userId, emoji]
    );
    let userReacted;
    if (existing.length) {
      await pool.query('DELETE FROM comment_reactions WHERE id = ?', [existing[0].id]);
      userReacted = false;
      // If that was the user's LAST reaction to this comment (and not self),
      // drop the unread in-app notification + the pending coalesced push.
      (async () => {
        try {
          if (comment.user_id !== userId) {
            const [[{ remaining }]] = await pool.query(
              'SELECT COUNT(*) AS remaining FROM comment_reactions WHERE comment_id = ? AND user_id = ?',
              [commentId, userId]
            );
            if (Number(remaining) === 0) {
              await pool.query(
                "DELETE FROM notifications WHERE user_id = ? AND actor_id = ? AND type = 'comment_reaction' AND comment_id = ? AND read_at IS NULL",
                [comment.user_id, userId, commentId]
              );
              dropReactionPush({ recipientId: comment.user_id, actorName: req.session.user.name, targetType: 'comment', postId: comment.post_id, commentId });
            }
          }
        } catch (e) {
          console.error('Comment reaction remove cleanup error:', e.message);
        }
      })();
    } else {
      await pool.query('INSERT INTO comment_reactions (comment_id, user_id, emoji) VALUES (?, ?, ?)', [commentId, userId, emoji]);
      userReacted = true;
      // Insert/refresh reaction notification + queue coalesced push (fire-and-forget).
      (async () => {
        try {
          if (comment.user_id !== userId) {
            // In-app dedup — one notification per (recipient, actor, comment).
            const [[existingNotif]] = await pool.query(
              "SELECT id FROM notifications WHERE user_id = ? AND actor_id = ? AND type = 'comment_reaction' AND comment_id = ? AND read_at IS NULL",
              [comment.user_id, userId, commentId]
            );
            if (existingNotif) {
              await pool.query('UPDATE notifications SET meta = ?, created_at = NOW() WHERE id = ?', [emoji, existingNotif.id]);
            } else {
              await pool.query(
                "INSERT INTO notifications (user_id, actor_id, type, post_id, comment_id, meta) VALUES (?, ?, 'comment_reaction', ?, ?, ?)",
                [comment.user_id, userId, comment.post_id, commentId, emoji]
              );
            }
            queueReactionPush({ recipientId: comment.user_id, actorName: req.session.user.name, emoji, targetType: 'comment', postId: comment.post_id, commentId });
          }
        } catch (e) {
          console.error('Comment reaction notification error:', e.message);
        }
      })();
    }
    const [[{ count }]] = await pool.query(
      'SELECT COUNT(*) AS count FROM comment_reactions WHERE comment_id = ? AND emoji = ?',
      [commentId, emoji]
    );
    res.json({ emoji, count, userReacted });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
