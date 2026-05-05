/**
 * Scheduled tasks for Family News via node-cron.
 *
 * Currently runs a single daily job at 8 am server time. The server is a
 * Raspberry Pi 5 set to the America/Chicago timezone, so cron expressions
 * without an explicit timezone fire in Central Time.
 *
 * The job auto-posts birthday and anniversary messages. It handles two
 * distinct sources of events:
 *   1. `users.birthday` — a DATE column on the users table for family members
 *      who have accounts. Posts include a calculated age.
 *   2. `events` table — manually entered birthdays and anniversaries for
 *      people who do not have accounts (e.g. deceased relatives, children).
 */

const cron = require('node-cron');
const { pool } = require('./db');

// ── Scheduler ─────────────────────────────────────────────────────────────────

/**
 * Registers all cron jobs and starts the scheduler. Should be called once
 * during app startup.
 *
 * @returns {void}
 */
function startCron() {
  // Run at 8am every day
  cron.schedule('0 8 * * *', async () => {
    console.log('[cron] Checking birthday/anniversary events...');
    try {
      // The first admin user is used as the post author for all automated
      // posts. This avoids creating a dedicated system account and ensures
      // the post appears in the feed under a real family member's name.
      const [admins] = await pool.query(
        "SELECT id FROM users WHERE role = 'admin' AND active = 1 ORDER BY id LIMIT 1"
      );
      if (!admins.length) {
        console.log('[cron] No admin user found, skipping event posts.');
        return;
      }
      const adminId = admins[0].id;

      // ── User birthdays (users.birthday column) ──────────────────────────────
      // Only covers family members who have an account and have filled in their
      // birthday. Age is calculated from the birth year stored in the column.
      const [birthdayUsers] = await pool.query(
        'SELECT id, name, birthday FROM users WHERE MONTH(birthday) = MONTH(NOW()) AND DAY(birthday) = DAY(NOW()) AND active = 1'
      );
      for (const u of birthdayUsers) {
        const age = new Date().getFullYear() - new Date(u.birthday).getFullYear();
        const content = `🎂 Today is ${u.name}'s birthday — turning ${age}! 🎉`;
        await pool.query('INSERT INTO posts (user_id, title, content) VALUES (?, NULL, ?)', [adminId, content]);
        console.log(`[cron] Birthday post for: ${u.name} (${age})`);
      }

      // ── Manual events table ─────────────────────────────────────────────────
      // Covers anniversaries and birthdays for people without accounts. Events
      // are entered by an admin via the /admin/events UI and stored by
      // month+day (no year), so no age calculation is possible here.
      const [events] = await pool.query(
        'SELECT * FROM events WHERE month = MONTH(NOW()) AND day = DAY(NOW())'
      );
      for (const event of events) {
        let content;
        if (event.type === 'birthday') {
          content = `🎂 Today is ${event.name}'s birthday! 🎉`;
        } else {
          content = `💍 Happy anniversary, ${event.name}! 🎊`;
        }
        if (event.note) content += `\n${event.note}`;
        await pool.query('INSERT INTO posts (user_id, title, content) VALUES (?, NULL, ?)', [adminId, content]);
        console.log(`[cron] Event post for: ${event.name} (${event.type})`);
      }
    } catch (err) {
      console.error('[cron] Error processing events:', err.message);
    }
  });

  console.log('[cron] Birthday/anniversary scheduler started.');
}

module.exports = { startCron };
