# Moderator Role Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `moderator` role with pin/delete/big-news/invite/trash powers, a mod panel, a role guide page, and a soft-delete system with 14-day purge.

**Architecture:** Extend the `role` enum to include `'moderator'`, add a new `requireMod` middleware, update all permission checks and feed queries, introduce soft-delete columns on posts/comments, and add a `/mod` panel and `/guide` page protected by `requireMod`. A daily cron job hard-purges items soft-deleted more than 14 days ago.

**Tech Stack:** Node.js, Express, EJS, MySQL 8, node-cron, nodemailer, web-push.

---

## File Map

**Create:**
- `src/routes/mod.js` — mod panel + /guide routes (protected by requireMod)
- `src/views/mod.ejs` — mod panel page (invites + trash)
- `src/views/guide.ejs` — role guide page (layout C, role-tailored)

**Modify:**
- `src/db.js` — 3 new migrations
- `src/middleware/auth.js` — add requireMod, update exports
- `src/email.js` — add sendPromotionNotification
- `src/routes/posts.js` — query filters + permission + soft delete + big-news email blast
- `src/routes/comments.js` — query filter + soft delete + permission
- `src/utils/feedData.js` — latest comment subquery excludes deleted
- `src/routes/members.js` — member page query excludes deleted posts
- `src/routes/admin.js` — replace toggle-role with set-role + new imports
- `src/views/admin.ejs` — role badge + set-role form
- `src/views/partials/post-card.ejs` — mod button visibility + scheduled label
- `src/views/post.ejs` — mod button visibility + comment delete buttons
- `src/views/partials/nav.ejs` — Mod + Guide nav links
- `src/app.js` — register /mod route
- `src/cron.js` — add daily 3am purge job

---

## Task 1: DB Migrations

**Files:**
- Modify: `src/db.js:149-172`

Add three migrations to the existing `migrations` array at the end. The try/catch loop around every migration already handles the case where a column already exists.

- [ ] **Step 1: Add migrations to db.js**

Open `src/db.js`. After the last existing migration (`push_notify_big_news` line), append these three entries to the `migrations` array:

```js
    `ALTER TABLE users MODIFY COLUMN role ENUM('admin','moderator','member') DEFAULT 'member'`,
    `ALTER TABLE posts ADD COLUMN deleted_at DATETIME DEFAULT NULL`,
    `ALTER TABLE comments ADD COLUMN deleted_at DATETIME DEFAULT NULL`,
```

The complete tail of the `migrations` array after your edit:
```js
    `ALTER TABLE users ADD COLUMN push_notify_big_news TINYINT(1) DEFAULT 1`,
    `ALTER TABLE users MODIFY COLUMN role ENUM('admin','moderator','member') DEFAULT 'member'`,
    `ALTER TABLE posts ADD COLUMN deleted_at DATETIME DEFAULT NULL`,
    `ALTER TABLE comments ADD COLUMN deleted_at DATETIME DEFAULT NULL`,
  ];
  for (const q of migrations) {
    try { await pool.query(q); } catch { /* column already exists */ }
  }
```

- [ ] **Step 2: Verify**

Start the app (`node src/app.js` — requires the MySQL container running and a valid `.env`). Check the server logs; they should not show any DB error. Then confirm:

```bash
mysql -u root family_news -e "DESCRIBE users;" | grep role
# Expected: role  enum('admin','moderator','member')  YES  ...  member  ...

mysql -u root family_news -e "DESCRIBE posts;" | grep deleted_at
# Expected: deleted_at  datetime  YES  ...  NULL  ...

mysql -u root family_news -e "DESCRIBE comments;" | grep deleted_at
# Expected: deleted_at  datetime  YES  ...  NULL  ...
```

- [ ] **Step 3: Commit**

```bash
git add src/db.js
git commit -m "feat: add moderator role enum + soft-delete columns"
```

---

## Task 2: requireMod Middleware

**Files:**
- Modify: `src/middleware/auth.js`

- [ ] **Step 1: Add requireMod**

After the existing `requireAdmin` function (before `module.exports`), add:

```js
/**
 * Ensures the request comes from a logged-in moderator or admin.
 * Responds with 403 if the check fails.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {void}
 */
function requireMod(req, res, next) {
  if (!req.session.user || (req.session.user.role !== 'admin' && req.session.user.role !== 'moderator'))
    return res.status(403).render('error', { message: 'Access denied.' });
  next();
}
```

Update `module.exports`:
```js
module.exports = { requireAuth, requireAdmin, requireMod };
```

- [ ] **Step 2: Verify**

No runtime test needed — this is a pure function with no side effects. Confirm visually that the function logic matches `requireAdmin` but allows both `'admin'` and `'moderator'`.

- [ ] **Step 3: Commit**

```bash
git add src/middleware/auth.js
git commit -m "feat: add requireMod middleware"
```

---

## Task 3: sendPromotionNotification

**Files:**
- Modify: `src/email.js`

- [ ] **Step 1: Add the function**

After `sendBigNewsNotification` and before `module.exports`, add:

```js
/**
 * Notifies a user that they have been promoted to a new role.
 * Only called for upgrades (member→moderator, member→admin, moderator→admin).
 *
 * @param {string} email - Recipient email address.
 * @param {string} name  - Recipient display name.
 * @param {'moderator'|'admin'} role - The new role.
 * @returns {Promise<void>}
 */
async function sendPromotionNotification(email, name, role) {
  const roleLabel = role === 'admin' ? 'Admin' : 'Moderator';
  const url = `${process.env.BASE_URL}/guide`;
  await sendMail(email, `You're now a ${roleLabel} on Family News 🎉`, `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:20px">
      <h2 style="color:#1e293b">New Role: ${roleLabel}</h2>
      <p style="color:#475569">Hi ${escapeHtml(name)}, you've been made a <strong>${roleLabel}</strong> on Family News.</p>
      <a href="${url}" style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:500;margin:8px 0">See your guide →</a>
    </div>
  `);
}
```

