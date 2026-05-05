const webpush = require('web-push');
const { pool } = require('./db');

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

async function _sendToSubscription(sub, payload) {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload)
    );
  } catch (err) {
    if (err.statusCode === 410 || err.statusCode === 404) {
      await pool.query('DELETE FROM push_subscriptions WHERE endpoint = ?', [sub.endpoint]);
    } else {
      console.error('Push send error:', err.message);
    }
  }
}

async function sendPushToUser(userId, payload, { checkColumn } = {}) {
  if (!process.env.VAPID_PUBLIC_KEY) return;
  try {
    if (checkColumn) {
      const [[user]] = await pool.query(`SELECT \`${checkColumn}\` AS pref FROM users WHERE id = ?`, [userId]);
      if (!user || !user.pref) return;
    }
    const [subs] = await pool.query(
      'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?',
      [userId]
    );
    for (const sub of subs) await _sendToSubscription(sub, payload);
  } catch (err) {
    console.error('sendPushToUser error:', err.message);
  }
}

async function sendPushToAllUsers(payload, { excludeUserId = 0, checkColumn }) {
  if (!process.env.VAPID_PUBLIC_KEY) return;
  if (!checkColumn) return;
  try {
    const [subs] = await pool.query(
      `SELECT ps.endpoint, ps.p256dh, ps.auth
       FROM push_subscriptions ps
       JOIN users u ON ps.user_id = u.id
       WHERE u.active = 1 AND u.\`${checkColumn}\` = 1 AND ps.user_id != ?`,
      [excludeUserId]
    );
    for (const sub of subs) await _sendToSubscription(sub, payload);
  } catch (err) {
    console.error('sendPushToAllUsers error:', err.message);
  }
}

module.exports = { sendPushToUser, sendPushToAllUsers };
