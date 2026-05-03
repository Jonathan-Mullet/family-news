const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { sendPasswordReset } = require('../email');

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login');
});

router.post('/login', async (req, res) => {
  const { email, password, remember } = req.body;
  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE email = ? AND active = 1', [email?.trim().toLowerCase()]);
    if (!rows.length || !(await bcrypt.compare(password, rows[0].password_hash))) {
      req.flash('error', 'Invalid email or password.');
      return res.redirect('/login');
    }
    const u = rows[0];
    req.session.user = {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      notify_posts: u.notify_posts ?? 1,
      notify_comments: u.notify_comments ?? 1,
      birthday: u.birthday || null,
      avatar_url: u.avatar_url || null,
    };
    if (remember) req.session.cookie.maxAge = 1000 * 60 * 60 * 24 * 90;
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
  const { invite, name, email, password, birthday_month, birthday_day, birthday_year } = req.body;
  if (!name?.trim() || !email?.trim() || !password || password.length < 8 || !birthday_month || !birthday_day || !birthday_year) {
    req.flash('error', 'All fields are required and password must be at least 8 characters.');
    return res.redirect(`/register?invite=${invite}`);
  }
  const birthday = `${birthday_year}-${birthday_month}-${birthday_day}`;
  const birthdayDate = new Date(birthday);
  if (isNaN(birthdayDate.getTime()) || birthdayDate >= new Date()) {
    req.flash('error', 'Please enter a valid birthday.');
    return res.redirect(`/register?invite=${invite}`);
  }
  try {
    const [inviteRows] = await pool.query(
      'SELECT * FROM invites WHERE token = ? AND use_count < max_uses AND expires_at > NOW()',
      [invite]
    );
    if (!inviteRows.length) return res.render('error', { message: 'This invite link is invalid or has expired.' });

    const hash = await bcrypt.hash(password, 12);
    const [result] = await pool.query(
      'INSERT INTO users (name, email, password_hash, birthday) VALUES (?, ?, ?, ?)',
      [name.trim(), email.trim().toLowerCase(), hash, birthday]
    );
    await pool.query(
      'UPDATE invites SET use_count = use_count + 1, used_by = COALESCE(used_by, ?), used_at = COALESCE(used_at, NOW()) WHERE token = ?',
      [result.insertId, invite]
    );

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

router.get('/birthday-setup', requireAuth, (req, res) => {
  if (req.session.user.birthday) return res.redirect('/');
  res.render('birthday-setup');
});

router.post('/birthday-setup', requireAuth, async (req, res) => {
  const { birthday_month, birthday_day, birthday_year } = req.body;
  if (!birthday_month || !birthday_day || !birthday_year) {
    req.flash('error', 'Please enter your birthday.');
    return res.redirect('/birthday-setup');
  }
  const birthday = `${birthday_year}-${birthday_month}-${birthday_day}`;
  const date = new Date(birthday);
  if (isNaN(date.getTime()) || date >= new Date()) {
    req.flash('error', 'Please enter a valid birthday.');
    return res.redirect('/birthday-setup');
  }
  try {
    await pool.query('UPDATE users SET birthday = ? WHERE id = ?', [birthday, req.session.user.id]);
    req.session.user.birthday = birthday;
    res.redirect('/');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Something went wrong.');
    res.redirect('/birthday-setup');
  }
});

router.get('/forgot-password', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('forgot-password');
});

router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  try {
    const [rows] = await pool.query('SELECT id FROM users WHERE email = ? AND active = 1', [email?.trim().toLowerCase()]);
    if (rows.length) {
      const token = crypto.randomBytes(32).toString('hex');
      await pool.query(
        'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 1 HOUR))',
        [rows[0].id, token]
      );
      sendPasswordReset(email, token);
    }
    req.flash('success', "If that email is registered, you'll receive a reset link shortly.");
    res.redirect('/forgot-password');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Something went wrong.');
    res.redirect('/forgot-password');
  }
});

router.get('/reset-password', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.redirect('/login');
  try {
    const [rows] = await pool.query(
      'SELECT id FROM password_reset_tokens WHERE token = ? AND used_at IS NULL AND expires_at > NOW()',
      [token]
    );
    if (!rows.length) return res.render('error', { message: 'This reset link is invalid or has expired.' });
    res.render('reset-password', { token });
  } catch (err) {
    console.error(err);
    res.render('error', { message: 'Something went wrong.' });
  }
});

router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!password || password.length < 8) {
    req.flash('error', 'Password must be at least 8 characters.');
    return res.redirect(`/reset-password?token=${token}`);
  }
  try {
    const [rows] = await pool.query(
      'SELECT user_id FROM password_reset_tokens WHERE token = ? AND used_at IS NULL AND expires_at > NOW()',
      [token]
    );
    if (!rows.length) return res.render('error', { message: 'This reset link is invalid or has expired.' });

    const hash = await bcrypt.hash(password, 12);
    await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, rows[0].user_id]);
    await pool.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE token = ?', [token]);

    req.flash('success', 'Password reset! Please sign in with your new password.');
    res.redirect('/login');
  } catch (err) {
    console.error(err);
    res.render('error', { message: 'Something went wrong.' });
  }
});

module.exports = router;
