const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const crypto = require('crypto');
const { sendPasswordReset } = require('../email');

router.use(requireAdmin);

router.get('/', async (req, res) => {
  try {
    const [users] = await pool.query(
      'SELECT id, name, email, role, active, created_at FROM users ORDER BY created_at'
    );
    const [invites] = await pool.query(`
      SELECT i.*, u1.name AS created_by_name, u2.name AS used_by_name
      FROM invites i
      JOIN users u1 ON i.created_by = u1.id
      LEFT JOIN users u2 ON i.used_by = u2.id
      ORDER BY i.created_at DESC LIMIT 30
    `);
    const [events] = await pool.query('SELECT * FROM events ORDER BY month, day, name');
    res.render('admin', { users, invites, events, baseUrl: process.env.BASE_URL });
  } catch (err) {
    console.error(err);
    res.render('error', { message: 'Could not load admin panel.' });
  }
});

router.post('/invites', async (req, res) => {
  const isOpen = req.body.type === 'open';
  try {
    const token = uuidv4().replace(/-/g, '');
    await pool.query(
      `INSERT INTO invites (token, created_by, expires_at, max_uses) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ${isOpen ? '2 DAY' : '7 DAY'}), ?)`,
      [token, req.session.user.id, isOpen ? 50 : 1]
    );
    req.flash('success', `${process.env.BASE_URL}/register?invite=${token}`);
    req.flash('invite_type', isOpen ? 'open' : 'single');
    res.redirect('/admin');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not create invite.');
    res.redirect('/admin');
  }
});

router.post('/invites/:id/revoke', async (req, res) => {
  try {
    await pool.query('UPDATE invites SET expires_at = NOW() WHERE id = ?', [req.params.id]);
    req.flash('success', 'Invite revoked.');
  } catch (err) { console.error(err); }
  res.redirect('/admin');
});

router.post('/users/:id/toggle-active', async (req, res) => {
  if (parseInt(req.params.id) === req.session.user.id) {
    req.flash('error', 'You cannot deactivate your own account.');
    return res.redirect('/admin');
  }
  try {
    await pool.query('UPDATE users SET active = NOT active WHERE id = ?', [req.params.id]);
  } catch (err) { console.error(err); }
  res.redirect('/admin');
});

router.post('/users/:id/toggle-role', async (req, res) => {
  if (parseInt(req.params.id) === req.session.user.id) {
    req.flash('error', 'You cannot change your own role.');
    return res.redirect('/admin');
  }
  try {
    await pool.query(
      "UPDATE users SET role = IF(role='admin','member','admin') WHERE id = ?",
      [req.params.id]
    );
  } catch (err) { console.error(err); }
  res.redirect('/admin');
});

router.post('/events', async (req, res) => {
  const { name, type, month, day, note } = req.body;
  const m = parseInt(month), d = parseInt(day);
  if (!name?.trim() || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) {
    req.flash('error', 'Invalid event data.');
    return res.redirect('/admin');
  }
  try {
    await pool.query(
      'INSERT INTO events (name, type, month, day, note, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [name.trim(), type === 'anniversary' ? 'anniversary' : 'birthday', m, d, note?.trim() || null, req.session.user.id]
    );
  } catch (err) { console.error(err); req.flash('error', 'Could not add event.'); }
  res.redirect('/admin');
});

router.post('/events/:id/delete', async (req, res) => {
  try {
    await pool.query('DELETE FROM events WHERE id = ?', [req.params.id]);
  } catch (err) { console.error(err); }
  res.redirect('/admin');
});

router.post('/users/:id/send-reset', async (req, res) => {
  try {
    const [[user]] = await pool.query('SELECT id, name, email FROM users WHERE id = ?', [req.params.id]);
    if (!user) { req.flash('error', 'User not found.'); return res.redirect('/admin'); }
    const token = crypto.randomBytes(32).toString('hex');
    await pool.query(
      'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 1 HOUR))',
      [user.id, token]
    );
    sendPasswordReset(user.email, token);
    req.flash('success', `Password reset email sent to ${user.name}.`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not send reset email.');
  }
  res.redirect('/admin');
});

router.post('/users/:id/update-email', async (req, res) => {
  const newEmail = req.body.email?.trim().toLowerCase();
  if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
    req.flash('error', 'Invalid email address.');
    return res.redirect('/admin');
  }
  try {
    const [[existing]] = await pool.query(
      'SELECT id FROM users WHERE email = ? AND id != ?', [newEmail, req.params.id]
    );
    if (existing) { req.flash('error', 'That email is already in use.'); return res.redirect('/admin'); }
    const [[user]] = await pool.query('SELECT name FROM users WHERE id = ?', [req.params.id]);
    if (!user) { req.flash('error', 'User not found.'); return res.redirect('/admin'); }
    await pool.query('UPDATE users SET email = ? WHERE id = ?', [newEmail, req.params.id]);
    req.flash('success', `Email updated for ${user.name}.`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not update email.');
  }
  res.redirect('/admin');
});

module.exports = router;
