require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const flash = require('connect-flash');
const bcrypt = require('bcrypt');
const path = require('path');
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

// ── Static files ─────────────────────────────────────────────────────────────
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
      // no-cache forces the browser to revalidate on every load, preventing iOS
      // PWA from serving stale JS/CSS assets after a deploy.
      res.set('Cache-Control', 'no-cache');
    }
  }
}));
// /uploads is a Docker volume mount — uploaded photos live outside the container
// image so they survive image rebuilds and deploys.
app.use('/uploads', express.static('/app/uploads'));

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
  cookie: { secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 24 * 30 },
}));
app.use(flash());

// ── Request locals ────────────────────────────────────────────────────────────
app.use(async (req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.flash = req.flash();
  if (req.session.user) {
    try {
      const [members] = await pool.query(
        'SELECT id, name FROM users WHERE active = 1 ORDER BY name'
      );
      res.locals.familyMembers = members;
    } catch {
      res.locals.familyMembers = [];
    }
  } else {
    res.locals.familyMembers = [];
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

  // Migration safety: syncs birthday and avatar_url into sessions that were
  // created before those DB columns were added, so old sessions don't get
  // stuck in redirect loops or show stale missing-avatar states.
  if (!('birthday' in req.session.user)) {
    try {
      const [[u]] = await pool.query('SELECT birthday, avatar_url FROM users WHERE id = ?', [req.session.user.id]);
      req.session.user.birthday = u?.birthday || null;
      if (!('avatar_url' in req.session.user)) req.session.user.avatar_url = u?.avatar_url || null;
    } catch { return next(); }
  }

  if (req.session.user.birthday === null) return res.redirect('/birthday-setup');
  next();
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/', require('./routes/auth'));
app.use('/', require('./routes/posts'));
app.use('/', require('./routes/reactions'));
app.use('/', require('./routes/comments'));
app.use('/profile', require('./routes/profile'));
app.use('/admin', require('./routes/admin'));
app.use('/', require('./routes/mod'));
app.use('/', require('./routes/members'));
app.use('/push', require('./routes/push'));
app.use('/', require('./routes/photos'));

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

start().catch(err => { console.error(err); process.exit(1); });
