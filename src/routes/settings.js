// Settings page: display name, email, password, birthday, avatar upload/remove,
// and notification preferences (email + push).
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { handleAvatarUpload, deleteUploadedFile } = require('./upload');
const { isValidBirthday } = require('../utils/dates');

// All settings routes require an authenticated session.
router.use(requireAuth);

// Render the settings page.
router.get('/', (req, res) => {
  res.render('settings');
});

// Update the user's display name.
router.post('/name', async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) { req.flash('error', 'Name is required.'); return res.redirect('/settings'); }
  try {
    await pool.query('UPDATE users SET name = ? WHERE id = ?', [name.trim(), req.session.user.id]);
    req.session.user.name = name.trim();
    req.flash('success', 'Name updated.');
  } catch (err) { console.error(err); req.flash('error', 'Could not update name.'); }
  res.redirect('/settings');
});

// Update the user's email address; requires current password confirmation.
router.post('/email', async (req, res) => {
  const { email, password } = req.body;
  if (!email?.trim()) { req.flash('error', 'Email is required.'); return res.redirect('/settings'); }
  try {
    const [rows] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [req.session.user.id]);
    if (!await bcrypt.compare(password, rows[0].password_hash)) {
      req.flash('error', 'Current password is incorrect.');
      return res.redirect('/settings');
    }
    await pool.query('UPDATE users SET email = ? WHERE id = ?', [email.trim().toLowerCase(), req.session.user.id]);
    req.session.user.email = email.trim().toLowerCase();
    req.flash('success', 'Email updated.');
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      req.flash('error', 'That email is already in use.');
      return res.redirect('/settings');
    }
    console.error(err);
    req.flash('error', 'Could not update email.');
  }
  res.redirect('/settings');
});

// Change the user's password; requires current password confirmation before applying the new hash.
router.post('/password', async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!new_password || new_password.length < 8) {
    req.flash('error', 'New password must be at least 8 characters.');
    return res.redirect('/settings');
  }
  try {
    const [rows] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [req.session.user.id]);
    if (!await bcrypt.compare(current_password, rows[0].password_hash)) {
      req.flash('error', 'Current password is incorrect.');
      return res.redirect('/settings');
    }
    const hash = await bcrypt.hash(new_password, 12);
    await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.session.user.id]);

    // Log out this user's OTHER sessions (changing a password should evict
    // anyone else holding the old credentials), keeping the current one.
    // express-mysql-session JSON.stringify's the session into `data`, which
    // contains '...,"user":{"id":<n>,"name":...' — the trailing comma keeps
    // id 5 from matching id 50. Best-effort: never fail the password change.
    try {
      await pool.query(
        'DELETE FROM sessions WHERE session_id != ? AND data LIKE ?',
        [req.sessionID, `%"user":{"id":${Number(req.session.user.id)},%`]
      );
    } catch (sessErr) {
      console.error('Session invalidation error (password change):', sessErr.message);
    }

    req.flash('success', 'Password changed successfully.');
  } catch (err) { console.error(err); req.flash('error', 'Could not update password.'); }
  res.redirect('/settings');
});

// Save the user's email notification preferences for new posts and comments.
// No flash success message — this is an auto-save handler; the flash message would be distracting.
router.post('/notifications', async (req, res) => {
  const isAjax = req.headers['x-requested-with'] === 'XMLHttpRequest';
  const notify_posts = req.body.notify_posts ? 1 : 0;
  const notify_comments = req.body.notify_comments ? 1 : 0;
  try {
    await pool.query(
      'UPDATE users SET notify_posts = ?, notify_comments = ? WHERE id = ?',
      [notify_posts, notify_comments, req.session.user.id]
    );
    req.session.user.notify_posts = notify_posts;
    req.session.user.notify_comments = notify_comments;
  } catch (err) {
    console.error(err);
    if (isAjax) return res.status(500).json({ ok: false, error: 'Could not save preferences.' });
    req.flash('error', 'Could not save preferences.');
  }
  if (isAjax) return res.json({ ok: true });
  res.redirect('/settings');
});

