# PWA Push Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Web Push notifications to the Family News PWA so users on iOS (Add to Home Screen) and Android Chrome receive real-time push notifications for new posts, comments on their posts, and Big News.

**Architecture:** The PWA shell (manifest, icons, meta tags) is already in place. We add a minimal service worker for push handling, a `src/push.js` module parallel to `src/email.js` for server-side sending, a `push_subscriptions` MySQL table, API routes at `/push`, and a Push Notifications section in the profile settings page. iOS users are nudged via a feed banner to add the app to their Home Screen (required for iOS Web Push). When a user subscribes to push, their email post/comment notifications are auto-disabled to avoid double-notifying.

**Tech Stack:** Node.js/Express, EJS, MySQL2, `web-push` npm package, Vanilla JS, Tailwind CDN, service worker API.

---

## File Map

| File | Change |
|------|--------|
| `package.json` | Add `web-push` dependency |
| `src/db.js` | Add `push_subscriptions` table + 3 `push_notify_*` user column migrations |
| `src/public/sw.js` | Create — push and notificationclick handlers |
| `src/push.js` | Create — `sendPushToUser`, `sendPushToAllUsers` |
| `src/routes/push.js` | Create — `GET /push/vapid-public-key`, `POST /push/subscribe`, `POST /push/unsubscribe` |
| `src/routes/profile.js` | Add `POST /profile/push-prefs` route |
| `src/routes/auth.js` | Add `push_notify_*` fields to session user object on login |
| `src/app.js` | Mount push routes at `/push` |
| `src/routes/posts.js` | Add `sendPushToAllUsers` calls after new post and Big News toggle |
| `src/routes/comments.js` | Add `sendPushToUser` call after comment create |
| `src/public/js/app.js` | Add SW registration, VAPID helper, iOS banner logic, push section UI |
| `src/views/profile.ejs` | Add Push Notifications section (between Email Notifications and Account) |
| `src/views/feed.ejs` | Add iOS Add to Home Screen banner (below compose card) |
| `/home/jmull/docker/.env` | Add `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (not committed) |

---

## Task 1: Install web-push and add DB schema

**Files:**
- Modify: `package.json`
- Modify: `src/db.js`

- [ ] **Step 1: Install web-push**

```bash
cd /home/jmull/projects/family-news && npm install web-push
```

Expected: `added 1 package` (or similar), `package.json` updated with `"web-push"`.

- [ ] **Step 2: Verify web-push is in package.json**

```bash
grep "web-push" package.json
```

Expected: a line like `"web-push": "^3.x.x"`.

- [ ] **Step 3: Add push_subscriptions table to src/db.js**

In `src/db.js`, inside the `tables` array (after the `post_photos` CREATE TABLE string and before the closing `];` of the array), add:

```js
    `CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      endpoint VARCHAR(2048) NOT NULL UNIQUE,
      p256dh VARCHAR(512) NOT NULL,
      auth VARCHAR(256) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
```

- [ ] **Step 4: Add three migration columns to src/db.js**

In `src/db.js`, at the end of the `migrations` array (after the last `UPDATE invites SET use_count ...` line and before the closing `];`), add:

```js
    `ALTER TABLE users ADD COLUMN push_notify_posts TINYINT(1) DEFAULT 1`,
    `ALTER TABLE users ADD COLUMN push_notify_comments TINYINT(1) DEFAULT 1`,
    `ALTER TABLE users ADD COLUMN push_notify_big_news TINYINT(1) DEFAULT 1`,
```

- [ ] **Step 5: Verify**

```bash
grep -c "push_notify\|push_subscriptions" src/db.js
```

