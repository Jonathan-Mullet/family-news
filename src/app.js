require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const flash = require('connect-flash');
const bcrypt = require('bcrypt');
const path = require('path');
const { pool, initDb } = require('./db');
const { startCron } = require('./cron');

const app = express();
app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
// Serve uploaded photos
app.use('/uploads', express.static('/app/uploads'));

const sessionStore = new MySQLStore({}, pool);
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  store: sessionStore,
  cookie: { secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 24 * 30 },
}));
app.use(flash());

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.flash = req.flash();
  next();
});

// Prompt logged-in users without a birthday to set one
const BIRTHDAY_SKIP = ['/birthday-setup', '/logout', '/login', '/register', '/forgot-password', '/reset-password'];
app.use(async (req, res, next) => {
  if (!req.session.user) return next();
  if (BIRTHDAY_SKIP.some(p => req.path.startsWith(p))) return next();
  if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/') || req.path.startsWith('/css/') || req.path.startsWith('/js/')) return next();

  // Sync birthday + avatar_url for sessions created before these fields existed
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

app.use('/', require('./routes/auth'));
app.use('/', require('./routes/posts'));
app.use('/', require('./routes/reactions'));
app.use('/', require('./routes/comments'));
app.use('/profile', require('./routes/profile'));
app.use('/admin', require('./routes/admin'));
app.use('/', require('./routes/members'));

async function start() {
  for (let i = 0; i < 10; i++) {
    try { await pool.query('SELECT 1'); break; }
    catch { console.log('Waiting for database...'); await new Promise(r => setTimeout(r, 3000)); }
  }

  await initDb();

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