// Upload and save a new avatar; the old avatar file is deleted from disk only
// AFTER the DB update succeeds — if the old file were unlinked first and the
// UPDATE then failed, every page would render a broken avatar image.
router.post('/avatar', handleAvatarUpload, async (req, res) => {
  if (req.uploadError) { req.flash('error', req.uploadError); return res.redirect('/settings'); }
  if (!req.uploadedPath) { req.flash('error', 'No image received.'); return res.redirect('/settings'); }
  try {
    const oldAvatar = req.session.user.avatar_url;
    await pool.query('UPDATE users SET avatar_url = ? WHERE id = ?', [req.uploadedPath, req.session.user.id]);
    req.session.user.avatar_url = req.uploadedPath;
    // Best-effort cleanup of the now-unreferenced old file (deleteUploadedFile
    // logs-and-continues on failure) to avoid orphans accumulating in uploads.
    if (oldAvatar) deleteUploadedFile(oldAvatar);
    req.flash('success', 'Profile photo updated.');
  } catch (err) { console.error(err); req.flash('error', 'Could not save photo.'); }
  res.redirect('/settings');
});

// Remove the current avatar; clears the DB column first, then deletes the file
// from disk (same ordering rationale as the upload route above).
router.post('/avatar/remove', async (req, res) => {
  try {
    const oldAvatar = req.session.user.avatar_url;
    await pool.query('UPDATE users SET avatar_url = NULL WHERE id = ?', [req.session.user.id]);
    req.session.user.avatar_url = null;
    if (oldAvatar) deleteUploadedFile(oldAvatar);
    req.flash('success', 'Profile photo removed.');
  } catch (err) { console.error(err); req.flash('error', 'Could not remove photo.'); }
  res.redirect('/settings');
});

// Update the user's birthday (used for the family calendar).
router.post('/birthday', async (req, res) => {
  const { birthday_month, birthday_day, birthday_year } = req.body;
  if (!birthday_month || !birthday_day || !birthday_year) { req.flash('error', 'Birthday is required.'); return res.redirect('/settings'); }
  const birthday = `${birthday_year}-${birthday_month}-${birthday_day}`;
  // Strict calendar check: `new Date('2025-02-31')` silently rolls over to
  // March 3, which then fails MySQL strict mode with an opaque error.
  if (!isValidBirthday(birthday) || new Date(birthday) >= new Date()) {
    req.flash('error', 'Please enter a valid birthday.');
    return res.redirect('/settings');
  }
  try {
    await pool.query('UPDATE users SET birthday = ? WHERE id = ?', [birthday, req.session.user.id]);
    req.session.user.birthday = birthday;
    req.flash('success', 'Birthday updated.');
  } catch (err) { console.error(err); req.flash('error', 'Could not update birthday.'); }
  res.redirect('/settings');
});

// Save the user's push notification preferences for posts, comments, and big-news announcements.
// No flash success message — this is an auto-save handler; the flash message would be distracting.
router.post('/push-prefs', async (req, res) => {
  const isAjax = req.headers['x-requested-with'] === 'XMLHttpRequest';
  const push_notify_posts = req.body.push_notify_posts ? 1 : 0;
  const push_notify_comments = req.body.push_notify_comments ? 1 : 0;
  const push_notify_reactions = req.body.push_notify_reactions ? 1 : 0;
  const push_notify_big_news = req.body.push_notify_big_news ? 1 : 0;
  try {
    await pool.query(
      'UPDATE users SET push_notify_posts = ?, push_notify_comments = ?, push_notify_reactions = ?, push_notify_big_news = ? WHERE id = ?',
      [push_notify_posts, push_notify_comments, push_notify_reactions, push_notify_big_news, req.session.user.id]
    );
    req.session.user.push_notify_posts = push_notify_posts;
    req.session.user.push_notify_comments = push_notify_comments;
    req.session.user.push_notify_reactions = push_notify_reactions;
    req.session.user.push_notify_big_news = push_notify_big_news;
  } catch (err) {
    console.error(err);
    if (isAjax) return res.status(500).json({ ok: false, error: 'Could not save push preferences.' });
    req.flash('error', 'Could not save push preferences.');
  }
  if (isAjax) return res.json({ ok: true });
  res.redirect('/settings');
});

module.exports = router;