Update `module.exports`:
```js
module.exports = { sendPasswordReset, sendNewPostNotification, sendCommentNotification, sendBigNewsNotification, sendPromotionNotification };
```

- [ ] **Step 2: Verify**

No runtime test needed. Confirm the function uses `escapeHtml` (already in scope in email.js) and follows the same fire-and-forget pattern as other send functions (errors logged, not thrown — that's handled by `sendMail`).

- [ ] **Step 3: Commit**

```bash
git add src/email.js
git commit -m "feat: add sendPromotionNotification email"
```

---

## Task 4: posts.js — Query Filters, Permissions, Soft Delete, Big-News Email Blast

**Files:**
- Modify: `src/routes/posts.js`

Five changes in this file. Make them all, then commit once.

- [ ] **Step 1: Feed-state API — add deleted_at filter**

Replace the two queries in `router.get('/api/feed-state', ...)` (lines 21-27):

```js
    const [[latest]] = await pool.query(
      'SELECT id FROM posts WHERE (publish_at IS NULL OR publish_at <= NOW() OR user_id = ?) AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1',
      [userId]
    );
    const [[{ total }]] = await pool.query(
      'SELECT COUNT(*) AS total FROM posts WHERE (publish_at IS NULL OR publish_at <= NOW() OR user_id = ?) AND deleted_at IS NULL',
      [userId]
    );
```

- [ ] **Step 3: Main feed — add deleted_at filter**

In `router.get('/', ...)` (around line 37), the main feed query ends with:
```
      WHERE p.publish_at IS NULL OR p.publish_at <= NOW() OR p.user_id = ?
```
Change to:
```
      WHERE (p.publish_at IS NULL OR p.publish_at <= NOW() OR p.user_id = ?) AND p.deleted_at IS NULL
```

- [ ] **Step 4: Post detail — add deleted_at filter**

In `router.get('/post/:id', ...)` (around line 83), the query:
```js
       WHERE p.id = ?`,
```
Change to:
```js
       WHERE p.id = ? AND p.deleted_at IS NULL`,
```

Also update the comment fetch query (around line 132):
```js
      WHERE c.post_id = ? ORDER BY c.created_at ASC
```
Change to:
```js
      WHERE c.post_id = ? AND c.deleted_at IS NULL ORDER BY c.created_at ASC
```

- [ ] **Step 5: Edit route — allow moderators**

In `router.post('/posts/:id/edit', ...)` (around line 228):
```js
    if (rows[0].user_id !== req.session.user.id && req.session.user.role !== 'admin') return res.status(403).end();
```
Change to:
```js
    if (rows[0].user_id !== req.session.user.id && req.session.user.role !== 'admin' && req.session.user.role !== 'moderator') return res.status(403).end();
```

- [ ] **Step 6: Pin route — allow moderators**

In `router.post('/posts/:id/pin', ...)` (around line 240):
```js
  if (req.session.user.role !== 'admin') return res.status(403).end();
```
Change to:
```js
  if (req.session.user.role !== 'admin' && req.session.user.role !== 'moderator') return res.status(403).end();
```

- [ ] **Step 7: Toggle-big-news — allow moderators + add email blast**

Replace the entire `router.post('/posts/:id/toggle-big-news', ...)` handler with:

```js
// Toggle big-news flag; sends push + email blast when a post is promoted to big news.
// The post author (any role), moderators, and admins can toggle.
router.post('/posts/:id/toggle-big-news', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT user_id FROM posts WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.redirect('/');
    if (rows[0].user_id !== req.session.user.id && req.session.user.role !== 'admin' && req.session.user.role !== 'moderator') return res.status(403).end();
    await pool.query('UPDATE posts SET big_news = NOT big_news WHERE id = ?', [req.params.id]);
    const [[post]] = await pool.query('SELECT id, title, content, big_news FROM posts WHERE id = ?', [req.params.id]);
    if (post && post.big_news) {
      const [users] = await pool.query('SELECT id, email FROM users WHERE active = 1');
      sendBigNewsNotification(users, req.session.user, { id: post.id, title: post.title, content: post.content });
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

- [ ] **Step 8: Delete route — soft delete + allow moderators**

Replace the entire `router.post('/posts/:id/delete', ...)` handler with:

```js
// Soft-delete a post by setting deleted_at; only the author, a moderator, or an admin may delete.
// Photos are NOT deleted here — they are cleaned up by the nightly purge cron after 14 days.
router.post('/posts/:id/delete', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT user_id FROM posts WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.redirect('/');
    if (rows[0].user_id !== req.session.user.id && req.session.user.role !== 'admin' && req.session.user.role !== 'moderator') return res.status(403).end();
    await pool.query('UPDATE posts SET deleted_at = NOW() WHERE id = ?', [req.params.id]);
    res.redirect('/');
  } catch (err) { console.error(err); res.redirect('/'); }
});
```

- [ ] **Step 9: Verify**

Start the app. Log in as an admin user and:
1. Delete a post — confirm it disappears from the feed.
2. Check the DB: `mysql -u root family_news -e "SELECT id, deleted_at FROM posts ORDER BY id DESC LIMIT 5;"` — confirm `deleted_at` is set, NOT a missing row.
3. Navigate to `/post/:id` for the deleted post — should render the error page ("Post not found.").
4. Toggle Big News on an existing post — if email is configured, confirm blast is sent; always confirm push fires (check server log for `sendPushToAllUsers` call).

- [ ] **Step 10: Commit**

```bash
git add src/routes/posts.js
git commit -m "feat: posts soft-delete, mod permissions, big-news email blast on toggle"
```

---

## Task 5: comments.js + feedData.js + members.js — Filters and Soft Delete

**Files:**
- Modify: `src/routes/comments.js`
- Modify: `src/utils/feedData.js`
- Modify: `src/routes/members.js`

- [ ] **Step 1: comments.js — soft delete + allow moderators**

Replace the entire `router.post('/comments/:id/delete', ...)` handler:

```js
// Soft-delete a comment by setting deleted_at; only the author, a moderator, or an admin may delete.
router.post('/comments/:id/delete', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT user_id, post_id FROM comments WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.redirect('/');
    const { user_id, post_id } = rows[0];
    if (user_id !== req.session.user.id && req.session.user.role !== 'admin' && req.session.user.role !== 'moderator') return res.status(403).end();
    await pool.query('UPDATE comments SET deleted_at = NOW() WHERE id = ?', [req.params.id]);
    res.redirect(`/post/${post_id}`);
  } catch (err) { console.error(err); res.redirect('/'); }
});
```

- [ ] **Step 2: feedData.js — exclude deleted comments from latest-comment preview**

In `src/utils/feedData.js`, the latest comment query (around line 78) is:

```js
    WHERE c.id IN (SELECT MAX(id) FROM comments WHERE post_id IN (?) GROUP BY post_id)
