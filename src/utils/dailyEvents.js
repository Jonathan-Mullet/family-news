/**
 * Daily birthday and anniversary posts, authored by the "Family News" system account.
 *
 * Safe to run more than once a day: a post with the same text by the system account in the
 * last 20 hours (deleted or not) means it already went out. That lets the scheduler retry,
 * and lets startup catch up a day whose 8 am run was missed (a restart, a deploy, or node-cron
 * skipping a run that started late), without ever double-posting.
 *
 * "Today" is the family's date (tz), not the server's UTC date — a catch-up at 9 pm Pacific
 * is already tomorrow in UTC.
 */

/** Year, month, day and hour of `now` in `tz`. */
function familyDate(now, tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', hourCycle: 'h23',
  }).formatToParts(now).map((p) => [p.type, p.value]));
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day), hour: Number(parts.hour) };
}

const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** The year a DATE column value was in (mysql2 gives a Date; strings are tolerated). */
function birthYear(v) {
  if (v instanceof Date) return v.getUTCFullYear();
  return Number(String(v).slice(0, 4));
}

/**
 * @param {{query: Function}} db mysql2 pool (or anything with the same query shape)
 * @returns {Promise<{posted: string[], skippedReason?: string}>}
 */
async function postDailyEvents(db, { now = new Date(), tz = 'America/Los_Angeles' } = {}) {
  const [systemUsers] = await db.query("SELECT id FROM users WHERE email = 'system@family-news.internal' LIMIT 1");
  if (!systemUsers.length) return { posted: [], skippedReason: 'no system user' };
  const systemUserId = systemUsers[0].id;
  const { y, m, d } = familyDate(now, tz);
  // Feb 29 people are celebrated on Feb 28 in years without a Feb 29.
  const days = m === 2 && d === 28 && !isLeap(y) ? [28, 29] : [d];

  const contents = [];
  for (const day of days) {
    const [users] = await db.query(
      'SELECT id, name, birthday FROM users WHERE active = 1 AND birthday IS NOT NULL AND MONTH(birthday) = ? AND DAY(birthday) = ?',
      [m, day]
    );
    for (const u of users) contents.push(`🎂 Today is ${u.name}'s birthday — turning ${y - birthYear(u.birthday)}! 🎉`);
    const [events] = await db.query('SELECT * FROM events WHERE month = ? AND day = ?', [m, day]);
    for (const e of events) {
      let c = e.type === 'birthday' ? `🎂 Today is ${e.name}'s birthday! 🎉` : `💍 Happy anniversary, ${e.name}! 🎊`;
      if (e.note) c += `\n${e.note}`;
      contents.push(c);
    }
  }

  const posted = [];
  for (const content of contents) {
    const [already] = await db.query(
      'SELECT 1 FROM posts WHERE user_id = ? AND content = ? AND created_at > NOW() - INTERVAL 20 HOUR LIMIT 1',
      [systemUserId, content]
    );
    if (already.length) continue;
    await db.query('INSERT INTO posts (user_id, title, content) VALUES (?, NULL, ?)', [systemUserId, content]);
    posted.push(content);
  }
  return { posted };
}

module.exports = { postDailyEvents, familyDate };
