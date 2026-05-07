// Admin-only routes (protected by requireAdmin on the router itself): user management,
// invite creation, and birthday/anniversary event management.
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const crypto = require('crypto');
const { sendPasswordReset, sendPromotionNotification, sendFeedbackResolved } = require('../email');
const { sendPushToUser, sendTestPushById } = require('../push');
const fs = require('fs');
const path = require('path');

// All routes in this file require admin role; non-admins are rejected before any handler runs.
router.use(requireAdmin);

// Render the admin dashboard with users, recent invites, and calendar events.
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
      ORDER BY i.created_at DESC LIMIT 50
    `);
    const [events] = await pool.query('SELECT * FROM events ORDER BY month, day, name');
    const [feedback] = await pool.query(`
      SELECT f.*, u.name AS user_name, u.email AS user_email
      FROM feedback f JOIN users u ON f.user_id = u.id
      ORDER BY (f.status = 'open') DESC, f.created_at DESC
    `);

    // ── Analytics ────────────────────────────────────────────────────────────
    const [[stats7d]] = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM posts WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND deleted_at IS NULL) AS posts,
        (SELECT COUNT(*) FROM comments WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND deleted_at IS NULL) AS comments,
        (SELECT COUNT(*) FROM reactions WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)) AS reactions,
        (SELECT COUNT(*) FROM users WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND active = 1) AS new_members
    `);
    const [[stats30d]] = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM posts WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) AND deleted_at IS NULL) AS posts,
        (SELECT COUNT(*) FROM comments WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) AND deleted_at IS NULL) AS comments,
        (SELECT COUNT(*) FROM reactions WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)) AS reactions,
        (SELECT COUNT(*) FROM users WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) AND active = 1) AS new_members
    `);
    const [topByReads] = await pool.query(`
      SELECT p.id, COALESCE(NULLIF(p.title,''), SUBSTRING(p.content, 1, 60)) AS label,
        u.name AS author_name, COUNT(pr.user_id) AS cnt
      FROM posts p JOIN users u ON p.user_id = u.id
      LEFT JOIN post_reads pr ON pr.post_id = p.id
      WHERE p.deleted_at IS NULL
      GROUP BY p.id ORDER BY cnt DESC LIMIT 5
    `);
    const [topByReactions] = await pool.query(`
      SELECT p.id, COALESCE(NULLIF(p.title,''), SUBSTRING(p.content, 1, 60)) AS label,
        u.name AS author_name, COUNT(r.id) AS cnt
      FROM posts p JOIN users u ON p.user_id = u.id
      LEFT JOIN reactions r ON r.post_id = p.id
      WHERE p.deleted_at IS NULL
      GROUP BY p.id ORDER BY cnt DESC LIMIT 5
    `);
    const [topByComments] = await pool.query(`
      SELECT p.id, COALESCE(NULLIF(p.title,''), SUBSTRING(p.content, 1, 60)) AS label,
        u.name AS author_name, COUNT(c.id) AS cnt
      FROM posts p JOIN users u ON p.user_id = u.id
      LEFT JOIN comments c ON c.post_id = p.id AND c.deleted_at IS NULL
      WHERE p.deleted_at IS NULL
      GROUP BY p.id ORDER BY cnt DESC LIMIT 5
    `);
    const [topMembers] = await pool.query(`
      SELECT sub.id, sub.name, sub.post_count, sub.comment_count
      FROM (
        SELECT u.id, u.name,
          (SELECT COUNT(*) FROM posts p WHERE p.user_id = u.id AND p.deleted_at IS NULL) AS post_count,
          (SELECT COUNT(*) FROM comments c WHERE c.user_id = u.id AND c.deleted_at IS NULL) AS comment_count
        FROM users u WHERE u.active = 1
      ) AS sub
      ORDER BY (sub.post_count + sub.comment_count) DESC LIMIT 5
    `);

    // ── Scheduled posts ───────────────────────────────────────────────────────
    const [scheduledPosts] = await pool.query(`
      SELECT p.id, p.title, p.content, p.publish_at, u.name AS author_name
      FROM posts p JOIN users u ON p.user_id = u.id
      WHERE p.publish_at > NOW() AND p.deleted_at IS NULL
      ORDER BY p.publish_at ASC
    `);

    // ── Push subscriptions ────────────────────────────────────────────────────
    const [pushSubs] = await pool.query(`
      SELECT ps.id, ps.user_id, ps.endpoint, ps.created_at, u.name AS user_name
      FROM push_subscriptions ps JOIN users u ON ps.user_id = u.id
      ORDER BY u.name, ps.created_at
    `);

    // ── Per-post read receipts (last 30 published posts) ─────────────────────
    const [[{ memberCount }]] = await pool.query(
      'SELECT COUNT(*) AS memberCount FROM users WHERE active = 1'
    );
    const [recentPostsForReads] = await pool.query(`
      SELECT p.id, COALESCE(NULLIF(p.title,''), SUBSTRING(p.content, 1, 60)) AS label,
        p.created_at, u.name AS author_name, COUNT(pr.user_id) AS read_count
      FROM posts p JOIN users u ON p.user_id = u.id
      LEFT JOIN post_reads pr ON pr.post_id = p.id
      WHERE p.deleted_at IS NULL AND (p.publish_at IS NULL OR p.publish_at <= NOW())
      GROUP BY p.id ORDER BY p.created_at DESC LIMIT 30
    `);
    let readersByPost = {};
    if (recentPostsForReads.length) {
      const recentIds = recentPostsForReads.map(p => p.id);
      const [readerRows] = await pool.query(
        `SELECT pr.post_id, u.name AS reader_name
         FROM post_reads pr JOIN users u ON pr.user_id = u.id
         WHERE pr.post_id IN (?)`,
        [recentIds]
      );
      readerRows.forEach(r => {
        if (!readersByPost[r.post_id]) readersByPost[r.post_id] = [];
        readersByPost[r.post_id].push(r.reader_name);
      });
    }

    const [changelog] = await pool.query(
      'SELECT id, title, published_at FROM changelog ORDER BY published_at DESC'
    );

    res.render('admin', {
      users, invites, events, feedback, baseUrl: process.env.BASE_URL,
      stats7d, stats30d, topByReads, topByReactions, topByComments, topMembers,
      scheduledPosts, pushSubs, memberCount, recentPostsForReads, readersByPost,
      changelog,
    });
  } catch (err) {
    console.error(err);
    res.render('error', { message: 'Could not load admin panel.' });
  }
});

// Create an invite link; open invites allow up to 50 uses and expire in 2 days (for sharing broadly),
// while single-use invites allow exactly 1 use and expire in 7 days (for one specific person).
router.post('/invites', async (req, res) => {
  const isOpen = req.body.type === 'open';
  try {
    const token = uuidv4().replace(/-/g, '');
    const sql = isOpen
      ? 'INSERT INTO invites (token, created_by, expires_at, max_uses) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 2 DAY), ?)'
      : 'INSERT INTO invites (token, created_by, expires_at, max_uses) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY), ?)';
    await pool.query(sql, [token, req.session.user.id, isOpen ? 50 : 1]);
    req.flash('success', `${process.env.BASE_URL}/register?invite=${token}`);
    req.flash('invite_type', isOpen ? 'open' : 'single');
    res.redirect('/admin');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not create invite.');
    res.redirect('/admin');
  }
});

// Immediately expire an invite so it can no longer be used.
router.post('/invites/:id/revoke', async (req, res) => {
  try {
    await pool.query('UPDATE invites SET expires_at = NOW() WHERE id = ?', [req.params.id]);
    req.flash('success', 'Invite revoked.');
  } catch (err) { console.error(err); }
  res.redirect('/admin');
});

// Toggle a user's active flag (enable/disable login); an admin cannot deactivate their own account.
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

// Set a user's role to member, moderator, or admin; sends a promotion notification for upgrades.
router.post('/users/:id/set-role', async (req, res) => {
  if (parseInt(req.params.id) === req.session.user.id) {
    req.flash('error', 'You cannot change your own role.');
    return res.redirect('/admin');
  }
  const { role } = req.body;
  if (!['member', 'moderator', 'admin'].includes(role)) {
    req.flash('error', 'Invalid role.');
    return res.redirect('/admin');
  }
  try {
    const [[target]] = await pool.query('SELECT id, name, email, role FROM users WHERE id = ?', [req.params.id]);
    if (!target) { req.flash('error', 'User not found.'); return res.redirect('/admin'); }
    await pool.query('UPDATE users SET role = ? WHERE id = ?', [role, req.params.id]);
    const roleRank = { member: 0, moderator: 1, admin: 2 };
    if (roleRank[role] > roleRank[target.role]) {
      const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);
      sendPushToUser(target.id, { title: `You've been made a ${roleLabel} on Family News 🎉`, body: 'Tap to see your new guide.', url: '/guide' });
      sendPromotionNotification(target.email, target.name, role);
    }
  } catch (err) { console.error(err); }
  res.redirect('/admin');
});

