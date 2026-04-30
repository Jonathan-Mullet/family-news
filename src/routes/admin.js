const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../db');
const { requireAdmin } = require('../middleware/auth');

router.use(requireAdmin);

router.get('/', async (req, res) => {
  try {
    const [users] = await pool.query(
      'SELECT id, name, email, role, created_at FROM users ORDER BY created_at'
    );
    const [invites] = await pool.query(`
      SELECT i.*, u1.name AS created_by_name, u2.name AS used_by_name
      FROM invites i
      JOIN users u1 ON i.created_by = u1.id
      LEFT JOIN users u2 ON i.used_by = u2.id
      ORDER BY i.created_at DESC LIMIT 30
    `);
    res.render('admin', { users, invites, baseUrl: process.env.BASE_URL });
  } catch (err) {
    console.error(err);
    res.render('error', { message: 'Could not load admin panel.' });
  }
});

router.post('/invites', async (req, res) => {
  try {
    const token = uuidv4().replace(/-/g, '');
    await pool.query(
      'INSERT INTO invites (token, created_by, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY))',
      [token, req.session.user.id]
    );
    req.flash('success', `${process.env.BASE_URL}/register?invite=${token}`);
    res.redirect('/admin');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not create invite.');
    res.redirect('/admin');
  }
});

router.post('/invites/:id/revoke', async (req, res) => {
  try {
    await pool.query('UPDATE invites SET expires_at = NOW() WHERE id = ? AND used_at IS NULL', [req.params.id]);
    req.flash('success', 'Invite revoked.');
  } catch (err) { console.error(err); }
  res.redirect('/admin');
});

module.exports = router;
