// Moderator panel: invite management, trash/restore, and role guide.
// All routes require admin or moderator role (enforced per-route via requireMod).
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../db');
const { requireMod } = require('../middleware/auth');
const { deleteUploadedFile } = require('./upload');

// ── Mod panel ─────────────────────────────────────────────────────────────────

router.get('/mod', requireMod, async (req, res) => {
  try {
    const [invites] = await pool.query(`
      SELECT i.*, u.name AS created_by_name
      FROM invites i JOIN users u ON i.created_by = u.id
      WHERE i.use_count < i.max_uses AND i.expires_at > NOW()
      ORDER BY i.created_at DESC
    `);

    const [deletedPosts] = await pool.query(`
      SELECT p.*, u.name AS author_name
      FROM posts p JOIN users u ON p.user_id = u.id
      WHERE p.deleted_at IS NOT NULL AND p.deleted_at > DATE_SUB(NOW(), INTERVAL 14 DAY)
      ORDER BY p.deleted_at DESC
    `);

    if (deletedPosts.length) {
      const ids = deletedPosts.map(p => p.id);
      const [deletedComments] = await pool.query(`
        SELECT c.*, u.name AS author_name
        FROM comments c JOIN users u ON c.user_id = u.id
        WHERE c.deleted_at IS NOT NULL AND c.deleted_at > DATE_SUB(NOW(), INTERVAL 14 DAY)
          AND c.post_id IN (?)
        ORDER BY c.deleted_at DESC
      `, [ids]);
      const byPost = {};
      deletedComments.forEach(c => {
        if (!byPost[c.post_id]) byPost[c.post_id] = [];
        byPost[c.post_id].push(c);
      });
      deletedPosts.forEach(p => { p.deletedComments = byPost[p.id] || []; });
    } else {
      deletedPosts.forEach(p => { p.deletedComments = []; });
    }

    const [standaloneComments] = await pool.query(`
      SELECT c.*, u.name AS author_name, p.content AS post_content, p.title AS post_title
      FROM comments c
      JOIN users u ON c.user_id = u.id
      JOIN posts p ON c.post_id = p.id
      WHERE c.deleted_at IS NOT NULL AND c.deleted_at > DATE_SUB(NOW(), INTERVAL 14 DAY)
        AND p.deleted_at IS NULL
      ORDER BY c.deleted_at DESC
    `);

    res.render('mod', { invites, deletedPosts, standaloneComments, baseUrl: process.env.BASE_URL });
  } catch (err) {
    console.error(err);
    res.render('error', { message: 'Could not load mod panel.' });
  }
});

// ── Invites ───────────────────────────────────────────────────────────────────

router.post('/mod/invites', requireMod, async (req, res) => {
  const isOpen = req.body.type === 'open';
  try {
    const token = uuidv4().replace(/-/g, '');
    const sql = isOpen
      ? 'INSERT INTO invites (token, created_by, expires_at, max_uses) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 2 DAY), ?)'
      : 'INSERT INTO invites (token, created_by, expires_at, max_uses) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY), ?)';
    await pool.query(sql, [token, req.session.user.id, isOpen ? 50 : 1]);
    req.flash('success', `${process.env.BASE_URL}/register?invite=${token}`);
    req.flash('invite_type', isOpen ? 'open' : 'single');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not create invite.');
  }
  res.redirect('/mod');
});

router.post('/mod/invites/:id/revoke', requireMod, async (req, res) => {
  try {
    await pool.query('UPDATE invites SET expires_at = NOW() WHERE id = ?', [req.params.id]);
    req.flash('success', 'Invite revoked.');
  } catch (err) { console.error(err); }
  res.redirect('/mod');
});

// ── Trash — restore / purge ───────────────────────────────────────────────────

router.post('/mod/posts/:id/restore', requireMod, async (req, res) => {
  try {
    await pool.query('UPDATE posts SET deleted_at = NULL WHERE id = ?', [req.params.id]);
  } catch (err) { console.error(err); }
  res.redirect('/mod');
});

router.post('/mod/posts/:id/purge', requireMod, async (req, res) => {
  try {
    const [photos] = await pool.query('SELECT photo_url FROM post_photos WHERE post_id = ?', [req.params.id]);
    photos.forEach(ph => deleteUploadedFile(ph.photo_url));
    await pool.query('DELETE FROM posts WHERE id = ?', [req.params.id]);
  } catch (err) { console.error(err); }
  res.redirect('/mod');
});

router.post('/mod/comments/:id/restore', requireMod, async (req, res) => {
  try {
    await pool.query('UPDATE comments SET deleted_at = NULL WHERE id = ?', [req.params.id]);
  } catch (err) { console.error(err); }
  res.redirect('/mod');
});

router.post('/mod/comments/:id/purge', requireMod, async (req, res) => {
  try {
    await pool.query('DELETE FROM comments WHERE id = ?', [req.params.id]);
  } catch (err) { console.error(err); }
  res.redirect('/mod');
});

// ── Role guide ────────────────────────────────────────────────────────────────

router.get('/guide', requireMod, (req, res) => {
  res.render('guide');
});

module.exports = router;
