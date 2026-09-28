// Serializes the check-then-act dedup logic for reaction notifications
// (SELECT existing unread row -> INSERT or UPDATE/DELETE) against concurrent
// requests for the same (recipient, actor, target) tuple. Without this, two
// near-simultaneous toggles (e.g. tapping two emoji in quick succession, or
// react-then-immediately-unreact) can interleave their SELECTs before either
// has written, producing duplicate notification rows or a "ghost" row that
// outlives the reaction it was for.
//
// GET_LOCK/RELEASE_LOCK are connection-scoped in MySQL, so both calls must
// share one checked-out connection rather than going through the pool.
async function withNotifyLock(pool, key, fn) {
  const conn = await pool.getConnection();
  try {
    const [[{ locked }]] = await conn.query('SELECT GET_LOCK(?, 5) AS locked', [key]);
    if (!locked) {
      console.error('withNotifyLock: could not acquire lock for', key);
      return;
    }
    try {
      await fn(conn);
    } finally {
      await conn.query('SELECT RELEASE_LOCK(?)', [key]);
    }
  } finally {
    conn.release();
  }
}

module.exports = { withNotifyLock };
