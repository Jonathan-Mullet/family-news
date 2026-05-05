// Profile settings: display name, email, password, birthday, avatar upload/remove,
// and notification preferences (email + push).
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { handleAvatarUpload, deleteUploadedFile } = require('./upload');

// All profile routes require an authenticated session.
router.use(requireAuth);

// Render the profile settings page.
router.get('/', (req, res) => {
  res.render('profile');
});

// Update the user's display name.
router.post('/name', async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) { req.flash('error', 'Name is required.'); return res.redirect('/profile'); }
  try {
    await pool.query('UPDATE users SET name = ? WHERE id = ?', [name.trim(), req.session.user.id]);
    req.session.user.name = name.trim();
    req.flash('success', 'Name updated.');
  } catch (err) { console.error(err); req.flash('error', 'Could not update name.'); }
  res.redirect('/profile');
});

// Update the user's email address; requires current password confirmation.
router.post('/email', async (req, res) => {
  const { email, password } = req.body;
  if (!email?.trim()) { req.flash('error', 'Email is required.'); return res.redirect('/profile'); }
  try {
    const [rows] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [req.session.user.id]);
    if (!await bcrypt.compare(password, rows[0].password_hash)) {
      req.flash('error', 'Current password is incorrect.');
      return res.redirect('/profile');
    }
    await pool.query('UPDATE users SET email = ? WHERE id = ?', [email.trim().toLowerCase(), req.session.user.id]);
    req.session.user.email = email.trim().toLowerCase();
    req.flash('success', 'Email updated.');
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      req.flash('error', 'That email is already in use.');
      return res.redirect('/profile');
    }
    console.error(err);
    req.flash('error', 'Could not update email.');
  }
  res.redirect('/profile');
});

// Change the user's password; requires current password confirmation before applying the new hash.
router.post('/password', async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!new_password || new_password.length < 8) {
    req.flash('error', 'New password must be at least 8 characters.');
    return res.redirect('/profile');
  }
  try {
    const [rows] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [req.session.user.id]);
    if (!await bcrypt.compare(current_password, rows[0].password_hash)) {
      req.flash('error', 'Current password is incorrect.');
      return res.redirect('/profile');
    }
    const hash = await bcrypt.hash(new_password, 12);
    await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.session.user.id]);
    req.flash('success', 'Password changed successfully.');
  } catch (err) { console.error(err); req.flash('error', 'Could not update password.'); }
  res.redirect('/profile');
});

// Save the user's email notification preferences for new posts and comments.
router.post('/notifications', async (req, res) => {
  const notify_posts = req.body.notify_posts ? 1 : 0;
  const notify_comments = req.body.notify_comments ? 1 : 0;
  try {
    await pool.query(
      'UPDATE users SET notify_posts = ?, notify_comments = ? WHERE id = ?',
      [notify_posts, notify_comments, req.session.user.id]
    );
    req.session.user.notify_posts = notify_posts;
    req.session.user.notify_comments = notify_comments;
    req.flash('success', 'Notification preferences saved.');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not save preferences.');
  }
  res.redirect('/profile');
});

// Upload and save a new avatar; the old avatar file is deleted from disk before saving the new path.
router.post('/avatar', handleAvatarUpload, async (req, res) => {
  if (req.uploadError) { req.flash('error', req.uploadError); return res.redirect('/profile'); }
  if (!req.uploadedPath) { req.flash('error', 'No image received.'); return res.redirect('/profile'); }
  try {
    // Delete the existing avatar from disk to avoid orphaned files accumulating in the uploads volume.
    if (req.session.user.avatar_url) deleteUploadedFile(req.session.user.avatar_url);
    await pool.query('UPDATE users SET avatar_url = ? WHERE id = ?', [req.uploadedPath, req.session.user.id]);
    req.session.user.avatar_url = req.uploadedPath;
    req.flash('success', 'Profile photo updated.');
  } catch (err) { console.error(err); req.flash('error', 'Could not save photo.'); }
  res.redirect('/profile');
});

// Remove the current avatar; deletes the file from disk and clears the DB column.
router.post('/avatar/remove', async (req, res) => {
  try {
    if (req.session.user.avatar_url) deleteUploadedFile(req.session.user.avatar_url);
    await pool.query('UPDATE users SET avatar_url = NULL WHERE id = ?', [req.session.user.id]);
    req.session.user.avatar_url = null;
    req.flash('success', 'Profile photo removed.');
  } catch (err) { console.error(err); req.flash('error', 'Could not remove photo.'); }
  res.redirect('/profile');
});

// Update the user's birthday (used for the family calendar).
router.post('/birthday', async (req, res) => {
  const { birthday_month, birthday_day, birthday_year } = req.body;
  if (!birthday_month || !birthday_day || !birthday_year) { req.flash('error', 'Birthday is required.'); return res.redirect('/profile'); }
  const birthday = `${birthday_year}-${birthday_month}-${birthday_day}`;
  const date = new Date(birthday);
  if (isNaN(date.getTime()) || date >= new Date()) {
    req.flash('error', 'Please enter a valid birthday.');
    return res.redirect('/profile');
  }
  try {
    await pool.query('UPDATE users SET birthday = ? WHERE id = ?', [birthday, req.session.user.id]);
    req.session.user.birthday = birthday;
    req.flash('success', 'Birthday updated.');
  } catch (err) { console.error(err); req.flash('error', 'Could not update birthday.'); }
  res.redirect('/profile');
});

// Save the user's push notification preferences for posts, comments, and big-news announcements.
router.post('/push-prefs', async (req, res) => {
  const push_notify_posts = req.body.push_notify_posts ? 1 : 0;
  const push_notify_comments = req.body.push_notify_comments ? 1 : 0;
  const push_notify_big_news = req.body.push_notify_big_news ? 1 : 0;
  try {
    await pool.query(
      'UPDATE users SET push_notify_posts = ?, push_notify_comments = ?, push_notify_big_news = ? WHERE id = ?',
      [push_notify_posts, push_notify_comments, push_notify_big_news, req.session.user.id]
    );
    req.session.user.push_notify_posts = push_notify_posts;
    req.session.user.push_notify_comments = push_notify_comments;
    req.session.user.push_notify_big_news = push_notify_big_news;
    req.flash('success', 'Push notification preferences saved.');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not save push preferences.');
  }
  res.redirect('/profile');
});

module.exports = router;