Expected: `4` (table definition + 3 column migrations).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/db.js
git commit -m "Install web-push and add push_subscriptions schema"
```

---

## Task 2: Create the service worker

**Files:**
- Create: `src/public/sw.js`

- [ ] **Step 1: Create src/public/sw.js**

```js
self.addEventListener('push', event => {
  const data = event.data?.json() ?? {};
  event.waitUntil(
    self.registration.showNotification(data.title || 'Family News', {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url || '/' }
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.includes(self.location.origin) && 'focus' in c);
      if (existing) return existing.navigate(event.notification.data.url).then(c => c.focus());
      return clients.openWindow(event.notification.data.url);
    })
  );
});
```

- [ ] **Step 2: Verify file was created**

```bash
wc -l src/public/sw.js
```

Expected: `20` (approximately).

- [ ] **Step 3: Commit**

```bash
git add src/public/sw.js
git commit -m "Add service worker with push and notificationclick handlers"
```

---

## Task 3: Create server-side push module

**Files:**
- Create: `src/push.js`

- [ ] **Step 1: Create src/push.js**

```js
const webpush = require('web-push');
const { pool } = require('./db');

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

async function _sendToSubscription(sub, payload) {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload)
    );
  } catch (err) {
    if (err.statusCode === 410 || err.statusCode === 404) {
      await pool.query('DELETE FROM push_subscriptions WHERE endpoint = ?', [sub.endpoint]);
    } else {
      console.error('Push send error:', err.message);
    }
  }
}

async function sendPushToUser(userId, payload, { checkColumn } = {}) {
  if (!process.env.VAPID_PUBLIC_KEY) return;
  try {
    if (checkColumn) {
      const [[user]] = await pool.query(`SELECT \`${checkColumn}\` AS pref FROM users WHERE id = ?`, [userId]);
      if (!user || !user.pref) return;
    }
    const [subs] = await pool.query(
      'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?',
      [userId]
    );
    for (const sub of subs) await _sendToSubscription(sub, payload);
  } catch (err) {
    console.error('sendPushToUser error:', err.message);
  }
}

async function sendPushToAllUsers(payload, { excludeUserId, checkColumn }) {
  if (!process.env.VAPID_PUBLIC_KEY) return;
  try {
    const [subs] = await pool.query(
      `SELECT ps.endpoint, ps.p256dh, ps.auth
       FROM push_subscriptions ps
       JOIN users u ON ps.user_id = u.id
       WHERE u.active = 1 AND u.\`${checkColumn}\` = 1 AND ps.user_id != ?`,
      [excludeUserId]
    );
    for (const sub of subs) await _sendToSubscription(sub, payload);
  } catch (err) {
    console.error('sendPushToAllUsers error:', err.message);
  }
}

module.exports = { sendPushToUser, sendPushToAllUsers };
```

Note: `checkColumn` in `sendPushToAllUsers` and `sendPushToUser` is always a hardcoded string from the server (`'push_notify_posts'`, `'push_notify_comments'`, or `'push_notify_big_news'`) — never from user input. Backtick escaping is included as a safety belt.

- [ ] **Step 2: Verify**

```bash
grep -c "sendPushToUser\|sendPushToAllUsers\|_sendToSubscription" src/push.js
```

Expected: `6` (each name defined once and used once internally).

- [ ] **Step 3: Commit**

```bash
git add src/push.js
git commit -m "Add server-side push module with sendPushToUser and sendPushToAllUsers"
```

---

## Task 4: Create push API routes

**Files:**
- Create: `src/routes/push.js`

- [ ] **Step 1: Create src/routes/push.js**

```js
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || '' });
});

