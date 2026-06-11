/**
 * Scheduled tasks for Family News via node-cron.
 *
 * The container clock runs UTC, so every daily job passes an explicit
 * `{ timezone: 'America/Los_Angeles' }` option — without it a "0 8 * * *"
 * schedule would fire at 8 am UTC (midnight/1 am Pacific), not the labeled
 * local hour the family expects.
 *
 * Jobs:
 *   - 8 am Pacific daily: auto-posts birthday and anniversary messages from
 *     two sources: `users.birthday` (members with accounts; includes age) and
 *     the `events` table (manually entered events for people without accounts).
 *   - 3 am Pacific daily: purges soft-deleted posts/comments older than 14 days.
 *   - Every 5 minutes: delivers email/push notifications for scheduled posts
 *     whose publish_at has arrived (the create route deliberately skips
 *     notifications for future-dated posts).
 */

const cron = require('node-cron');
const { pool } = require('./db');
const { deleteUploadedFile } = require('./routes/upload');
const { sendNewPostNotification, sendBigNewsNotification, sendMentionNotification } = require('./email');
const { sendPushToAllUsers, sendPushToUser } = require('./push');

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
      // Feb-29 birthdays: in non-leap years Feb 29 never matches NOW(), so the
      // OR clause celebrates them on Feb 28 instead (only when this February
      // actually ends on the 28th — in leap years the exact match handles it).
      const [birthdayUsers] = await pool.query(
        `SELECT id, name, birthday FROM users WHERE active = 1 AND (
           (MONTH(birthday) = MONTH(NOW()) AND DAY(birthday) = DAY(NOW()))
           OR (MONTH(birthday) = 2 AND DAY(birthday) = 29
               AND MONTH(NOW()) = 2 AND DAY(NOW()) = 28 AND DAY(LAST_DAY(NOW())) = 28)
         )`
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
      // Same Feb-29 handling as user birthdays above.
      const [events] = await pool.query(
        `SELECT * FROM events WHERE
           (month = MONTH(NOW()) AND day = DAY(NOW()))
           OR (month = 2 AND day = 29
               AND MONTH(NOW()) = 2 AND DAY(NOW()) = 28 AND DAY(LAST_DAY(NOW())) = 28)`
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
  }, { timezone: 'America/Los_Angeles' });

  // Run at 3am every day (Pacific): hard-delete soft-deleted posts and comments older than 14 days.
  cron.schedule('0 3 * * *', async () => {
    console.log('[cron] Running trash purge...');
    try {
      const [stalePosts] = await pool.query(
        'SELECT id FROM posts WHERE deleted_at IS NOT NULL AND deleted_at < DATE_SUB(NOW(), INTERVAL 14 DAY)'
      );
      for (const post of stalePosts) {
        // Snapshot photo paths first (DELETE cascades post_photos away), but
        // unlink only AFTER the row delete succeeds — an orphaned file is
        // recoverable, a deleted file under a still-live DB row is not.
        const [photos] = await pool.query('SELECT photo_url FROM post_photos WHERE post_id = ?', [post.id]);
        const [result] = await pool.query('DELETE FROM posts WHERE id = ? AND deleted_at IS NOT NULL', [post.id]);
        if (result.affectedRows > 0) photos.forEach(ph => deleteUploadedFile(ph.photo_url));
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
  }, { timezone: 'America/Los_Angeles' });

  // Every 5 minutes: deliver notifications for scheduled posts whose publish
  // time has arrived. The create route (src/routes/posts.js) deliberately
  // skips ALL notifications when publish_at is in the future and leaves
  // notified_at NULL; this job sends the same email/push/mention notifications
  // once the post is live. (No timezone option needed — */5 is wall-clock
  // agnostic, and the query compares UTC NOW() against UTC publish_at.)
  cron.schedule('*/5 * * * *', async () => {
    try {
      const [due] = await pool.query(`
        SELECT p.id, p.title, p.content, p.big_news, p.user_id, u.name AS author_name
        FROM posts p JOIN users u ON p.user_id = u.id
        WHERE p.publish_at IS NOT NULL AND p.publish_at <= NOW()
          AND p.notified_at IS NULL AND p.deleted_at IS NULL
      `);
      if (!due.length) return;
      const [users] = await pool.query('SELECT id, email, notify_posts FROM users WHERE active = 1');

      for (const post of due) {
        // Stamp notified_at BEFORE sending anything — at-most-once delivery,
        // chosen deliberately: if the process crashes mid-send, some members
        // may miss one notification, but the whole family can never be
        // double-emailed. The notified_at IS NULL guard in the UPDATE also
        // prevents two overlapping ticks from both claiming the same post.
        const [claim] = await pool.query(
          'UPDATE posts SET notified_at = NOW() WHERE id = ? AND notified_at IS NULL',
          [post.id]
        );
        if (claim.affectedRows !== 1) continue;

        const poster = { id: post.user_id, name: post.author_name };
        // Stored content carries resolved @[Name](id) tokens; render them back
        // to plain "@Name" for email/push bodies.
        const plainContent = post.content.replace(/@\[([^\]]+)\]\(\d+\)/g, '@$1');
        const postForEmail = { id: post.id, title: post.title, content: plainContent };

        if (post.big_news) {
          sendBigNewsNotification(users, poster, postForEmail)
            .catch(err => console.error('[cron] Big news email error:', err));
          sendPushToAllUsers(
            { title: `📣 Big News from ${poster.name}`, body: (post.title || plainContent).substring(0, 100), url: `/post/${post.id}` },
            { excludeUserId: poster.id, checkColumn: 'push_notify_big_news' }
          ).catch(err => console.error('[cron] Big news push error:', err));
        } else {
          sendNewPostNotification(users, poster, postForEmail)
            .catch(err => console.error('[cron] New post email error:', err));
          sendPushToAllUsers(
            { title: `${poster.name} posted`, body: plainContent.substring(0, 100), url: '/' },
            { excludeUserId: poster.id, checkColumn: 'push_notify_posts' }
          ).catch(err => console.error('[cron] New post push error:', err));
        }

        // Mentions were also deferred at create time. The mentioned user ids
        // are recovered from the stored @[Name](id) tokens (no name re-matching).
        const mentionIds = [...new Set(
          [...post.content.matchAll(/@\[[^\]]+\]\((\d+)\)/g)].map(m => parseInt(m[1], 10))
        )].filter(id => id !== post.user_id);
        if (mentionIds.length) {
          try {
            const [mentioned] = await pool.query(
              'SELECT id, email, name FROM users WHERE id IN (?) AND active = 1',
              [mentionIds]
            );
            const excerpt = plainContent.substring(0, 80);
            const postUrl = `${process.env.BASE_URL}/post/${post.id}`;
            for (const mu of mentioned) {
              sendPushToUser(mu.id, { title: `${poster.name} mentioned you`, body: excerpt, url: `/post/${post.id}` })
                .catch(err => console.error('[cron] Mention push error:', err));
              sendMentionNotification(mu.email, mu.name, poster.name, excerpt, postUrl)
                .catch(err => console.error('[cron] Mention email error:', err));
              pool.query(
                'INSERT INTO notifications (user_id, actor_id, type, post_id) VALUES (?, ?, ?, ?)',
                [mu.id, post.user_id, 'mention', post.id]
              ).catch(e => console.error('[cron] Mention notification insert error:', e.message));
            }
          } catch (e) {
            console.error('[cron] Mention delivery error:', e.message);
          }
        }
        console.log(`[cron] Sent notifications for scheduled post ${post.id}`);
      }
    } catch (err) {
      console.error('[cron] Scheduled-post notification error:', err.message);
    }
  });

  console.log('[cron] Birthday/anniversary scheduler started.');
}

module.exports = { startCron };
