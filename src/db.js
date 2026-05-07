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
      FOREIGN KEY (user_id) REFERENCES users(id)
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
  ];
  for (const q of migrations) {
    try { await pool.query(q); } catch { /* column already exists */ }
  }
}

module.exports = { pool, initDb };