router.post('/subscribe', async (req, res) => {
  const { endpoint, p256dh, auth } = req.body;
  if (!endpoint || !p256dh || !auth) return res.status(400).json({ error: 'Missing fields' });
  const userId = req.session.user.id;
  try {
    await pool.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), p256dh = VALUES(p256dh), auth = VALUES(auth)`,
      [userId, endpoint, p256dh, auth]
    );
    const [[user]] = await pool.query('SELECT notify_posts, notify_comments FROM users WHERE id = ?', [userId]);
    let emailsOptedOut = false;
    if (user.notify_posts || user.notify_comments) {
      await pool.query('UPDATE users SET notify_posts = 0, notify_comments = 0 WHERE id = ?', [userId]);
      req.session.user.notify_posts = 0;
      req.session.user.notify_comments = 0;
      emailsOptedOut = true;
    }
    res.json({ ok: true, emailsOptedOut });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save subscription' });
  }
});

router.post('/unsubscribe', async (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ error: 'Missing endpoint' });
  try {
    await pool.query(
      'DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?',
      [endpoint, req.session.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not remove subscription' });
  }
});

module.exports = router;
```

- [ ] **Step 2: Verify**

```bash
grep -c "vapid-public-key\|/subscribe\|/unsubscribe" src/routes/push.js
```

Expected: `3`.

- [ ] **Step 3: Commit**

```bash
git add src/routes/push.js
git commit -m "Add push API routes: vapid-public-key, subscribe, unsubscribe"
```

---

## Task 5: Add push-prefs route and update auth session

**Files:**
- Modify: `src/routes/profile.js`
- Modify: `src/routes/auth.js`

- [ ] **Step 1: Add POST /push-prefs route to src/routes/profile.js**

In `src/routes/profile.js`, before `module.exports = router;` (the last line), add:

```js
router.post('/push-prefs', async (req, res) => {
  const push_notify_posts = req.body.push_notify_posts ? 1 : 0;
  const push_notify_comments = req.body.push_notify_comments ? 1 : 0;
  const push_notify_big_news = req.body.push_notify_big_news ? 1 : 0;
  try {
    await pool.query(
      'UPDATE users SET push_notify_posts = ?, push_notify_comments = ?, push_notify_big_news = ? WHERE id = ?',
      [push_notify_posts, push_notify_comments, push_notify_big_news, req.session.user.id]
    );
    req.session.user.push_notify_posts = push_notify_posts;
    req.session.user.push_notify_comments = push_notify_comments;
    req.session.user.push_notify_big_news = push_notify_big_news;
    req.flash('success', 'Push notification preferences saved.');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not save push preferences.');
  }
  res.redirect('/profile');
});
```

- [ ] **Step 2: Verify push-prefs route was added**

```bash
grep "push-prefs" src/routes/profile.js
```

Expected: `router.post('/push-prefs', ...`

- [ ] **Step 3: Add push_notify_* fields to session user in src/routes/auth.js**

In `src/routes/auth.js`, find the `req.session.user = { ... }` block inside `router.post('/login', ...)`. It currently ends with `avatar_url: u.avatar_url || null,`. Add the three push fields:

Find this block (lines 23–32):
```js
    req.session.user = {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      notify_posts: u.notify_posts ?? 1,
      notify_comments: u.notify_comments ?? 1,
      birthday: u.birthday || null,
      avatar_url: u.avatar_url || null,
    };
```

Replace with:
```js
    req.session.user = {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      notify_posts: u.notify_posts ?? 1,
      notify_comments: u.notify_comments ?? 1,
      push_notify_posts: u.push_notify_posts ?? 1,
      push_notify_comments: u.push_notify_comments ?? 1,
      push_notify_big_news: u.push_notify_big_news ?? 1,
      birthday: u.birthday || null,
      avatar_url: u.avatar_url || null,
    };
```

- [ ] **Step 4: Verify auth.js update**

```bash
grep "push_notify" src/routes/auth.js
```

Expected: 3 lines.

- [ ] **Step 5: Commit**

```bash
git add src/routes/profile.js src/routes/auth.js
git commit -m "Add push-prefs route and include push_notify fields in login session"
```

---

## Task 6: Mount push routes and generate VAPID keys

**Files:**
- Modify: `src/app.js`
- Modify: `/home/jmull/docker/.env` (manual — do NOT commit)

- [ ] **Step 1: Mount push routes in src/app.js**

In `src/app.js`, after line 65 (`app.use('/', require('./routes/members'));`), add:

```js
app.use('/push', require('./routes/push'));
```

- [ ] **Step 2: Verify app.js change**

```bash
grep "push" src/app.js
```

Expected: `app.use('/push', require('./routes/push'));`

- [ ] **Step 3: Generate VAPID keys**

Run from the project directory (web-push must be installed from Task 1):

```bash
cd /home/jmull/projects/family-news && node -e "const wp=require('web-push'); const k=wp.generateVAPIDKeys(); console.log('VAPID_PUBLIC_KEY='+k.publicKey); console.log('VAPID_PRIVATE_KEY='+k.privateKey); console.log('VAPID_SUBJECT=mailto:jmullet12100@icloud.com');"
```

Expected output (example — yours will differ):
```
VAPID_PUBLIC_KEY=BNXx...
VAPID_PRIVATE_KEY=abc123...
VAPID_SUBJECT=mailto:jmullet12100@icloud.com
```

- [ ] **Step 4: Add VAPID keys to /home/jmull/docker/.env**

Open `/home/jmull/docker/.env` and append the three lines from step 3. Do NOT commit this file — it contains secrets.

```bash
echo "" >> /home/jmull/docker/.env
# Then manually append the three VAPID lines from step 3
```

Verify:
```bash
grep "VAPID" /home/jmull/docker/.env
```

Expected: 3 lines with VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.

- [ ] **Step 5: Commit app.js only**

```bash
git add src/app.js
git commit -m "Mount push routes at /push"
```

---

## Task 7: Wire push notifications into posts and comments

**Files:**
- Modify: `src/routes/posts.js`
- Modify: `src/routes/comments.js`

- [ ] **Step 1: Add sendPushToAllUsers import to posts.js**

In `src/routes/posts.js`, after line 5 (`const { sendNewPostNotification, sendBigNewsNotification } = require('../email');`), add:

```js
const { sendPushToAllUsers } = require('../push');
```

- [ ] **Step 2: Add push calls for new post in posts.js**

In `src/routes/posts.js`, find the email notification block inside the `POST /posts` handler (around line 208). Currently:

```js
    if (isBigNews) {
      sendBigNewsNotification(users, req.session.user, { id: postId, title: title?.trim() || null, content: content.trim() });
    } else {
      sendNewPostNotification(users, req.session.user, { id: postId, title: title?.trim() || null, content: content.trim() });
    }
```

Replace with:

```js
    if (isBigNews) {
      sendBigNewsNotification(users, req.session.user, { id: postId, title: title?.trim() || null, content: content.trim() });
      sendPushToAllUsers(
        { title: `📣 Big News from ${req.session.user.name}`, body: (title?.trim() || content.trim()).substring(0, 100), url: `/post/${postId}` },
        { excludeUserId: req.session.user.id, checkColumn: 'push_notify_big_news' }
      );
    } else {
      sendNewPostNotification(users, req.session.user, { id: postId, title: title?.trim() || null, content: content.trim() });
      sendPushToAllUsers(
        { title: `${req.session.user.name} posted`, body: content.trim().substring(0, 100), url: '/' },
        { excludeUserId: req.session.user.id, checkColumn: 'push_notify_posts' }
      );
    }
```

- [ ] **Step 3: Add push call for Big News toggle in posts.js**

In `src/routes/posts.js`, find the `router.post('/posts/:id/toggle-big-news', ...)` handler. Currently:

```js
router.post('/posts/:id/toggle-big-news', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT user_id FROM posts WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.redirect('/');
    if (rows[0].user_id !== req.session.user.id && req.session.user.role !== 'admin') return res.status(403).end();
    await pool.query('UPDATE posts SET big_news = NOT big_news WHERE id = ?', [req.params.id]);
  } catch (err) { console.error(err); }
  const ref = req.headers.referer || '/';
  res.redirect(ref.includes('/post/') ? ref : '/');
});
```

Replace with:

```js
router.post('/posts/:id/toggle-big-news', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT user_id FROM posts WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.redirect('/');
    if (rows[0].user_id !== req.session.user.id && req.session.user.role !== 'admin') return res.status(403).end();
    await pool.query('UPDATE posts SET big_news = NOT big_news WHERE id = ?', [req.params.id]);
    const [[post]] = await pool.query('SELECT id, title, content, big_news FROM posts WHERE id = ?', [req.params.id]);
    if (post && post.big_news) {
      sendPushToAllUsers(
        { title: `📣 Big News from ${req.session.user.name}`, body: (post.title || post.content).substring(0, 100), url: `/post/${post.id}` },
        { excludeUserId: req.session.user.id, checkColumn: 'push_notify_big_news' }
      );
    }
  } catch (err) { console.error(err); }
  const ref = req.headers.referer || '/';
  res.redirect(ref.includes('/post/') ? ref : '/');
});
```

- [ ] **Step 4: Add sendPushToUser import to comments.js**

In `src/routes/comments.js`, after line 5 (`const { sendCommentNotification } = require('../email');`), add:

```js
const { sendPushToUser } = require('../push');
```

- [ ] **Step 5: Add push call for new comment in comments.js**

In `src/routes/comments.js`, find the inner `try` block that calls `sendCommentNotification` (around lines 17–29). Currently:

```js
    try {
      const [postRows] = await pool.query(
        'SELECT p.id, p.title, p.user_id, u.email, u.notify_comments FROM posts p JOIN users u ON p.user_id = u.id WHERE p.id = ?',
        [req.params.id]
      );
      if (postRows.length) {
        const post = postRows[0];
        const toUser = { id: post.user_id, email: post.email, notify_comments: post.notify_comments };
        sendCommentNotification(toUser, req.session.user, { id: post.id, title: post.title });
      }
    } catch (notifyErr) {
      console.error('Comment notification error:', notifyErr.message);
    }
```

Replace with:

```js
    try {
      const [postRows] = await pool.query(
        'SELECT p.id, p.title, p.user_id, u.email, u.notify_comments FROM posts p JOIN users u ON p.user_id = u.id WHERE p.id = ?',
        [req.params.id]
      );
      if (postRows.length) {
        const post = postRows[0];
        const toUser = { id: post.user_id, email: post.email, notify_comments: post.notify_comments };
        sendCommentNotification(toUser, req.session.user, { id: post.id, title: post.title });
        if (post.user_id !== req.session.user.id) {
          sendPushToUser(
            post.user_id,
            { title: `${req.session.user.name} commented on your post`, body: content.trim().substring(0, 100), url: `/post/${post.id}` },
            { checkColumn: 'push_notify_comments' }
          );
        }
      }
    } catch (notifyErr) {
      console.error('Comment notification error:', notifyErr.message);
    }
```

- [ ] **Step 6: Verify**

```bash
grep -c "sendPushToAllUsers\|sendPushToUser" src/routes/posts.js src/routes/comments.js
```

Expected: `posts.js:3` (import + 2 calls), `comments.js:2` (import + 1 call).

- [ ] **Step 7: Commit**

```bash
git add src/routes/posts.js src/routes/comments.js
git commit -m "Wire push notifications into post and comment creation"
```

---

## Task 8: Client-side JS — SW registration, push UI, iOS banner

**Files:**
- Modify: `src/public/js/app.js`

`app.js` currently has 195 lines and ends after the auto-refresh polling block. Append all of the following to the **end** of `src/public/js/app.js`.

- [ ] **Step 1: Append SW registration, VAPID helper, and push UI code to app.js**

Append to end of `src/public/js/app.js`:

```js
// Service worker registration (required for push on all platforms)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// Convert URL-safe base64 VAPID public key to Uint8Array for pushManager.subscribe
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return new Uint8Array([...raw].map(c => c.charCodeAt(0)));
}

// iOS Add to Home Screen banner (feed page only)
const _iosBanner = document.getElementById('ios-pwa-banner');
if (_iosBanner) {
  const _isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);
  const _isStandalone = navigator.standalone === true;
  const _pwaGranted = typeof Notification !== 'undefined' && Notification.permission === 'granted';
  const _pwaDismissed = localStorage.getItem('pwa-banner-dismissed');
  if (_isIOS && !_isStandalone && !_pwaGranted && !_pwaDismissed) {
    _iosBanner.classList.remove('hidden');
  }
  document.getElementById('ios-pwa-banner-dismiss')?.addEventListener('click', () => {
    localStorage.setItem('pwa-banner-dismissed', '1');
    _iosBanner.classList.add('hidden');
  });
}

// Push notifications UI (profile page only)
const _pushSection = document.getElementById('push-section');
if (_pushSection) {
  const _pushIsIOSNonStandalone = /iP(hone|ad|od)/.test(navigator.userAgent) && navigator.standalone !== true;

  function _showPushState(id) {
    ['push-state-default', 'push-state-enabled', 'push-state-denied', 'push-ios-notice'].forEach(s => {
      document.getElementById(s)?.classList.add('hidden');
    });
    document.getElementById(id)?.classList.remove('hidden');
  }

  function _populatePushCheckboxes() {
    const sec = document.getElementById('push-section');
    const posts = document.querySelector('#push-state-enabled input[name="push_notify_posts"]');
    const comments = document.querySelector('#push-state-enabled input[name="push_notify_comments"]');
    const bigNews = document.querySelector('#push-state-enabled input[name="push_notify_big_news"]');
    if (posts) posts.checked = sec.dataset.notifyPosts !== '0';
    if (comments) comments.checked = sec.dataset.notifyComments !== '0';
    if (bigNews) bigNews.checked = sec.dataset.notifyBigNews !== '0';
  }

  async function _initPushSection() {
    if (_pushIsIOSNonStandalone) { _showPushState('push-ios-notice'); return; }
    if (typeof Notification === 'undefined' || !('PushManager' in window)) {
      _pushSection.querySelector('h2').insertAdjacentHTML('afterend',
        '<p class="text-sm text-slate-400 dark:text-slate-500">Push notifications are not supported in this browser.</p>'
      );
      return;
    }
    if (Notification.permission === 'denied') {
      _showPushState('push-state-denied');
      const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);
      const el = document.getElementById('push-denied-instructions');
      if (el) el.textContent = isIOS
        ? 'To re-enable: go to Settings → Safari → Notifications and allow Family News.'
        : 'To re-enable: tap the lock icon in the address bar and allow notifications.';
      return;
    }
    try {
      const sw = await navigator.serviceWorker.ready;
      const sub = await sw.pushManager.getSubscription();
      if (sub) {
        _showPushState('push-state-enabled');
        _populatePushCheckboxes();
      } else {
        _showPushState('push-state-default');
      }
    } catch { _showPushState('push-state-default'); }
  }

  async function _enablePush() {
    try {
      const sw = await navigator.serviceWorker.ready;
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { _showPushState('push-state-denied'); return; }
      const { publicKey } = await fetch('/push/vapid-public-key').then(r => r.json());
      const sub = await sw.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
      const body = JSON.stringify({
        endpoint: sub.endpoint,
        p256dh: btoa(String.fromCharCode(...new Uint8Array(sub.getKey('p256dh')))),
        auth: btoa(String.fromCharCode(...new Uint8Array(sub.getKey('auth'))))
      });
      const data = await fetch('/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }).then(r => r.json());
      if (data.emailsOptedOut) {
        document.getElementById('push-email-notice')?.classList.remove('hidden');
      }
      _showPushState('push-state-enabled');
      _populatePushCheckboxes();
    } catch (err) { console.error('Push enable error:', err); }
  }

  async function _disablePush() {
    try {
      const sw = await navigator.serviceWorker.ready;
      const sub = await sw.pushManager.getSubscription();
      if (sub) {
        await fetch('/push/unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) });
        await sub.unsubscribe();
      }
      _showPushState('push-state-default');
    } catch (err) { console.error('Push disable error:', err); }
  }

  document.getElementById('push-enable-btn')?.addEventListener('click', _enablePush);
  document.getElementById('push-disable-btn')?.addEventListener('click', _disablePush);

  _initPushSection();
}
```

- [ ] **Step 2: Verify key identifiers are present**

```bash
grep -c "serviceWorker.register\|urlBase64ToUint8Array\|ios-pwa-banner\|push-section\|_enablePush\|_disablePush" src/public/js/app.js
```

Expected: `6`.

- [ ] **Step 3: Commit**

```bash
git add src/public/js/app.js
git commit -m "Add SW registration, push subscription UI, and iOS banner logic to app.js"
```

---

## Task 9: Add Push Notifications section to profile.ejs

**Files:**
- Modify: `src/views/profile.ejs`

- [ ] **Step 1: Locate the insertion point in profile.ejs**

The new section goes between the Email Notifications card and the Account info card. Find this comment in `src/views/profile.ejs`:

```ejs
  <%# Account info %>
  <div class="fn-settings-card">
    <h2 class="fn-settings-card-title">Account</h2>
```

- [ ] **Step 2: Insert the push section before the Account info card**

Insert the following immediately before `<%# Account info %>`:

```ejs
  <%# Push notifications %>
  <div class="fn-settings-card" id="push-section"
    data-notify-posts="<%= user.push_notify_posts != null ? user.push_notify_posts : 1 %>"
    data-notify-comments="<%= user.push_notify_comments != null ? user.push_notify_comments : 1 %>"
    data-notify-big-news="<%= user.push_notify_big_news != null ? user.push_notify_big_news : 1 %>">
    <h2 class="fn-settings-card-title">Push Notifications</h2>

    <div id="push-state-default" class="hidden">
      <p class="text-sm text-slate-500 dark:text-slate-400 mb-3">Get notified on this device even when the app is closed.</p>
      <button id="push-enable-btn" class="fn-btn">Enable push notifications</button>
    </div>

    <div id="push-state-enabled" class="hidden space-y-3">
      <p class="text-sm text-green-600 dark:text-green-400 font-medium">Push notifications are on</p>
      <form method="POST" action="/profile/push-prefs" class="space-y-2">
        <label class="fn-checkbox-label">
          <input class="fn-checkbox" type="checkbox" name="push_notify_posts" value="1">
          <span>Notify me when someone posts</span>
        </label>
        <label class="fn-checkbox-label">
          <input class="fn-checkbox" type="checkbox" name="push_notify_comments" value="1">
          <span>Notify me when someone comments on my post</span>
        </label>
        <label class="fn-checkbox-label">
          <input class="fn-checkbox" type="checkbox" name="push_notify_big_news" value="1">
          <span>Notify me for Big News</span>
        </label>
        <div style="margin-top:1rem;">
          <button type="submit" class="fn-btn">Save Preferences</button>
        </div>
      </form>
      <button id="push-disable-btn" class="fn-btn-ghost text-sm">Turn off push notifications</button>
    </div>

    <div id="push-state-denied" class="hidden">
      <p class="text-sm text-slate-500 dark:text-slate-400 mb-2">Notifications are blocked in your browser.</p>
      <p class="text-sm text-slate-500 dark:text-slate-400" id="push-denied-instructions"></p>
    </div>

    <div id="push-ios-notice" class="hidden">
      <p class="text-sm text-slate-500 dark:text-slate-400">To enable push notifications on iPhone, first add Family News to your Home Screen via the Share button (□↑).</p>
    </div>

    <div id="push-email-notice" class="hidden mt-3 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-3">
      Push is on. Email notifications for posts and comments have been turned off — you can re-enable them in the Email Notifications section above.
    </div>
  </div>

```

- [ ] **Step 3: Verify**

```bash
grep -c "push-section\|push-state-default\|push-state-enabled\|push-state-denied\|push-ios-notice\|push-email-notice\|push-enable-btn\|push-disable-btn" src/views/profile.ejs
```

Expected: `8`.

- [ ] **Step 4: Commit**

```bash
git add src/views/profile.ejs
git commit -m "Add push notifications settings section to profile page"
```

---

## Task 10: Add iOS Add to Home Screen banner to feed.ejs

**Files:**
- Modify: `src/views/feed.ejs`

- [ ] **Step 1: Locate the insertion point in feed.ejs**

The banner goes below the post creation card and before the Big News banner. Find this in `src/views/feed.ejs`:

```ejs
  </div>

  <%# Big News Banner %>
```

(This closing `</div>` ends the post creation card.)

- [ ] **Step 2: Insert the banner between the compose card and Big News banner**

Replace:
```ejs
  </div>

  <%# Big News Banner %>
```

With:
```ejs
  </div>

  <%# iOS Add to Home Screen banner — JS shows it when: iOS + not standalone + not dismissed + no push permission %>
  <div id="ios-pwa-banner" class="hidden mb-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-2xl p-4 flex items-start gap-3">
    <span class="text-2xl flex-shrink-0">📱</span>
    <div class="flex-1 min-w-0">
      <p class="text-sm font-semibold text-amber-800 dark:text-amber-300">Get notifications on iPhone</p>
      <p class="text-xs text-amber-700 dark:text-amber-400 mt-0.5">Tap the Share button (□↑) then "Add to Home Screen" to enable push notifications for Family News.</p>
    </div>
    <button id="ios-pwa-banner-dismiss" class="text-amber-500 dark:text-amber-400 text-xl leading-none min-h-[36px] min-w-[36px] flex items-center justify-center flex-shrink-0">✕</button>
  </div>

  <%# Big News Banner %>
```

- [ ] **Step 3: Verify**

```bash
grep -c "ios-pwa-banner" src/views/feed.ejs
```

Expected: `2` (the div id and the dismiss button id).

- [ ] **Step 4: Commit**

```bash
git add src/views/feed.ejs
git commit -m "Add iOS Add to Home Screen banner to feed"
```

---

## Task 11: Deploy

- [ ] **Step 1: Confirm VAPID keys are in .env**

```bash
grep "VAPID" /home/jmull/docker/.env
```

Expected: 3 lines. If missing, go back to Task 6 Step 3–4 before proceeding.

- [ ] **Step 2: Push to remote**

```bash
git push
```

- [ ] **Step 3: Wait for GitHub Actions build**

Check status at: `https://github.com/Jonathan-Mullet/family-news/actions`

Wait until the latest workflow run shows a green checkmark (typically 2–4 minutes).

- [ ] **Step 4: Deploy**

```bash
cd /home/jmull/docker && docker compose pull family-news && docker compose up -d family-news
```

Expected: `Container family-news Started`

- [ ] **Step 5: Smoke tests**

**Android Chrome:**
- Visit the feed — confirm no iOS banner appears
- Go to Profile → scroll to "Push Notifications" → click "Enable push notifications"
- Grant permission in the browser dialog
- Confirm status changes to "Push notifications are on" with checkboxes
- From another account (or wait for a real post), create a new post
- Confirm a push notification arrives on Android

**iOS Safari (non-standalone):**
- Visit the feed — confirm the amber banner "Get notifications on iPhone" appears
- Tap ✕ — confirm banner disappears and does not reappear on reload

**iOS Add to Home Screen:**
- Tap Share → Add to Home Screen → open from home screen icon
- Confirm banner no longer appears (standalone mode)
- Go to Profile → "Push Notifications" → confirm Enable button is shown (not the iPhone instruction)
- Click Enable → grant permission → confirm status changes to "Push notifications are on"

**Push preference toggles:**
- With push enabled, uncheck "Notify me when someone posts" → Save Preferences
- Confirm flash: "Push notification preferences saved."

**Email auto-opt-out notice:**
- Enable push on a fresh account that has email notifications on
- Confirm the amber notice appears: "Push is on. Email notifications for posts and comments have been turned off..."
- Go to Email Notifications section → confirm both checkboxes are unchecked
