const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login');
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    if (!rows.length || !(await bcrypt.compare(password, rows[0].password_hash))) {
      req.flash('error', 'Invalid email or password.');
      return res.redirect('/login');
    }
    const u = rows[0];
    req.session.user = { id: u.id, name: u.name, email: u.email, role: u.role };
    res.redirect('/');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Something went wrong.');
    res.redirect('/login');
  }
});

router.get('/logout', requireAuth, (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

router.get('/register', async (req, res) => {
  const { invite } = req.query;
  if (!invite) return res.render('error', { message: 'An invite link is required to register.' });
  try {
    const [rows] = await pool.query(
      'SELECT * FROM invites WHERE token = ? AND used_at IS NULL AND expires_at > NOW()',
      [invite]
    );
    if (!rows.length) return res.render('error', { message: 'This invite link is invalid or has expired.' });
    res.render('register', { invite });
  } catch (err) {
    console.error(err);
    res.render('error', { message: 'Something went wrong.' });
  }
});

router.post('/register', async (req, res) => {
  const { invite, name, email, password } = req.body;
  if (!name?.trim() || !email?.trim() || !password || password.length < 8) {
    req.flash('error', 'All fields are required and password must be at least 8 characters.');
    return res.redirect(`/register?invite=${invite}`);
  }
  try {
    const [inviteRows] = await pool.query(
      'SELECT * FROM invites WHERE token = ? AND used_at IS NULL AND expires_at > NOW()',
      [invite]
    );
    if (!inviteRows.length) return res.render('error', { message: 'This invite link is invalid or has expired.' });

    const hash = await bcrypt.hash(password, 12);
    const [result] = await pool.query(
      'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
      [name.trim(), email.trim().toLowerCase(), hash]
    );
    await pool.query('UPDATE invites SET used_by = ?, used_at = NOW() WHERE token = ?', [result.insertId, invite]);

    req.flash('success', 'Account created! Please sign in.');
    res.redirect('/login');
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      req.flash('error', 'That email is already registered.');
      return res.redirect(`/register?invite=${invite}`);
    }
    console.error(err);
    res.render('error', { message: 'Something went wrong.' });
  }
});

module.exports = router;
