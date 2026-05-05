/**
 * Web Push (VAPID) notification helpers for Family News.
 *
 * All exported functions are no-ops when `VAPID_PUBLIC_KEY` is not set in the
 * environment, so the module is safe to load in any deployment configuration.
 * Subscriptions are stored in the `push_subscriptions` table; stale endpoints
 * are automatically pruned when the push service returns 410 or 404.
 */

const webpush = require('web-push');
const { pool } = require('./db');

// Columns on the `users` table that are valid push preference flags.
// Whitelisting prevents SQL injection if a call site ever passes user-controlled data.
const PUSH_PREF_COLUMNS = new Set(['push_notify_posts', 'push_notify_comments', 'push_notify_big_news']);

// ── VAPID initialisation ──────────────────────────────────────────────────────

// Only configure VAPID details when both keys are present; the module degrades
// gracefully (all sends become no-ops) when push is not configured.
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Sends a push notification to a single subscription object.
 * If the push service responds with 410 (Gone) or 404 (Not Found) the
 * subscription has been revoked by the browser/OS and is deleted from the
 * database automatically to avoid sending to dead endpoints in the future.
 *
 * @param {{endpoint: string, p256dh: string, auth: string}} sub - Subscription row from DB.
 * @param {object} payload - Notification payload; will be JSON-serialised.
 * @returns {Promise<void>}
 */
async function _sendToSubscription(sub, payload) {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload)
    );
  } catch (err) {
    if (err.statusCode === 410 || err.statusCode === 404) {
      // 410/404 means the subscription has expired or been unregistered —
      // remove it so we don't attempt delivery again.
      await pool.query('DELETE FROM push_subscriptions WHERE endpoint = ?', [sub.endpoint]);
    } else {
      console.error('Push send error:', err.statusCode, err.message, err.body || '');
    }
  }
}

// ── Exported send functions ───────────────────────────────────────────────────

/**
 * Sends a push notification to all active subscriptions for a single user.
 * No-op when VAPID is not configured.
 *
 * @param {number} userId - Target user's database ID.
 * @param {object} payload - Notification payload object (title, body, etc.).
 * @param {object} [options]
 * @param {string} [options.checkColumn] - When provided, a column name on the
 *   `users` table (e.g. `push_notify_posts`) that must be truthy for the
 *   notification to be sent. Allows per-user opt-out without extra queries at
 *   the call site.
 * @returns {Promise<void>}
 */
async function sendPushToUser(userId, payload, { checkColumn } = {}) {
  if (!process.env.VAPID_PUBLIC_KEY) return;
  try {
    if (checkColumn) {
      if (!PUSH_PREF_COLUMNS.has(checkColumn)) {
        console.error('sendPushToUser: unexpected checkColumn value:', checkColumn);
        return;
      }
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

/**
 * Sends a push notification to all active users, filtered by a per-user
 * preference column. No-op when VAPID is not configured or `checkColumn` is
 * omitted (requiring an explicit column prevents accidental mass-pushes).
 *
 * @param {object} payload - Notification payload object (title, body, etc.).
 * @param {object} options
 * @param {number} [options.excludeUserId=0] - User ID to exclude (typically the
 *   actor who triggered the event, to avoid self-notifications).
 * @param {string} options.checkColumn - Column name on `users` that must equal 1
 *   for the notification to be sent (e.g. `push_notify_comments`).
 * @returns {Promise<void>}
 */
async function sendPushToAllUsers(payload, { excludeUserId = 0, checkColumn }) {
  if (!process.env.VAPID_PUBLIC_KEY) return;
  if (!checkColumn) return;
  if (!PUSH_PREF_COLUMNS.has(checkColumn)) {
    console.error('sendPushToAllUsers: unexpected checkColumn value:', checkColumn);
    return;
  }
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
