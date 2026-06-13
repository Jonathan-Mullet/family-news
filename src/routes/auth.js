// Authentication routes: login, logout, registration (invite-required), birthday setup, and password reset.
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { sendPasswordReset } = require('../email');
const { createRateLimiter } = require('../utils/rateLimit');
const { isValidBirthday } = require('../utils/dates');

// Brute-force protection for login + forgot-password: 10 attempts per 15 min
// per (IP, email) pair. In-memory by design — single Node process. trust proxy
// is set in app.js, so req.ip is the real client IP behind Nginx.
const authLimiter = createRateLimiter({ max: 10, windowMs: 15 * 60 * 1000 });
const limiterKey = (req, email) => `${req.ip}:${(email || '').trim().toLowerCase()}`;

// Reset tokens are stored as sha256(token) so a DB leak can't be replayed;
// the raw token only ever lives in the emailed link.
const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

// Show login form (redirect home if already logged in).
router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login');
});

// Authenticate user; active = 1 check blocks disabled accounts from signing in.
router.post('/login', async (req, res) => {
  const { email, password, remember } = req.body;
  const key = limiterKey(req, email);
  if (!authLimiter.consume(key)) {
    return res.status(429).render('login', {
      flash: { error: 'Too many sign-in attempts. Please wait 15 minutes and try again.' },
    });
  }
  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE email = ? AND active = 1', [email?.trim().toLowerCase()]);
    if (!rows.length || !(await bcrypt.compare(password, rows[0].password_hash))) {
      req.flash('error', 'Invalid email or password.');
      return res.redirect('/login');
    }
    const u = rows[0];
    // Regenerate the session id on login (session-fixation defense) before
    // attaching any user data to it.
    await new Promise((resolve, reject) =>
      req.session.regenerate(err => (err ? reject(err) : resolve()))
    );
    req.session.user = {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      notify_posts: u.notify_posts ?? 1,
      notify_comments: u.notify_comments ?? 1,
      push_notify_posts: u.push_notify_posts ?? 1,
      push_notify_comments: u.push_notify_comments ?? 1,
      push_notify_reactions: u.push_notify_reactions ?? 1,
      push_notify_big_news: u.push_notify_big_news ?? 1,
      birthday: u.birthday || null,
      avatar_url: u.avatar_url || null,
      whats_new_seen_at: u.whats_new_seen_at || null,
    };
    if (remember) req.session.cookie.maxAge = 1000 * 60 * 60 * 24 * 90;
    authLimiter.reset(key); // successful login clears the strike count
    res.redirect('/');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Something went wrong.');
    res.redirect('/login');
  }
});

// Destroy session on POST only (CSRF-safe — a hostile <img>/link can no longer
// log members out). The nav drawer submits a small inline form.
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// Legacy GET /logout: kept so old bookmarks don't 404, but it no longer
// destroys anything — just bounce home.
router.get('/logout', (req, res) => {
  res.redirect('/');
});

// Show registration form; validates that the invite token is still valid before rendering.
router.get('/register', async (req, res) => {
  const { invite } = req.query;
  if (!invite) return res.render('error', { message: 'An invite link is required to register.' });
  try {
    const [rows] = await pool.query(
      'SELECT * FROM invites WHERE token = ? AND use_count < max_uses AND expires_at > NOW()',
      [invite]
    );
    if (!rows.length) return res.render('error', { message: 'This invite link is invalid or has expired.' });
    res.render('register', { invite });
  } catch (err) {
    console.error(err);
    res.render('error', { message: 'Something went wrong.' });
  }
});

// Create a new account; multi-use invite logic — use_count < max_uses allows up to max_uses registrations per token.
router.post('/register', async (req, res) => {
  const { invite, name, email, password, birthday_month, birthday_day, birthday_year } = req.body;
  if (!name?.trim() || !email?.trim() || !password || password.length < 8 || !birthday_month || !birthday_day || !birthday_year) {
    req.flash('error', 'All fields are required and password must be at least 8 characters.');
    return res.redirect(`/register?invite=${invite}`);
  }
  const birthday = `${birthday_year}-${birthday_month}-${birthday_day}`;
  // Strict calendar check: `new Date('2025-02-31')` silently rolls over to
  // March 3, which then fails MySQL strict mode with an opaque error.
  if (!isValidBirthday(birthday) || new Date(birthday) >= new Date()) {
    req.flash('error', 'Please enter a valid birthday.');
    return res.redirect(`/register?invite=${invite}`);
  }
  try {
    // Courtesy pre-check so obviously dead invites get a friendly error before
    // we create anything. The actual enforcement is the atomic claim below.
    const [inviteRows] = await pool.query(
      'SELECT id FROM invites WHERE token = ? AND use_count < max_uses AND expires_at > NOW()',
      [invite]
    );
    if (!inviteRows.length) return res.render('error', { message: 'This invite link is invalid or has expired.' });

    const hash = await bcrypt.hash(password, 12);
    // Insert the user FIRST, then atomically claim an invite use. This order
    // can never strand an invite: if the claim loses the race the new user row
    // is rolled back below, and a crash in between leaves the invite untouched
    // (still usable) rather than consumed with no account to show for it.
    const [result] = await pool.query(
      'INSERT INTO users (name, email, password_hash, birthday) VALUES (?, ?, ?, ?)',
      [name.trim(), email.trim().toLowerCase(), hash, birthday]
    );
    // Atomic check-and-increment closes the check-then-act race where two
    // concurrent registrations could both pass the SELECT above and overshoot
    // max_uses. (The invites table has no revoked_at column — revocation is
    // implemented as expires_at = NOW(), so the expiry predicate covers it.)
    const [claim] = await pool.query(
      `UPDATE invites
       SET use_count = use_count + 1, used_by = COALESCE(used_by, ?), used_at = COALESCE(used_at, NOW())
       WHERE token = ? AND use_count < max_uses AND expires_at > NOW()`,
      [result.insertId, invite]
    );
    if (claim.affectedRows !== 1) {
      // Lost the race (or invite was revoked mid-flight) — undo the user insert.
      await pool.query('DELETE FROM users WHERE id = ?', [result.insertId]);
      return res.render('error', { message: 'This invite link is invalid or has expired.' });
    }

    req.flash('success', 'Account created! Please sign in.');
    res.redirect('/login');
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      // Deliberately vague — confirming "already registered" would let an
      // invite holder enumerate which emails have accounts.
      req.flash('error', 'Could not create an account with those details. If you already have an account, try signing in or use “Forgot password?”.');
      return res.redirect(`/register?invite=${invite}`);
    }
    console.error(err);
    res.render('error', { message: 'Something went wrong.' });
  }
});

