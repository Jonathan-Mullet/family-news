const cron = require('node-cron');
const { pool } = require('./db');

function startCron() {
  // Run at 8am every day
  cron.schedule('0 8 * * *', async () => {
    console.log('[cron] Checking birthday/anniversary events...');
    try {
      // Find the first admin user
      const [admins] = await pool.query(
        "SELECT id FROM users WHERE role = 'admin' AND active = 1 ORDER BY id LIMIT 1"
      );
      if (!admins.length) {
        console.log('[cron] No admin user found, skipping event posts.');
        return;
      }
      const adminId = admins[0].id;

      // Find events for today
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
        if (event.note) {
          content += `\n${event.note}`;
        }
        await pool.query(
          'INSERT INTO posts (user_id, title, content) VALUES (?, NULL, ?)',
          [adminId, content]
        );
        console.log(`[cron] Created event post for: ${event.name} (${event.type})`);
      }
    } catch (err) {
      console.error('[cron] Error processing events:', err.message);
    }
  });

  console.log('[cron] Birthday/anniversary scheduler started.');
}

module.exports = { startCron };
