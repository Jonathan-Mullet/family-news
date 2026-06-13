require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const flash = require('connect-flash');
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pool, initDb } = require('./db');
const { startCron } = require('./cron');
const { renderContent } = require('./utils/mentions');
const { extractVideoEmbed } = require('./utils/videoEmbed');

// ── Express setup ────────────────────────────────────────────────────────────
const app = express();
// Required for secure session cookies to work behind the Nginx reverse proxy;
// without this, Express sees every request as non-HTTPS and won't set Secure cookies.
app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.locals.renderContent = renderContent;
app.locals.extractVideoEmbed = extractVideoEmbed;

// Content hash of CSS + JS — changes on every deploy that modifies assets,
// busting browser caches without relying on ETags or file timestamps.
app.locals.assetVersion = (() => {
  try {
    const css = fs.readFileSync(path.join(__dirname, 'public/css/theme.css'));
    const js = fs.readFileSync(path.join(__dirname, 'public/js/app.js'));
    return crypto.createHash('sha1').update(css).update(js).digest('hex').slice(0, 8);
  } catch {
    return Date.now().toString(36);
  }
})();

// ── Security headers ─────────────────────────────────────────────────────────
// Minimal hand-rolled header set (no helmet). No CSP — the views rely on inline
// scripts throughout. Referrer-Policy is no-referrer specifically because
// password-reset URLs carry the token in the query string and must never leak
// via the Referer header to external links.
app.use((req, res, next) => {
  res.set('X-Frame-Options', 'SAMEORIGIN');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'no-referrer');
  next();
});

// ── Static files ─────────────────────────────────────────────────────────────
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
      // URLs include ?v=<contentHash> so each deploy with changed files gets a
      // new URL — long max-age is safe and avoids any ETag/mtime stale-cache issues.
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }
}));
// Liveness probe for Docker HEALTHCHECK / post-deploy verification. No session,
// no DB — answers as long as the process serves requests.
app.get('/health', (_req, res) => res.json({ ok: true }));

// ── Session ───────────────────────────────────────────────────────────────────
const sessionStore = new MySQLStore({}, pool);
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  // rolling: true resets the cookie expiry on every request, keeping active
  // users logged in indefinitely rather than being logged out after 30 days.
  rolling: true,
  store: sessionStore,
  cookie: { secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 * 30 },
}));
app.use(flash());

// Family photos are private — require a logged-in session to fetch them. This mount
// sits AFTER the session middleware deliberately (the old pre-session mount served
// /uploads to anyone on the internet who had or guessed a URL). A bare 401 (not a
// login redirect) so a stale <img> fails quietly. /uploads is a Docker volume mount —
// photos live outside the image so they survive rebuilds and deploys. Cache-Control
// private: browsers may cache (filenames are content-unique, never reused), shared
// caches must not store family photos.
app.use('/uploads', (req, res, next) => {
  if (!req.session.user) return res.status(401).end();
  next();
}, express.static('/app/uploads', {
  setHeaders(res) { res.set('Cache-Control', 'private, max-age=2592000'); },
}));

// ── Request locals ────────────────────────────────────────────────────────────
app.use(async (req, res, next) => {
  // Prevent HTML pages from being served from cache — ensures fresh content after deploys.
  res.set('Cache-Control', 'no-cache');
  res.locals.user = req.session.user || null;
  res.locals.flash = req.session.flash ? req.flash() : {};
  if (req.session.user) {
    try {
      const [members] = await pool.query(
        'SELECT id, name FROM users WHERE active = 1 ORDER BY name'
      );
      res.locals.familyMembers = members;
    } catch {
      res.locals.familyMembers = [];
    }
    const latestAt = app.locals.latestChangelogAt;
    try {
      const [[me]] = await pool.query(
        'SELECT COUNT(n.id) AS unread, u.whats_new_seen_at, u.role, u.active FROM users u LEFT JOIN notifications n ON n.user_id = u.id AND n.read_at IS NULL WHERE u.id = ? GROUP BY u.id',
        [req.session.user.id]
      );
      // Stale-privilege defense: rolling 30/90-day cookies would otherwise let a
      // deactivated or demoted user keep their old session privileges forever.
      // Refresh role from the DB every request; kill the session on deactivation.
      if (!me || !me.active) {
        // Deactivated (or deleted) account — destroy the session and bail out to
        // /login rather than calling next(): destroy() unsets req.session, which
        // downstream middleware and routes dereference.
        return req.session.destroy(() => res.redirect('/login'));
      }
      req.session.user.role = me.role;
      res.locals.user = req.session.user;
      res.locals.showChangelogDot = !!(latestAt && (!me.whats_new_seen_at || new Date(latestAt) > new Date(me.whats_new_seen_at)));
      res.locals.showNotificationDot = res.locals.showChangelogDot || me.unread > 0;
    } catch {
      // DB hiccup: fail open (keep the session) but hide the dots.
      res.locals.showChangelogDot = false;
      res.locals.showNotificationDot = false;
    }
  } else {
    res.locals.familyMembers = [];
    res.locals.showChangelogDot = false;
    res.locals.showNotificationDot = false;
  }
  next();
});

