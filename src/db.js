/**
 * MySQL connection pool + schema init.
 *
 * Exports a shared `pool` for use throughout the app and an `initDb()`
 * function that creates all tables and runs incremental migrations.
 * Safe to call `initDb()` on every startup — all DDL uses IF NOT EXISTS;
 * migrations use try/catch so they are harmless when the column already exists
 * on a live database.
 */

const mysql = require('mysql2/promise');

// ── Connection pool ───────────────────────────────────────────────────────────

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'mysql',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'family_news',
  waitForConnections: true,
  connectionLimit: 10,
});

// ── Schema init ───────────────────────────────────────────────────────────────

/**
 * Creates all tables (if they do not already exist) and runs any pending
 * column-level migrations. Idempotent — safe to call on every app startup.
 *
 * @returns {Promise<void>}
 */
async function initDb() {
  const tables = [
    `CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      role ENUM('admin','member') DEFAULT 'member',
      active TINYINT(1) DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS invites (
      id INT AUTO_INCREMENT PRIMARY KEY,
      token VARCHAR(64) UNIQUE NOT NULL,
      created_by INT NOT NULL,
      used_by INT,
      expires_at TIMESTAMP NOT NULL,
      used_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id),
      FOREIGN KEY (used_by) REFERENCES users(id)
    )`,
    `CREATE TABLE IF NOT EXISTS posts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      title VARCHAR(255),
      content TEXT NOT NULL,
      photo_url VARCHAR(2048),
      pinned TINYINT(1) DEFAULT 0,
      edited_at TIMESTAMP NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`,
    `CREATE TABLE IF NOT EXISTS reactions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      post_id INT NOT NULL,
      user_id INT NOT NULL,
      emoji VARCHAR(10) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unique_reaction (post_id, user_id, emoji),
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`,
    `CREATE TABLE IF NOT EXISTS comments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      post_id INT NOT NULL,
      parent_id INT,
      user_id INT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_id) REFERENCES comments(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`,
    `CREATE TABLE IF NOT EXISTS comment_reactions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      comment_id INT NOT NULL,
      user_id INT NOT NULL,
      emoji VARCHAR(10) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unique_comment_reaction (comment_id, user_id, emoji),
      FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`,
    `CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      token VARCHAR(64) UNIQUE NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      used_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS events (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      type ENUM('birthday','anniversary') DEFAULT 'birthday',
      month TINYINT NOT NULL,
      day TINYINT NOT NULL,
      note VARCHAR(255),
      created_by INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id)
    )`,
    `CREATE TABLE IF NOT EXISTS post_reads (
      post_id INT NOT NULL,
      user_id INT NOT NULL,
      read_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (post_id, user_id),
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`,
    `CREATE TABLE IF NOT EXISTS link_previews (
      post_id INT PRIMARY KEY,
      url VARCHAR(2048),
      og_title VARCHAR(255),
      og_description TEXT,
      og_image VARCHAR(2048),
      fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS post_photos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      post_id INT NOT NULL,
      photo_url VARCHAR(2048) NOT NULL,
      sort_order TINYINT DEFAULT 0,
      UNIQUE KEY unique_photo_sort (post_id, sort_order),
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      endpoint VARCHAR(512) NOT NULL UNIQUE,
      p256dh VARCHAR(512) NOT NULL,
      auth VARCHAR(256) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS feedback (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      user_id     INT NOT NULL,
      type        ENUM('bug', 'feature') NOT NULL,
      title       VARCHAR(150) NOT NULL,
      description TEXT NOT NULL,
      severity    ENUM('low', 'medium', 'high') DEFAULT NULL,
      status      ENUM('open', 'resolved') NOT NULL DEFAULT 'open',
      admin_note  TEXT DEFAULT NULL,
      created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME DEFAULT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS changelog (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(200) NOT NULL,
      body TEXT NOT NULL,
      published_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS notifications (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      actor_id INT NOT NULL,
      type ENUM('comment', 'reply', 'mention', 'reaction') NOT NULL,
      post_id INT NOT NULL,
      comment_id INT DEFAULT NULL,
      meta VARCHAR(20) DEFAULT NULL,
      read_at DATETIME DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (actor_id) REFERENCES users(id),
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
    )`,
  ];
  for (const q of tables) await pool.query(q);

  // ── Migrations ──────────────────────────────────────────────────────────────
  // Each statement is wrapped in try/catch because ALTER TABLE fails with an
  // error (not a warning) if the column already exists. On a freshly created
  // database the column is present from the CREATE TABLE above; on a live
  // database that predates the column it gets added here. Either way the app
  // ends up in the correct state.
  const migrations = [
    `ALTER TABLE users ADD COLUMN active TINYINT(1) DEFAULT 1`,
    `ALTER TABLE posts ADD COLUMN pinned TINYINT(1) DEFAULT 0`,
    `ALTER TABLE posts ADD COLUMN edited_at TIMESTAMP NULL`,
    `ALTER TABLE users ADD COLUMN notify_posts TINYINT(1) DEFAULT 1`,
    `ALTER TABLE users ADD COLUMN notify_comments TINYINT(1) DEFAULT 1`,
    `ALTER TABLE posts ADD COLUMN publish_at TIMESTAMP NULL`,
    `ALTER TABLE users ADD COLUMN birthday DATE`,
    `ALTER TABLE users ADD COLUMN avatar_url VARCHAR(2048)`,
    `ALTER TABLE posts ADD COLUMN big_news TINYINT(1) DEFAULT 0`,
    // Backfills the post_photos table for posts created before multi-photo
    // support was added; posts that already stored a single photo_url on the
    // posts row get a corresponding row in post_photos at sort_order 0.
    `INSERT IGNORE INTO post_photos (post_id, photo_url, sort_order) SELECT id, photo_url, 0 FROM posts WHERE photo_url IS NOT NULL`,
    `ALTER TABLE invites ADD COLUMN max_uses INT DEFAULT 1`,
    `ALTER TABLE invites ADD COLUMN use_count INT DEFAULT 0`,
    `UPDATE invites SET use_count = 1 WHERE used_at IS NOT NULL AND use_count = 0`,
    `ALTER TABLE users ADD COLUMN push_notify_posts TINYINT(1) DEFAULT 1`,
    `ALTER TABLE users ADD COLUMN push_notify_comments TINYINT(1) DEFAULT 1`,
    `ALTER TABLE users ADD COLUMN push_notify_big_news TINYINT(1) DEFAULT 1`,
    // Safe to re-run: MODIFY COLUMN does not error if enum already matches; existing 'admin'/'member' values are preserved.
    `ALTER TABLE users MODIFY COLUMN role ENUM('admin','moderator','member') DEFAULT 'member'`,
    `ALTER TABLE posts ADD COLUMN deleted_at TIMESTAMP NULL`,
    `ALTER TABLE comments ADD COLUMN deleted_at TIMESTAMP NULL`,
    `ALTER TABLE posts MODIFY COLUMN deleted_at TIMESTAMP NULL`,
    `ALTER TABLE comments MODIFY COLUMN deleted_at TIMESTAMP NULL`,
    `ALTER TABLE users ADD COLUMN whats_new_seen_at DATETIME NULL`,
    `ALTER TABLE notifications ADD INDEX idx_user_read (user_id, read_at)`,
    // Comment reactions: extend the notification type enum and add the per-user
    // push preference. MODIFY COLUMN is declarative and safe to re-run; the
    // BOOLEAN/TINYINT(1) column follows the existing push_notify_* convention.
    `ALTER TABLE notifications MODIFY COLUMN type ENUM('comment','reply','mention','reaction','comment_reaction') NOT NULL`,
    `ALTER TABLE users ADD COLUMN push_notify_reactions TINYINT(1) DEFAULT 1`,
    `ALTER TABLE posts ADD FULLTEXT INDEX ft_posts (title, content)`,
    // System account that owns automated posts (birthdays, anniversaries) so
    // they don't appear authored by whichever admin happens to be first in
    // the table. active=0 keeps it out of the member count, @mention
    // autocomplete, and notification recipient lists — see cron.js. The
    // password hash is bcrypt of a random 32-byte string that was discarded
    // immediately after hashing; login with it is not possible.
    `INSERT IGNORE INTO users (name, email, password_hash, role, active) VALUES
      ('Family News', 'system@family-news.internal', '$2b$12$C2iVPCSz0DjSPA/312NDKus8D2p.DxN3LrfUeoPCq8rPgk2342qS6', 'member', 0)`,
  ];
  // Only the "already applied" duplicate errors are expected and silently
  // ignored: ER_DUP_FIELDNAME (column exists) and ER_DUP_KEYNAME (index
  // exists). Anything else — connection trouble, a genuinely failed ALTER
  // (e.g. FULLTEXT on an unsupported engine), bad SQL — is logged loudly so
  // a broken migration is visible in the container logs instead of being
  // swallowed. Startup still continues: none of these ALTERs are critical
  // enough to take the whole site down over, and crash-looping the container
  // would make things worse for a live deploy.
  const EXPECTED_MIGRATION_ERRORS = ['ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME'];
  for (const q of migrations) {
    try {
      await pool.query(q);
    } catch (err) {
      if (EXPECTED_MIGRATION_ERRORS.includes(err.code)) continue; // already applied
      console.error(`MIGRATION FAILED (continuing startup): ${q}\n  → ${err.code || ''} ${err.message}`);
    }
  }

  // ── notified_at migration + one-time backfill ───────────────────────────────
  // posts.notified_at records when family-wide notifications for a post were
  // sent (NULL = not yet sent; the 5-minute cron picks those up once
  // publish_at arrives). The backfill must run ONLY when the column is first
  // created — running it on every startup would stamp legitimately-pending
  // scheduled posts — so it lives inside the same try as the ALTER: once the
  // column exists the ALTER throws and the backfill is skipped. Backfilling
  // notified_at = created_at means the cron never re-notifies historical posts.
  try {
    await pool.query(`ALTER TABLE posts ADD COLUMN notified_at DATETIME NULL`);
    await pool.query(`UPDATE posts SET notified_at = created_at`);
  } catch (err) {
    // ER_DUP_FIELDNAME = column already exists, backfill already ran — the
    // expected steady-state. Anything else means the migration genuinely
    // failed and must be visible, not silent.
    if (err.code !== 'ER_DUP_FIELDNAME') {
      console.error(`MIGRATION FAILED (continuing startup): posts.notified_at\n  → ${err.code || ''} ${err.message}`);
    }
  }
}

module.exports = { pool, initDb };
