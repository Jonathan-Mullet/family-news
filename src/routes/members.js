// Member profile page — shows all posts by a specific user with reactions, photos, and latest comments.
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { enrichPosts } = require('../utils/feedData');

// Render a member's profile page with their post history and engagement data.
router.get('/member/:id', requireAuth, async (req, res) => {
  try {
    const memberId = parseInt(req.params.id);
    if (!memberId) return res.status(404).render('error', { message: 'Member not found.' });

    const [[profileUser]] = await pool.query(
      'SELECT id, name, avatar_url, created_at FROM users WHERE id = ? AND active = 1',
      [memberId]
    );
    if (!profileUser) return res.status(404).render('error', { message: 'Member not found.' });

    // 20 posts a page, newest first; "Show older posts" carries a keyset cursor (created_at + id)
    // like the feed — loading every post (and all their comments/reactions) didn't scale.
    const PAGE = 20;
    const before = req.query.before && !Number.isNaN(Date.parse(req.query.before)) ? new Date(req.query.before) : null;
    const beforeId = parseInt(req.query.beforeId, 10) || 0;
    const cursorSql = before ? ' AND (p.created_at < ? OR (p.created_at = ? AND p.id < ?))' : '';
    const cursorArgs = before ? [before, before, beforeId] : [];

    const [posts] = await pool.query(`
      SELECT p.*, u.name AS author_name, u.avatar_url AS author_avatar,
        (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id AND c.deleted_at IS NULL) AS comment_count,
        lp.og_title, lp.og_description, lp.og_image, lp.url AS preview_url
      FROM posts p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN link_previews lp ON lp.post_id = p.id
      WHERE p.user_id = ? AND (p.publish_at IS NULL OR p.publish_at <= NOW() OR p.user_id = ?) AND p.deleted_at IS NULL${cursorSql}
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT ${PAGE + 1}
    `, [memberId, req.session.user.id, ...cursorArgs]);
    const hasMore = posts.length > PAGE;
    if (hasMore) posts.length = PAGE;
    const last = posts[posts.length - 1];
    const olderUrl = hasMore && last
      ? `/member/${memberId}?before=${encodeURIComponent(new Date(last.created_at).toISOString())}&beforeId=${last.id}`
      : null;

    const { reactionsByPost, reactionNames, commentsByPost } = await enrichPosts(posts, req.session.user.id);

    res.render('member', { profileUser, posts, reactionsByPost, reactionNames, commentsByPost, memberCount: 0, readersByPost: {}, olderUrl, isOlderPage: !!before });
  } catch (err) {
    console.error(err);
    res.render('error', { message: 'Could not load member page.' });
  }
});

module.exports = router;
