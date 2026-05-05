// Push notification subscription management — subscribe/unsubscribe endpoints and VAPID public key endpoint.
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

// All push routes require an authenticated session.
router.use(requireAuth);

// Return the VAPID public key so the browser service worker can create a push subscription.
router.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || '' });
});

// Save a push subscription for the current user; also auto-opts the user out of email notifications
// when push is enabled — a deliberate UX choice to avoid double-notifying on the same event.
router.post('/subscribe', async (req, res) => {
  const { endpoint, p256dh, auth } = req.body;
  if (!endpoint || !p256dh || !auth) return res.status(400).json({ error: 'Missing fields' });
  const userId = req.session.user.id;
  try {
    await pool.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE p256dh = VALUES(p256dh), auth = VALUES(auth)`,
      [userId, endpoint, p256dh, auth]
    );
    const [[user]] = await pool.query('SELECT notify_posts, notify_comments FROM users WHERE id = ?', [userId]);
    let emailsOptedOut = false;
    if (user.notify_posts || user.notify_comments) {
      await pool.query('UPDATE users SET notify_posts = 0, notify_comments = 0 WHERE id = ?', [userId]);
      req.session.user.notify_posts = 0;
      req.session.user.notify_comments = 0;
      emailsOptedOut = true;
    }
    res.json({ ok: true, emailsOptedOut });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save subscription' });
  }
});

// Remove a push subscription by endpoint so no further notifications are sent to that browser.
router.post('/unsubscribe', async (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ error: 'Missing endpoint' });
  try {
    await pool.query(
      'DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?',
      [endpoint, req.session.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not remove subscription' });
  }
});

module.exports = router;
