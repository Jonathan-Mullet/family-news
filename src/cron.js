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
const { deleteUploadedFile } = require('./routes/upload');

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

  // Run at 3am every day: hard-delete soft-deleted posts and comments older than 14 days.
  cron.schedule('0 3 * * *', async () => {
    console.log('[cron] Running trash purge...');
    try {
      const [stalePosts] = await pool.query(
        'SELECT id FROM posts WHERE deleted_at IS NOT NULL AND deleted_at < DATE_SUB(NOW(), INTERVAL 14 DAY)'
      );
      for (const post of stalePosts) {
        const [photos] = await pool.query('SELECT photo_url FROM post_photos WHERE post_id = ?', [post.id]);
        photos.forEach(ph => deleteUploadedFile(ph.photo_url));
        await pool.query('DELETE FROM posts WHERE id = ?', [post.id]);
        console.log(`[cron] Purged post ${post.id}`);
      }
      // Purge standalone deleted comments whose parent post is still alive
      const [staleComments] = await pool.query(`
        SELECT c.id FROM comments c
        JOIN posts p ON c.post_id = p.id
        WHERE c.deleted_at IS NOT NULL AND c.deleted_at < DATE_SUB(NOW(), INTERVAL 14 DAY)
          AND p.deleted_at IS NULL
      `);
      for (const comment of staleComments) {
        await pool.query('DELETE FROM comments WHERE id = ?', [comment.id]);
        console.log(`[cron] Purged comment ${comment.id}`);
      }
      console.log(`[cron] Trash purge complete: ${stalePosts.length} posts, ${staleComments.length} comments.`);
    } catch (err) {
      console.error('[cron] Error purging trash:', err.message);
    }
  });

  console.log('[cron] Birthday/anniversary scheduler started.');
}

module.exports = { startCron };
