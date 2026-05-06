'use strict';
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const PAGE_SIZE = 48;

router.get('/photos', requireAuth, async (req, res) => {
  try {
    const memberParam = req.query.member;
    const memberId = memberParam && /^\d+$/.test(memberParam) ? parseInt(memberParam, 10) : null;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const offset = (page - 1) * PAGE_SIZE;

    // Members who have at least one photo (for filter chips)
    const [members] = await pool.query(`
      SELECT DISTINCT u.id, u.name, u.avatar_url
      FROM users u
      JOIN posts p ON p.user_id = u.id
      JOIN post_photos pp ON pp.post_id = p.id
      WHERE p.deleted_at IS NULL
        AND (p.publish_at IS NULL OR p.publish_at <= NOW())
        AND u.active = 1
      ORDER BY u.name ASC
    `);

    // Photos page shows only published posts — no author bypass, unlike the feed.
    const baseWhere = 'p.deleted_at IS NULL AND (p.publish_at IS NULL OR p.publish_at <= NOW())';
    const whereClause = memberId ? `${baseWhere} AND p.user_id = ?` : baseWhere;
    const whereParams = memberId ? [memberId] : [];

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM post_photos pp JOIN posts p ON pp.post_id = p.id WHERE ${whereClause}`,
      whereParams
    );

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (page > totalPages) {
      return res.redirect(`/photos${memberId ? `?member=${memberId}` : ''}`);
    }

    const [photos] = await pool.query(
      `SELECT pp.photo_url, pp.post_id, p.created_at, p.user_id AS author_id
       FROM post_photos pp
       JOIN posts p ON pp.post_id = p.id
       WHERE ${whereClause}
       ORDER BY p.created_at DESC, pp.sort_order ASC
       LIMIT ? OFFSET ?`,
      [...whereParams, PAGE_SIZE, offset]
    );

    res.render('photos', { photos, members, currentMember: memberId, page, totalPages });
  } catch (err) {
    console.error(err);
    res.render('error', { message: 'Could not load photos.' });
  }
});

module.exports = router;