// Add a birthday or anniversary event to the shared family calendar.
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

// Remove a calendar event permanently.
router.post('/events/:id/delete', async (req, res) => {
  try {
    await pool.query('DELETE FROM events WHERE id = ?', [req.params.id]);
  } catch (err) { console.error(err); }
  res.redirect('/admin');
});

// Send a password reset email to any user on behalf of an admin (e.g., when a member is locked out).
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

// Update the email address on file for any user account.
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

// Mark a feedback item resolved and send a courtesy email to the submitter.
router.post('/feedback/:id/resolve', async (req, res) => {
  const note = req.body.admin_note?.trim() || 'Thanks for the report — this has been addressed!';
  try {
    const [[item]] = await pool.query(
      `SELECT f.*, u.email AS user_email, u.name AS user_name
       FROM feedback f JOIN users u ON f.user_id = u.id WHERE f.id = ?`,
      [req.params.id]
    );
    if (!item) { req.flash('error', 'Feedback item not found.'); return res.redirect('/admin'); }
    if (item.status === 'resolved') { req.flash('error', 'Already resolved.'); return res.redirect('/admin'); }
    await pool.query(
      'UPDATE feedback SET status = ?, admin_note = ?, resolved_at = NOW() WHERE id = ?',
      ['resolved', note, req.params.id]
    );
    (async () => {
      await sendFeedbackResolved(item.user_email, item.user_name, item, note);
    })().catch(console.error);
    req.flash('success', `Resolved and notified ${item.user_name}.`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not resolve feedback.');
  }
  res.redirect('/admin');
});

// Cancel a scheduled post (null publish_at and soft-delete it).
router.post('/posts/:id/cancel-scheduled', async (req, res) => {
  try {
    const [[post]] = await pool.query(
      'SELECT id, publish_at FROM posts WHERE id = ? AND deleted_at IS NULL',
      [req.params.id]
    );
    if (!post || !post.publish_at || new Date(post.publish_at) <= new Date()) {
      req.flash('error', 'Scheduled post not found.');
      return res.redirect('/admin');
    }
    await pool.query(
      'UPDATE posts SET publish_at = NULL, deleted_at = NOW() WHERE id = ?',
      [req.params.id]
    );
    req.flash('success', 'Scheduled post cancelled.');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not cancel post.');
  }
  res.redirect('/admin');
});

// Update the scheduled time of a future post; new time must be in the future.
router.post('/posts/:id/reschedule', async (req, res) => {
  const { publish_at } = req.body;
  if (!publish_at) {
    req.flash('error', 'No date provided.');
    return res.redirect('/admin');
  }
  const parsed = new Date(publish_at);
  if (isNaN(parsed.getTime()) || parsed <= new Date()) {
    req.flash('error', 'New time must be in the future.');
    return res.redirect('/admin');
  }
  try {
    const [[post]] = await pool.query(
      'SELECT id FROM posts WHERE id = ? AND deleted_at IS NULL AND publish_at > NOW()',
      [req.params.id]
    );
    if (!post) {
      req.flash('error', 'Scheduled post not found.');
      return res.redirect('/admin');
    }
    await pool.query('UPDATE posts SET publish_at = ? WHERE id = ?', [parsed, req.params.id]);
    req.flash('success', 'Post rescheduled.');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not reschedule post.');
  }
  res.redirect('/admin');
});

// Delete a push subscription row permanently.
router.post('/push/:id/remove', async (req, res) => {
  try {
    await pool.query('DELETE FROM push_subscriptions WHERE id = ?', [req.params.id]);
    req.flash('success', 'Subscription removed.');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not remove subscription.');
  }
  res.redirect('/admin');
});

// Send a test push to a specific subscription; returns JSON (no page reload).
router.post('/push/:id/test', async (req, res) => {
  const result = await sendTestPushById(parseInt(req.params.id));
  res.json(result);
});

// Delete a changelog entry and update the sidecar file so the nav dot reflects the new latest.
router.post('/changelog/:id/delete', async (req, res) => {
  await pool.query('DELETE FROM changelog WHERE id = ?', [req.params.id]);
  const [[row]] = await pool.query('SELECT MAX(published_at) AS latestAt FROM changelog');
  const newLatest = row.latestAt ? new Date(row.latestAt).toISOString() : null;
  req.app.locals.latestChangelogAt = newLatest;
  const sidecarPath = path.join(__dirname, '../data/changelog-meta.json');
  fs.writeFileSync(sidecarPath, JSON.stringify({ latestAt: newLatest }, null, 2) + '\n');
  res.redirect('/admin');
});

module.exports = router;