// Show birthday-setup form for users who registered without a birthday.
router.get('/birthday-setup', requireAuth, (req, res) => {
  if (req.session.user.birthday) return res.redirect('/');
  res.render('birthday-setup');
});

// Save birthday for the currently logged-in user and update session.
router.post('/birthday-setup', requireAuth, async (req, res) => {
  const { birthday_month, birthday_day, birthday_year } = req.body;
  if (!birthday_month || !birthday_day || !birthday_year) {
    req.flash('error', 'Please enter your birthday.');
    return res.redirect('/birthday-setup');
  }
  const birthday = `${birthday_year}-${birthday_month}-${birthday_day}`;
  // Same strict calendar check as registration (see comment there).
  if (!isValidBirthday(birthday) || new Date(birthday) >= new Date()) {
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

// Show forgot-password form (redirect home if already logged in).
router.get('/forgot-password', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('forgot-password');
});

// Generate a password reset token and email it; always shows a generic success message to prevent email enumeration.
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!authLimiter.consume(limiterKey(req, email))) {
    return res.status(429).render('forgot-password', {
      flash: { error: 'Too many attempts. Please wait 15 minutes and try again.' },
    });
  }
  try {
    // active = 1 check ensures disabled accounts cannot trigger a reset email.
    const [rows] = await pool.query('SELECT id FROM users WHERE email = ? AND active = 1', [email?.trim().toLowerCase()]);
    if (rows.length) {
      const token = crypto.randomBytes(32).toString('hex');
      // Only the sha256 of the token is persisted; the raw token goes in the
      // email. NOTE: at deploy time this invalidates any in-flight plaintext
      // tokens already in the table — acceptable, they expire within 1 hour.
      await pool.query(
        'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 1 HOUR))',
        [rows[0].id, hashToken(token)]
      );
      sendPasswordReset(email, token).catch(err => console.error('Password reset email error:', err));
    }
    req.flash('success', "If that email is registered, you'll receive a reset link shortly.");
    res.redirect('/forgot-password');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Something went wrong.');
    res.redirect('/forgot-password');
  }
});

// Show the reset-password form; validates the token before rendering.
router.get('/reset-password', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.redirect('/login');
  try {
    const [rows] = await pool.query(
      'SELECT id FROM password_reset_tokens WHERE token = ? AND used_at IS NULL AND expires_at > NOW()',
      [hashToken(token)]
    );
    if (!rows.length) return res.render('error', { message: 'This reset link is invalid or has expired.' });
    res.render('reset-password', { token });
  } catch (err) {
    console.error(err);
    res.render('error', { message: 'Something went wrong.' });
  }
});

// Apply the new password and mark the reset token as used so it cannot be replayed.
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!password || password.length < 8) {
    req.flash('error', 'Password must be at least 8 characters.');
    return res.redirect(`/reset-password?token=${token}`);
  }
  try {
    const tokenHash = hashToken(token);
    const [rows] = await pool.query(
      'SELECT user_id FROM password_reset_tokens WHERE token = ? AND used_at IS NULL AND expires_at > NOW()',
      [tokenHash]
    );
    if (!rows.length) return res.render('error', { message: 'This reset link is invalid or has expired.' });
    const userId = rows[0].user_id;

    const hash = await bcrypt.hash(password, 12);
    await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, userId]);
    // Mark this token used and kill the user's other outstanding tokens so a
    // password reset leaves no second live reset link floating around.
    await pool.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE token = ?', [tokenHash]);
    await pool.query('DELETE FROM password_reset_tokens WHERE user_id = ? AND used_at IS NULL', [userId]);

    // Invalidate every other session belonging to this user (the whole point of
    // a reset is usually "someone else might have my password"). The MySQL
    // session store JSON.stringify's the session, so the data column contains
    // '...,"user":{"id":<n>,"name":...'. The trailing comma in the pattern makes
    // id 5 unable to match id 50. Best-effort: a failure here must not fail the
    // password change itself.
    try {
      await pool.query(
        'DELETE FROM sessions WHERE session_id != ? AND data LIKE ?',
        [req.sessionID, `%"user":{"id":${Number(userId)},%`]
      );
    } catch (sessErr) {
      console.error('Session invalidation error (reset-password):', sessErr.message);
    }

    req.flash('success', 'Password reset! Please sign in with your new password.');
    res.redirect('/login');
  } catch (err) {
    console.error(err);
    res.render('error', { message: 'Something went wrong.' });
  }
});

module.exports = router;