// ── Birthday redirect ─────────────────────────────────────────────────────────
// Prompt logged-in users without a birthday to set one
const BIRTHDAY_SKIP = ['/birthday-setup', '/logout', '/login', '/register', '/forgot-password', '/reset-password'];
app.use(async (req, res, next) => {
  if (!req.session.user) return next();
  if (BIRTHDAY_SKIP.some(p => req.path.startsWith(p))) return next();
  if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/') || req.path.startsWith('/css/') || req.path.startsWith('/js/')) return next();

  // Migration safety: syncs birthday, avatar_url, and whats_new_seen_at into sessions that were
  // created before those DB columns were added, so old sessions don't get
  // stuck in redirect loops or show stale missing-avatar states.
  if (!('birthday' in req.session.user)) {
    try {
      const [[u]] = await pool.query('SELECT birthday, avatar_url, whats_new_seen_at FROM users WHERE id = ?', [req.session.user.id]);
      req.session.user.birthday = u?.birthday || null;
      if (!('avatar_url' in req.session.user)) req.session.user.avatar_url = u?.avatar_url || null;
      if (!('whats_new_seen_at' in req.session.user)) req.session.user.whats_new_seen_at = u?.whats_new_seen_at || null;
    } catch { return next(); }
  }

  if (req.session.user.birthday === null) return res.redirect('/birthday-setup');
  next();
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/', require('./routes/auth'));
app.use('/', require('./routes/posts'));
app.use('/', require('./routes/reactions'));
app.use('/', require('./routes/commentReactions'));
app.use('/', require('./routes/comments'));
app.use('/profile', require('./routes/profile'));
app.use('/settings', require('./routes/settings'));
app.use('/admin', require('./routes/admin'));
app.use('/', require('./routes/mod'));
app.use('/', require('./routes/members'));
app.use('/push', require('./routes/push'));
app.use('/', require('./routes/photos'));
app.use('/feedback', require('./routes/feedback'));
app.use('/whats-new', require('./routes/whats-new'));
app.use('/notifications', require('./routes/notifications'));
app.use('/search', require('./routes/search'));

// ── Process-level safety net ──────────────────────────────────────────────────
// Fire-and-forget notification/preview work can reject after the response is
// sent; log it rather than letting Node (v15+) kill the whole process.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});

// ── Server startup ────────────────────────────────────────────────────────────
async function start() {
  // Fail fast rather than running in a silently broken state.
  const missing = ['SESSION_SECRET', 'DB_USER', 'DB_PASSWORD'].filter(k => !process.env[k]);
  if (missing.length) {
    console.error('ERROR: Missing required environment variables:', missing.join(', '));
    process.exit(1);
  }

  // Retry loop gives the MySQL container time to fully boot before Express
  // starts accepting connections — avoids immediate crash on cold docker start.
  for (let i = 0; i < 10; i++) {
    try { await pool.query('SELECT 1'); break; }
    catch { console.log('Waiting for database...'); await new Promise(r => setTimeout(r, 3000)); }
  }

  await initDb();

  try {
    const raw = fs.readFileSync(path.join(__dirname, 'data/changelog-meta.json'), 'utf8');
    app.locals.latestChangelogAt = JSON.parse(raw).latestAt || null;
  } catch {
    app.locals.latestChangelogAt = null;
  }

  // Seed the first admin account when the DB is empty and ADMIN_* env vars are
  // set — lets a fresh deployment bootstrap without manual SQL inserts.
  const [[{ count }]] = await pool.query('SELECT COUNT(*) AS count FROM users');
  if (count === 0 && process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
    await pool.query(
      'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [process.env.ADMIN_NAME || 'Admin', process.env.ADMIN_EMAIL, hash, 'admin']
    );
    console.log(`Admin account created for ${process.env.ADMIN_EMAIL}`);
  }

  startCron();

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Family News running on port ${PORT}`));
}

// Only listen when run directly (Docker CMD: `node src/app.js`); requiring this
// module (e.g. from a future test) gets the app without binding a port.
if (require.main === module) {
  start().catch(err => { console.error(err); process.exit(1); });
}

module.exports = app;