```

Change to:

```js
    WHERE c.id IN (SELECT MAX(id) FROM comments WHERE post_id IN (?) AND deleted_at IS NULL GROUP BY post_id)
      AND c.deleted_at IS NULL
```

- [ ] **Step 3: members.js — exclude deleted posts from member page**

In `src/routes/members.js`, the posts query (around line 21) ends with:
```
      WHERE p.user_id = ? AND (p.publish_at IS NULL OR p.publish_at <= NOW() OR p.user_id = ?)
```
Change to:
```
      WHERE p.user_id = ? AND (p.publish_at IS NULL OR p.publish_at <= NOW() OR p.user_id = ?) AND p.deleted_at IS NULL
```

- [ ] **Step 4: Verify**

Start the app. Delete a comment on a post and confirm it disappears from the post detail page. Confirm the latest-comment preview on the feed card no longer shows a deleted comment (visit the feed after deleting the most recent comment on a post).

- [ ] **Step 5: Commit**

```bash
git add src/routes/comments.js src/utils/feedData.js src/routes/members.js
git commit -m "feat: soft-delete comments, filter deleted from queries"
```

---

## Task 6: Template Updates — Moderator Button Visibility

**Files:**
- Modify: `src/views/partials/post-card.ejs`
- Modify: `src/views/post.ejs`

- [ ] **Step 1: post-card.ejs — outer action bar condition**

Line 36 currently:
```ejs
      <% if (user.id === post.user_id || user.role === 'admin') { %>
```
Change to:
```ejs
      <% if (user.id === post.user_id || user.role === 'admin' || user.role === 'moderator') { %>
```

- [ ] **Step 2: post-card.ejs — pin button condition**

Line 38 currently:
```ejs
        <% if (user.role === 'admin') { %>
```
Change to:
```ejs
        <% if (user.role === 'admin' || user.role === 'moderator') { %>
```

- [ ] **Step 3: post-card.ejs — scheduled label condition**

Line 27 currently:
```ejs
            <% if (isScheduled && (user.id === post.user_id || user.role === 'admin')) { %>
```
Change to:
```ejs
            <% if (isScheduled && (user.id === post.user_id || user.role === 'admin' || user.role === 'moderator')) { %>
```

- [ ] **Step 4: post.ejs — outer action bar condition**

Line 42 currently:
```ejs
        <% if (user.id === post.user_id || user.role === 'admin') { %>
```
Change to:
```ejs
        <% if (user.id === post.user_id || user.role === 'admin' || user.role === 'moderator') { %>
```

- [ ] **Step 5: post.ejs — pin button condition**

Line 44 currently:
```ejs
          <% if (user.role === 'admin') { %>
```
Change to:
```ejs
          <% if (user.role === 'admin' || user.role === 'moderator') { %>
```

- [ ] **Step 6: post.ejs — comment delete button (top-level comments)**

Line 187 currently:
```ejs
              <% if (user.id === comment.user_id || user.role === 'admin') { %>
```
Change to:
```ejs
              <% if (user.id === comment.user_id || user.role === 'admin' || user.role === 'moderator') { %>
```

- [ ] **Step 7: post.ejs — comment delete button (replies)**

Line 222 currently:
```ejs
              <% if (user.id === reply.user_id || user.role === 'admin') { %>
```
Change to:
```ejs
              <% if (user.id === reply.user_id || user.role === 'admin' || user.role === 'moderator') { %>
```

- [ ] **Step 8: Verify**

Promote a test user to moderator directly in the DB:
```bash
mysql -u root family_news -e "UPDATE users SET role='moderator' WHERE email='<test-email>';"
```
Log in as that user. Confirm:
- Pin button appears on all posts (not just own)
- Big News button appears on all posts
- Delete button appears on all posts
- Delete button appears on all comments/replies on `/post/:id`
- No admin-only UI (user management, events) is visible

- [ ] **Step 9: Commit**

```bash
git add src/views/partials/post-card.ejs src/views/post.ejs
git commit -m "feat: show mod action buttons for moderator role"
```

---

## Task 7: Admin Panel — set-role + Promotion Notification

**Files:**
- Modify: `src/routes/admin.js`
- Modify: `src/views/admin.ejs`

- [ ] **Step 1: admin.js — add imports**

At the top of `src/routes/admin.js`, the current email import is:
```js
const { sendPasswordReset } = require('../email');
```
Change to:
```js
const { sendPasswordReset, sendPromotionNotification } = require('../email');
const { sendPushToUser } = require('../push');
```

- [ ] **Step 2: admin.js — replace toggle-role with set-role**

Remove the entire `router.post('/users/:id/toggle-role', ...)` handler and replace with:

```js
// Set a user's role to member, moderator, or admin; sends a promotion notification on upgrades.
router.post('/users/:id/set-role', async (req, res) => {
  if (parseInt(req.params.id) === req.session.user.id) {
    req.flash('error', 'You cannot change your own role.');
    return res.redirect('/admin');
  }
  const { role } = req.body;
  if (!['member', 'moderator', 'admin'].includes(role)) {
    req.flash('error', 'Invalid role.');
    return res.redirect('/admin');
  }
  try {
    const [[user]] = await pool.query('SELECT id, name, email, role FROM users WHERE id = ?', [req.params.id]);
    if (!user) { req.flash('error', 'User not found.'); return res.redirect('/admin'); }
    await pool.query('UPDATE users SET role = ? WHERE id = ?', [role, req.params.id]);
    const roleLevel = { member: 1, moderator: 2, admin: 3 };
    if (roleLevel[role] > roleLevel[user.role]) {
      sendPromotionNotification(user.email, user.name, role);
      sendPushToUser(user.id, {
        title: `You've been made a ${role === 'moderator' ? 'Moderator' : 'Admin'} on Family News 🎉`,
        body: 'Tap to see your new guide.',
        url: '/guide',
      });
    }
    req.flash('success', `${user.name} is now a ${role}.`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not update role.');
  }
  res.redirect('/admin');
});
```

- [ ] **Step 3: admin.ejs — update role badge to show moderator styling**

Find the role badge span (around line 103):
```ejs
          <span class="text-xs px-2 py-0.5 rounded-full <%= u.role === 'admin' ? 'bg-brand-50 dark:bg-brand-600/20 text-brand-700 dark:text-brand-300' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400' %>">
```
Change to:
```ejs
          <span class="text-xs px-2 py-0.5 rounded-full <%= u.role === 'admin' ? 'bg-brand-50 dark:bg-brand-600/20 text-brand-700 dark:text-brand-300' : u.role === 'moderator' ? 'bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400' %>">
```

- [ ] **Step 4: admin.ejs — replace toggle-role form with set-role select**

Find the toggle-role form block (around line 108-112):
```ejs
          <form method="POST" action="/admin/users/<%= u.id %>/toggle-role" onsubmit="return confirm('<%= u.role === 'admin' ? 'Remove admin?' : 'Make admin?' %>')">
            <button type="submit" class="text-xs text-slate-400 dark:text-slate-500 hover:text-brand-600 dark:hover:text-brand-400 px-2 py-1 border border-slate-200 dark:border-slate-600 rounded-lg transition-colors" title="<%= u.role === 'admin' ? 'Remove admin' : 'Make admin' %>">
              <%= u.role === 'admin' ? '↓' : '↑' %>
            </button>
          </form>
```
Replace with:
```ejs
          <form method="POST" action="/admin/users/<%= u.id %>/set-role" class="flex items-center gap-1" onsubmit="return confirm('Change role for <%= u.name %>?')">
            <select name="role" class="text-xs border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg px-1.5 py-1 min-h-[32px]">
              <option value="member" <%= u.role === 'member' ? 'selected' : '' %>>member</option>
              <option value="moderator" <%= u.role === 'moderator' ? 'selected' : '' %>>moderator</option>
              <option value="admin" <%= u.role === 'admin' ? 'selected' : '' %>>admin</option>
            </select>
            <button type="submit" class="text-xs text-slate-400 dark:text-slate-500 hover:text-brand-600 dark:hover:text-brand-400 px-2 py-1 border border-slate-200 dark:border-slate-600 rounded-lg transition-colors min-h-[32px]">Set</button>
          </form>
```

- [ ] **Step 5: Verify**

Visit `/admin` as admin. For a test user:
1. Change role to `moderator` using the new select and Set button — confirm success flash and purple badge.
2. Change role back to `member` — confirm grey badge, no notification (demotion).
3. Change role to `admin` — confirm success flash and brand badge; if push subscriptions exist for the user, check server log for push attempt.

- [ ] **Step 6: Commit**

```bash
git add src/routes/admin.js src/views/admin.ejs
git commit -m "feat: admin set-role with 3-way selector and promotion notification"
```

---

## Task 8: Mod Panel Routes

**Files:**
- Create: `src/routes/mod.js`

- [ ] **Step 1: Create src/routes/mod.js**

```js
// Mod panel routes: invite management and soft-delete trash/restore.
// Also serves the /guide role-guide page.
// All routes require moderator or admin role (requireMod).
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../db');
const { requireMod } = require('../middleware/auth');
const { deleteUploadedFile } = require('./upload');

router.use(requireMod);

// ── Mod panel ─────────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    const [invites] = await pool.query(`
      SELECT i.*, u1.name AS created_by_name
      FROM invites i
      JOIN users u1 ON i.created_by = u1.id
      WHERE i.use_count < i.max_uses AND i.expires_at > NOW()
      ORDER BY i.created_at DESC
    `);

    const [deletedPosts] = await pool.query(`
      SELECT p.id, p.title, p.content, p.deleted_at, u.name AS author_name
      FROM posts p
      JOIN users u ON p.user_id = u.id
      WHERE p.deleted_at IS NOT NULL AND p.deleted_at > DATE_SUB(NOW(), INTERVAL 14 DAY)
      ORDER BY p.deleted_at DESC
    `);

    const [deletedComments] = await pool.query(`
      SELECT c.id, c.content, c.deleted_at, c.post_id,
             u.name AS author_name, p.title AS post_title
      FROM comments c
      JOIN users u ON c.user_id = u.id
      JOIN posts p ON c.post_id = p.id
      WHERE c.deleted_at IS NOT NULL AND c.deleted_at > DATE_SUB(NOW(), INTERVAL 14 DAY)
      ORDER BY c.deleted_at DESC
    `);

    res.render('mod', { invites, deletedPosts, deletedComments, baseUrl: process.env.BASE_URL });
  } catch (err) {
    console.error(err);
    res.render('error', { message: 'Could not load mod panel.' });
  }
});

// ── Invite management ─────────────────────────────────────────────────────────

router.post('/invites', async (req, res) => {
  const isOpen = req.body.type === 'open';
  try {
    const token = uuidv4().replace(/-/g, '');
    await pool.query(
      `INSERT INTO invites (token, created_by, expires_at, max_uses) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ${isOpen ? '2 DAY' : '7 DAY'}), ?)`,
      [token, req.session.user.id, isOpen ? 50 : 1]
    );
    req.flash('success', `${process.env.BASE_URL}/register?invite=${token}`);
    req.flash('invite_type', isOpen ? 'open' : 'single');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not create invite.');
  }
  res.redirect('/mod');
});

router.post('/invites/:id/revoke', async (req, res) => {
  try {
    await pool.query('UPDATE invites SET expires_at = NOW() WHERE id = ?', [req.params.id]);
    req.flash('success', 'Invite revoked.');
  } catch (err) { console.error(err); }
  res.redirect('/mod');
});

// ── Trash: posts ──────────────────────────────────────────────────────────────

router.post('/posts/:id/restore', async (req, res) => {
  try {
    await pool.query('UPDATE posts SET deleted_at = NULL WHERE id = ?', [req.params.id]);
    req.flash('success', 'Post restored.');
  } catch (err) { console.error(err); req.flash('error', 'Could not restore post.'); }
  res.redirect('/mod');
});

router.post('/posts/:id/purge', async (req, res) => {
  try {
    const [photos] = await pool.query('SELECT photo_url FROM post_photos WHERE post_id = ?', [req.params.id]);
    photos.forEach(ph => deleteUploadedFile(ph.photo_url));
    await pool.query('DELETE FROM posts WHERE id = ?', [req.params.id]);
    req.flash('success', 'Post permanently deleted.');
  } catch (err) { console.error(err); req.flash('error', 'Could not delete post.'); }
  res.redirect('/mod');
});

// ── Trash: comments ───────────────────────────────────────────────────────────

router.post('/comments/:id/restore', async (req, res) => {
  try {
    await pool.query('UPDATE comments SET deleted_at = NULL WHERE id = ?', [req.params.id]);
    req.flash('success', 'Comment restored.');
  } catch (err) { console.error(err); req.flash('error', 'Could not restore comment.'); }
  res.redirect('/mod');
});

router.post('/comments/:id/purge', async (req, res) => {
  try {
    await pool.query('DELETE FROM comments WHERE id = ?', [req.params.id]);
    req.flash('success', 'Comment permanently deleted.');
  } catch (err) { console.error(err); req.flash('error', 'Could not delete comment.'); }
  res.redirect('/mod');
});

// ── Role guide ────────────────────────────────────────────────────────────────

router.get('/guide', (req, res) => {
  res.render('guide');
});

module.exports = router;
```

- [ ] **Step 2: Register in app.js**

In `src/app.js`, after the admin route line:
```js
app.use('/admin', require('./routes/admin'));
```
Add:
```js
app.use('/mod', require('./routes/mod'));
```

- [ ] **Step 3: Verify (routes only, no view yet)**

Start the app. Visit `/mod` as a moderator/admin — should get an error (view doesn't exist yet, that's expected). Visit `/guide` as a moderator/admin — same. Visit `/mod` as a regular member — should get 403 Access denied.

- [ ] **Step 4: Commit**

```bash
git add src/routes/mod.js src/app.js
git commit -m "feat: mod panel routes and /guide route"
```

---

## Task 9: Mod Panel View

**Files:**
- Create: `src/views/mod.ejs`

- [ ] **Step 1: Create src/views/mod.ejs**

```ejs
<%- include('partials/head', { title: 'Mod Panel' }) %>
<%- include('partials/nav') %>

<div class="max-w-2xl mx-auto px-4 py-6 space-y-6">
  <h1 class="text-xl font-semibold text-slate-800 dark:text-slate-100">Mod Panel</h1>

  <%# Flash messages %>
  <% if (flash.success && flash.success.length) { %>
    <% if (flash.invite_type && flash.invite_type[0]) { %>
    <div class="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700 rounded-xl p-4 space-y-2">
      <p class="text-sm font-medium text-green-800 dark:text-green-200">
        <%= flash.invite_type[0] === 'open' ? 'Open invite — share freely (up to 50 uses, expires in 2 days):' : 'New invite link — share this (single use, expires in 7 days):' %>
      </p>
      <div class="flex gap-2 items-center flex-wrap">
        <code class="text-xs bg-white dark:bg-slate-800 border border-green-200 dark:border-green-700 px-2 py-1 rounded-lg text-green-700 dark:text-green-300 break-all flex-1 min-w-0"><%= flash.success[0] %></code>
        <button onclick="navigator.clipboard.writeText('<%= flash.success[0] %>')" class="text-xs bg-green-600 text-white px-3 py-2 rounded-lg hover:bg-green-700 transition-colors whitespace-nowrap min-h-[36px]">Copy link</button>
      </div>
    </div>
    <% } else { %>
    <div class="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700 rounded-xl p-3 text-sm text-green-800 dark:text-green-200"><%= flash.success[0] %></div>
    <% } %>
  <% } %>
  <% if (flash.error && flash.error.length) { %>
  <div class="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded-xl p-3 text-sm text-red-800 dark:text-red-200"><%= flash.error[0] %></div>
  <% } %>

  <%# ── Invites ──────────────────────────────────────────────────── %>
  <section class="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-4 space-y-4">
    <h2 class="font-semibold text-slate-700 dark:text-slate-200">Invite Links</h2>

    <div class="flex gap-2 flex-wrap">
      <form method="POST" action="/mod/invites">
        <button type="submit" name="type" value="single" class="bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors min-h-[36px]">+ Single-use invite (7 days)</button>
      </form>
      <form method="POST" action="/mod/invites">
        <button type="submit" name="type" value="open" class="bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors min-h-[36px]">+ Open invite (2 days)</button>
      </form>
    </div>

    <% if (!invites.length) { %>
    <p class="text-slate-400 dark:text-slate-500 text-sm">No active invites.</p>
    <% } else { %>
    <ul class="space-y-2">
      <% invites.forEach(invite => { const url = baseUrl + '/register?invite=' + invite.token; %>
      <li class="flex items-center gap-2 flex-wrap text-xs text-slate-600 dark:text-slate-300 border border-slate-100 dark:border-slate-700 rounded-lg px-3 py-2">
        <span class="flex-1 min-w-0 truncate font-mono text-slate-400 dark:text-slate-500"><%= invite.token.substring(0,8) %>…</span>
        <span class="text-slate-400 dark:text-slate-500">By <%= invite.created_by_name %> · <%= invite.use_count %>/<%= invite.max_uses %> uses · expires <%= new Date(invite.expires_at).toLocaleDateString('en-US', { month:'short', day:'numeric' }) %></span>
        <button onclick="navigator.clipboard.writeText('<%= url %>')" class="text-xs text-brand-600 dark:text-brand-400 hover:text-brand-700 px-2 py-1.5 border border-brand-200 dark:border-brand-700 rounded-lg transition-colors min-h-[32px]">Copy</button>
        <form method="POST" action="/mod/invites/<%= invite.id %>/revoke" onsubmit="return confirm('Revoke this invite?')">
          <button type="submit" class="text-xs text-red-500 hover:text-red-700 px-2 py-1.5 border border-red-200 dark:border-red-800 rounded-lg transition-colors min-h-[32px]">Revoke</button>
        </form>
      </li>
      <% }) %>
    </ul>
    <% } %>
  </section>

  <%# ── Trash ───────────────────────────────────────────────────── %>
  <section class="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-4 space-y-4">
    <div>
      <h2 class="font-semibold text-slate-700 dark:text-slate-200">Trash</h2>
      <p class="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Items are permanently deleted after 14 days.</p>
    </div>

    <% if (!deletedPosts.length && !deletedComments.length) { %>
    <p class="text-slate-400 dark:text-slate-500 text-sm">Trash is empty.</p>
    <% } %>

    <%# Deleted posts %>
    <% if (deletedPosts.length) { %>
    <div>
      <h3 class="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">Posts (<%= deletedPosts.length %>)</h3>
      <ul class="space-y-2">
        <% deletedPosts.forEach(post => { %>
        <li class="border border-slate-100 dark:border-slate-700 rounded-xl p-3 space-y-2">
          <div>
            <% if (post.title) { %><p class="text-sm font-semibold text-slate-700 dark:text-slate-200"><%= post.title %></p><% } %>
            <p class="text-xs text-slate-500 dark:text-slate-400 line-clamp-2"><%= post.content %></p>
            <p class="text-xs text-slate-400 dark:text-slate-500 mt-1">By <%= post.author_name %> · deleted <%= new Date(post.deleted_at).toLocaleDateString('en-US', { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }) %></p>
          </div>
          <div class="flex gap-2">
            <form method="POST" action="/mod/posts/<%= post.id %>/restore">
              <button type="submit" class="text-xs bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg transition-colors min-h-[32px]">Restore</button>
            </form>
            <form method="POST" action="/mod/posts/<%= post.id %>/purge" onsubmit="return confirm('Permanently delete this post and all its comments?')">
              <button type="submit" class="text-xs text-red-500 hover:text-red-700 px-3 py-1.5 border border-red-200 dark:border-red-800 rounded-lg transition-colors min-h-[32px]">Delete now</button>
            </form>
          </div>
        </li>
        <% }) %>
      </ul>
    </div>
    <% } %>

    <%# Deleted comments %>
    <% if (deletedComments.length) { %>
    <div>
      <h3 class="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">Comments (<%= deletedComments.length %>)</h3>
      <ul class="space-y-2">
        <% deletedComments.forEach(comment => { %>
        <li class="border border-slate-100 dark:border-slate-700 rounded-xl p-3 space-y-2">
          <div>
            <p class="text-xs text-slate-500 dark:text-slate-400 line-clamp-2"><%= comment.content %></p>
            <p class="text-xs text-slate-400 dark:text-slate-500 mt-1">By <%= comment.author_name %> on "<%= comment.post_title || 'untitled post' %>" · deleted <%= new Date(comment.deleted_at).toLocaleDateString('en-US', { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }) %></p>
          </div>
          <div class="flex gap-2">
            <form method="POST" action="/mod/comments/<%= comment.id %>/restore">
              <button type="submit" class="text-xs bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg transition-colors min-h-[32px]">Restore</button>
            </form>
            <form method="POST" action="/mod/comments/<%= comment.id %>/purge" onsubmit="return confirm('Permanently delete this comment?')">
              <button type="submit" class="text-xs text-red-500 hover:text-red-700 px-3 py-1.5 border border-red-200 dark:border-red-800 rounded-lg transition-colors min-h-[32px]">Delete now</button>
            </form>
          </div>
        </li>
        <% }) %>
      </ul>
    </div>
    <% } %>
  </section>
</div>

<script src="/js/app.js"></script>
</body></html>
```

- [ ] **Step 2: Verify**

Visit `/mod` as moderator/admin. Confirm:
1. Invite creation buttons work — create a single-use invite and confirm the link appears.
2. If any soft-deleted posts/comments exist (from Task 4/5 testing), they appear in Trash.
3. Restore a deleted post — confirm it reappears in the main feed.
4. Purge a deleted post — confirm it is gone from DB.

- [ ] **Step 3: Commit**

```bash
git add src/views/mod.ejs
git commit -m "feat: mod panel view with invites and trash"
```

---

## Task 10: Role Guide View

**Files:**
- Create: `src/views/guide.ejs`

- [ ] **Step 1: Create src/views/guide.ejs**

```ejs
<%- include('partials/head', { title: 'Role Guide' }) %>
<%- include('partials/nav') %>

<div class="max-w-2xl mx-auto px-4 py-6">
  <div class="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 space-y-6">

    <div>
      <h1 class="text-xl font-semibold text-slate-800 dark:text-slate-100">
        <%= user.role === 'admin' ? 'Admin Guide' : 'Moderator Guide' %>
      </h1>
      <p class="text-xs font-semibold text-purple-600 dark:text-purple-400 uppercase tracking-wide mt-1">Your role on Family News</p>
      <p class="text-sm text-slate-500 dark:text-slate-400 mt-2">
        <% if (user.role === 'admin') { %>
          You have full control over the site — and everything moderators can do.
        <% } else { %>
          You have a few extra tools to help keep things welcoming and organized. Use them with good judgment — everything deleted can be restored for up to 2 weeks.
        <% } %>
      </p>
    </div>

    <div class="space-y-5">

      <div class="border-l-4 border-purple-400 dark:border-purple-600 pl-4">
        <h2 class="font-semibold text-slate-800 dark:text-slate-100 mb-1">📌 Pinning posts</h2>
        <p class="text-sm text-slate-500 dark:text-slate-400">Use the pin icon on any post to keep it at the top of the feed. Great for important announcements everyone should see. Tap the pin again to unpin.</p>
      </div>

      <div class="border-l-4 border-purple-400 dark:border-purple-600 pl-4">
        <h2 class="font-semibold text-slate-800 dark:text-slate-100 mb-1">📣 Big News</h2>
        <p class="text-sm text-slate-500 dark:text-slate-400">Mark any post as Big News to give it a banner and send a family-wide notification (push + email). Use this for things the whole family should know about. Tap again to unmark.</p>
      </div>

      <div class="border-l-4 border-purple-400 dark:border-purple-600 pl-4">
        <h2 class="font-semibold text-slate-800 dark:text-slate-100 mb-1">✕ Removing posts &amp; comments</h2>
        <p class="text-sm text-slate-500 dark:text-slate-400">You can delete any post or comment — not just your own. Deleted items go to the trash and can be restored within 2 weeks. Use this carefully; members can always remove their own posts themselves.</p>
      </div>

      <div class="border-l-4 border-purple-400 dark:border-purple-600 pl-4">
        <h2 class="font-semibold text-slate-800 dark:text-slate-100 mb-1">🔗 Invite links</h2>
        <p class="text-sm text-slate-500 dark:text-slate-400">Create invite links to bring new family members onto the site. Open invites work for up to 50 people over 2 days — great for sharing broadly. Single-use invites are good for one specific person and last 7 days.</p>
      </div>

      <div class="border-l-4 border-purple-400 dark:border-purple-600 pl-4">
        <h2 class="font-semibold text-slate-800 dark:text-slate-100 mb-1">🗑️ Trash &amp; restore</h2>
        <p class="text-sm text-slate-500 dark:text-slate-400">The <a href="/mod" class="text-purple-600 dark:text-purple-400 hover:underline font-medium">Mod panel</a> shows everything deleted in the last 2 weeks. You can restore anything there, or permanently delete it early if needed.</p>
      </div>

      <% if (user.role === 'admin') { %>
      <div class="border-l-4 border-brand-400 dark:border-brand-600 pl-4">
        <h2 class="font-semibold text-slate-800 dark:text-slate-100 mb-1">👥 User management</h2>
        <p class="text-sm text-slate-500 dark:text-slate-400">The <a href="/admin" class="text-brand-600 dark:text-brand-400 hover:underline font-medium">Admin panel</a> lets you enable/disable accounts, change roles, update emails, send password resets, and manage invite links.</p>
      </div>

      <div class="border-l-4 border-brand-400 dark:border-brand-600 pl-4">
        <h2 class="font-semibold text-slate-800 dark:text-slate-100 mb-1">📅 Birthday &amp; anniversary events</h2>
        <p class="text-sm text-slate-500 dark:text-slate-400">Add family birthdays and anniversaries in the Admin panel. The site automatically posts a celebration message on the right day.</p>
      </div>
      <% } else { %>
      <div class="bg-slate-50 dark:bg-slate-700/40 rounded-xl p-4 space-y-2">
        <p class="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">Admin-only</p>
        <p class="text-sm text-slate-400 dark:text-slate-500">👥 Manage user accounts &amp; roles</p>
        <p class="text-sm text-slate-400 dark:text-slate-500">📅 Add birthday &amp; anniversary events</p>
        <p class="text-sm text-slate-400 dark:text-slate-500">📊 Full analytics &amp; site settings</p>
      </div>
      <% } %>

    </div>
  </div>
</div>

<script src="/js/app.js"></script>
</body></html>
```

- [ ] **Step 2: Verify**

Visit `/guide` as a moderator — should see the purple-accented guide with the admin-only grey box at the bottom.  
Visit `/guide` as an admin — should see the same sections but with two additional brand-colored sections (user management, birthday events) and no grey box.  
Visit `/guide` as a regular member — should get 403 Access denied.

- [ ] **Step 3: Commit**

```bash
git add src/views/guide.ejs
git commit -m "feat: role guide page with role-tailored content"
```

---

## Task 11: Nav Links

**Files:**
- Modify: `src/views/partials/nav.ejs`

- [ ] **Step 1: Add Mod and Guide nav links**

In `src/views/partials/nav.ejs`, find the admin nav block (around line 144):
```ejs
        <% if (user.role === 'admin') { %>
          <a href="/admin" class="fn-nav-link">Admin</a>
          <div class="fn-nav-sep"></div>
        <% } %>
```
Replace with:
```ejs
        <% if (user.role === 'admin') { %>
          <a href="/admin" class="fn-nav-link">Admin</a>
          <div class="fn-nav-sep"></div>
        <% } %>
        <% if (user.role === 'admin' || user.role === 'moderator') { %>
          <a href="/mod" class="fn-nav-link">Mod</a>
          <div class="fn-nav-sep"></div>
          <a href="/guide" class="fn-nav-link">Guide</a>
          <div class="fn-nav-sep"></div>
        <% } %>
```

- [ ] **Step 2: Verify**

Log in as admin — should see: Admin · Mod · Guide · Profile · Sign out.  
Log in as moderator — should see: Mod · Guide · Profile · Sign out (no Admin).  
Log in as member — should see: Profile · Sign out only.

- [ ] **Step 3: Commit**

```bash
git add src/views/partials/nav.ejs
git commit -m "feat: mod and guide nav links for moderator/admin"
```

---

## Task 12: Purge Cron Job

**Files:**
- Modify: `src/cron.js`

- [ ] **Step 1: Add the purge job**

In `src/cron.js`, add the `deleteUploadedFile` import at the top alongside the existing requires:

```js
const { deleteUploadedFile } = require('./routes/upload');
```

Then inside `startCron()`, after the existing `cron.schedule('0 8 * * *', ...)` block and before `console.log('[cron] Birthday/anniversary scheduler started.')`, add:

```js
  // Run at 3am every day — permanently delete posts and comments that have been
  // soft-deleted for more than 14 days.
  cron.schedule('0 3 * * *', async () => {
    console.log('[cron] Running soft-delete purge...');
    try {
      // Purge old deleted posts (photos first, then row — CASCADE handles comments/reactions/post_photos)
      const [oldPosts] = await pool.query(
        'SELECT id FROM posts WHERE deleted_at IS NOT NULL AND deleted_at < DATE_SUB(NOW(), INTERVAL 14 DAY)'
      );
      for (const post of oldPosts) {
        const [photos] = await pool.query('SELECT photo_url FROM post_photos WHERE post_id = ?', [post.id]);
        photos.forEach(ph => deleteUploadedFile(ph.photo_url));
        await pool.query('DELETE FROM posts WHERE id = ?', [post.id]);
        console.log(`[cron] Purged post ${post.id}`);
      }

      // Purge old deleted comments whose parent post is still alive
      const [oldComments] = await pool.query(
        'SELECT id FROM comments WHERE deleted_at IS NOT NULL AND deleted_at < DATE_SUB(NOW(), INTERVAL 14 DAY)'
      );
      for (const comment of oldComments) {
        await pool.query('DELETE FROM comments WHERE id = ?', [comment.id]);
        console.log(`[cron] Purged comment ${comment.id}`);
      }
    } catch (err) {
      console.error('[cron] Purge error:', err.message);
    }
  });
```

And update the log message below it:
```js
  console.log('[cron] Birthday/anniversary and purge schedulers started.');
```

- [ ] **Step 2: Verify**

To test the purge without waiting 14 days, temporarily insert a row and force-purge:

```bash
mysql -u root family_news -e "
  INSERT INTO posts (user_id, title, content, deleted_at)
  SELECT id, 'purge test', 'test content', DATE_SUB(NOW(), INTERVAL 15 DAY)
  FROM users WHERE role='admin' LIMIT 1;
"
```

Then trigger the purge manually by temporarily changing the cron expression to `* * * * *` (every minute), starting the app, waiting one minute, and confirming the post is gone:

```bash
mysql -u root family_news -e "SELECT id FROM posts WHERE title='purge test';"
# Expected: empty result set
```

Revert the cron expression back to `0 3 * * *` before committing.

- [ ] **Step 3: Commit**

```bash
git add src/cron.js
git commit -m "feat: daily cron to purge soft-deleted posts and comments after 14 days"
```

---

## Self-Review Checklist

After all tasks are complete, verify end-to-end:

- [ ] Promote a member to moderator via Admin panel — confirmation flash appears, purple badge shows
- [ ] Log in as the moderator — Mod + Guide links appear in nav, Admin link does not
- [ ] Moderator can pin, big-news, delete any post and comment from the feed and post detail pages
- [ ] Delete a post as moderator — disappears from feed, appears in `/mod` Trash
- [ ] Restore from Trash — post reappears in feed
- [ ] Purge from Trash — post gone from DB
- [ ] Moderator creates an invite from `/mod` — link displays
- [ ] `/guide` shows the correct content for moderator vs admin roles
- [ ] Regular member visiting `/mod` or `/guide` gets 403
- [ ] Promote a member to admin — push + email notification fires
- [ ] Demote admin to member — no notification (demotion is silent)
