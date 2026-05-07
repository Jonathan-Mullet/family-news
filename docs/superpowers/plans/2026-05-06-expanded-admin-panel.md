# Expanded Admin Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the admin panel with client-side tabs and add site analytics, per-post read receipts, push subscriber management, enhanced invite management, and scheduled post management.

**Architecture:** Single `/admin` GET route pre-fetches all data; JS toggles tab visibility with `localStorage` persistence. All mutations go through new POST routes in `admin.js`. The post-card partial gets an inline read-receipt badge visible to admin/moderator users only.

**Tech Stack:** Node.js/Express, EJS, MySQL 8 (mysql2/promise pool), vanilla JS, Tailwind CSS (CDN), web-push

---

## File Map

| File | Change |
|------|--------|
| `src/push.js` | Add exported `sendTestPushById(subId)` |
| `src/routes/admin.js` | Expand GET data; add 4 new action routes |
| `src/views/admin.ejs` | Full rewrite: tab shell + 5 tab panels (Overview, Content, Users, Invites, Feedback) |
| `src/routes/posts.js` | Add `readersByPost` + `memberCount` to feed GET |
| `src/views/feed.ejs` | Pass new vars to post-card includes |
| `src/views/partials/post-card.ejs` | Add inline read-receipt badge (admin/mod only) |

---

### Task 1: push.js — add sendTestPushById

**Files:**
- Modify: `src/push.js`

Context: `push.js` exports `sendPushToUser` and `sendPushToAllUsers`. The internal `_sendToSubscription(sub, payload)` function does the actual webpush call but swallows errors. We need a new exported function for the admin test-push action that returns success/failure without swallowing errors.

- [ ] **Step 1: Add `sendTestPushById` before `module.exports`**

Open `src/push.js`. Before the `module.exports` line at the bottom, add this function:

```js
/**
 * Sends a test notification to a single subscription by DB id.
 * Returns { ok: true } on success or { ok: false, error: string } on failure.
 * If the subscription is expired (410/404), it is removed from the DB.
 */
async function sendTestPushById(subId) {
  if (!process.env.VAPID_PUBLIC_KEY) return { ok: false, error: 'Push not configured.' };
  try {
    const [[sub]] = await pool.query('SELECT * FROM push_subscriptions WHERE id = ?', [subId]);
    if (!sub) return { ok: false, error: 'Subscription not found.' };
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify({ title: 'Family News', body: 'Test notification — push is working!', url: '/admin' })
    );
    return { ok: true };
  } catch (err) {
    if (err.statusCode === 410 || err.statusCode === 404) {
      await pool.query('DELETE FROM push_subscriptions WHERE id = ?', [subId]);
      return { ok: false, error: 'Subscription expired — removed from DB.' };
    }
    return { ok: false, error: err.message };
  }
}
```

- [ ] **Step 2: Update `module.exports`**

Change the last line of `src/push.js` from:
```js
module.exports = { sendPushToUser, sendPushToAllUsers };
```
to:
```js
module.exports = { sendPushToUser, sendPushToAllUsers, sendTestPushById };
```

- [ ] **Step 3: Verify syntax**

```bash
node -e "require('./src/push.js')" 2>&1
```
Expected: no output (clean require).

- [ ] **Step 4: Commit**

```bash
git add src/push.js
git commit -m "feat: add sendTestPushById to push module"
```

---

### Task 2: admin.js — expand GET /admin data queries

**Files:**
- Modify: `src/routes/admin.js`

Context: The current GET `/` handler fetches users, invites, events, feedback. We need to add: analytics stats (7-day and 30-day), top posts by reads/reactions/comments, most active members, scheduled posts, push subscriptions, per-post read receipt data, and total member count.

- [ ] **Step 1: Replace the GET `/` handler body**

In `src/routes/admin.js`, replace the entire GET `/` handler (lines 16–40) with:

```js
router.get('/', async (req, res) => {
  try {
    const [users] = await pool.query(
      'SELECT id, name, email, role, active, created_at FROM users ORDER BY created_at'
    );
    const [invites] = await pool.query(`
      SELECT i.*, u1.name AS created_by_name, u2.name AS used_by_name
      FROM invites i
      JOIN users u1 ON i.created_by = u1.id
      LEFT JOIN users u2 ON i.used_by = u2.id
      ORDER BY i.created_at DESC LIMIT 50
    `);
    const [events] = await pool.query('SELECT * FROM events ORDER BY month, day, name');
    const [feedback] = await pool.query(`
      SELECT f.*, u.name AS user_name, u.email AS user_email
      FROM feedback f JOIN users u ON f.user_id = u.id
      ORDER BY (f.status = 'open') DESC, f.created_at DESC
    `);

    // ── Analytics ────────────────────────────────────────────────────────────
    const [[stats7d]] = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM posts WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND deleted_at IS NULL) AS posts,
        (SELECT COUNT(*) FROM comments WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND deleted_at IS NULL) AS comments,
        (SELECT COUNT(*) FROM reactions WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)) AS reactions,
        (SELECT COUNT(*) FROM users WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND active = 1) AS new_members
    `);
    const [[stats30d]] = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM posts WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) AND deleted_at IS NULL) AS posts,
        (SELECT COUNT(*) FROM comments WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) AND deleted_at IS NULL) AS comments,
        (SELECT COUNT(*) FROM reactions WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)) AS reactions,
        (SELECT COUNT(*) FROM users WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) AND active = 1) AS new_members
    `);
    const [topByReads] = await pool.query(`
      SELECT p.id, COALESCE(NULLIF(p.title,''), SUBSTRING(p.content, 1, 60)) AS label,
        u.name AS author_name, COUNT(pr.user_id) AS cnt
      FROM posts p JOIN users u ON p.user_id = u.id
      LEFT JOIN post_reads pr ON pr.post_id = p.id
      WHERE p.deleted_at IS NULL
      GROUP BY p.id ORDER BY cnt DESC LIMIT 5
    `);
    const [topByReactions] = await pool.query(`
      SELECT p.id, COALESCE(NULLIF(p.title,''), SUBSTRING(p.content, 1, 60)) AS label,
        u.name AS author_name, COUNT(r.id) AS cnt
      FROM posts p JOIN users u ON p.user_id = u.id
      LEFT JOIN reactions r ON r.post_id = p.id
      WHERE p.deleted_at IS NULL
      GROUP BY p.id ORDER BY cnt DESC LIMIT 5
    `);
    const [topByComments] = await pool.query(`
      SELECT p.id, COALESCE(NULLIF(p.title,''), SUBSTRING(p.content, 1, 60)) AS label,
        u.name AS author_name, COUNT(c.id) AS cnt
      FROM posts p JOIN users u ON p.user_id = u.id
      LEFT JOIN comments c ON c.post_id = p.id AND c.deleted_at IS NULL
      WHERE p.deleted_at IS NULL
      GROUP BY p.id ORDER BY cnt DESC LIMIT 5
    `);
    const [topMembers] = await pool.query(`
      SELECT u.id, u.name,
        (SELECT COUNT(*) FROM posts p WHERE p.user_id = u.id AND p.deleted_at IS NULL) AS post_count,
        (SELECT COUNT(*) FROM comments c WHERE c.user_id = u.id AND c.deleted_at IS NULL) AS comment_count
      FROM users u WHERE u.active = 1
      ORDER BY (post_count + comment_count) DESC LIMIT 5
    `);

    // ── Scheduled posts ───────────────────────────────────────────────────────
    const [scheduledPosts] = await pool.query(`
      SELECT p.id, p.title, p.content, p.publish_at, u.name AS author_name
      FROM posts p JOIN users u ON p.user_id = u.id
      WHERE p.publish_at > NOW() AND p.deleted_at IS NULL
      ORDER BY p.publish_at ASC
    `);

    // ── Push subscriptions ────────────────────────────────────────────────────
    const [pushSubs] = await pool.query(`
      SELECT ps.id, ps.user_id, ps.endpoint, ps.created_at, u.name AS user_name
      FROM push_subscriptions ps JOIN users u ON ps.user_id = u.id
      ORDER BY u.name, ps.created_at
    `);

    // ── Per-post read receipts (last 30 published posts) ─────────────────────
    const [[{ memberCount }]] = await pool.query(
      'SELECT COUNT(*) AS memberCount FROM users WHERE active = 1'
    );
    const [recentPostsForReads] = await pool.query(`
      SELECT p.id, COALESCE(NULLIF(p.title,''), SUBSTRING(p.content, 1, 60)) AS label,
        p.created_at, u.name AS author_name, COUNT(pr.user_id) AS read_count
      FROM posts p JOIN users u ON p.user_id = u.id
      LEFT JOIN post_reads pr ON pr.post_id = p.id
      WHERE p.deleted_at IS NULL AND (p.publish_at IS NULL OR p.publish_at <= NOW())
      GROUP BY p.id ORDER BY p.created_at DESC LIMIT 30
    `);
    let readersByPost = {};
    if (recentPostsForReads.length) {
      const recentIds = recentPostsForReads.map(p => p.id);
      const [readerRows] = await pool.query(
        `SELECT pr.post_id, u.name AS reader_name
         FROM post_reads pr JOIN users u ON pr.user_id = u.id
         WHERE pr.post_id IN (?)`,
        [recentIds]
      );
      readerRows.forEach(r => {
        if (!readersByPost[r.post_id]) readersByPost[r.post_id] = [];
        readersByPost[r.post_id].push(r.reader_name);
      });
    }

    res.render('admin', {
      users, invites, events, feedback, baseUrl: process.env.BASE_URL,
      stats7d, stats30d, topByReads, topByReactions, topByComments, topMembers,
      scheduledPosts, pushSubs, memberCount, recentPostsForReads, readersByPost,
    });
  } catch (err) {
    console.error(err);
    res.render('error', { message: 'Could not load admin panel.' });
  }
});
```

- [ ] **Step 2: Verify the app starts**

```bash
cd /home/jmull/projects/family-news && node -e "
const app = require('./src/app.js');
setTimeout(() => { console.log('OK'); process.exit(0); }, 500);
" 2>&1 | head -5
```
Expected: `OK` (no syntax errors).

- [ ] **Step 3: Commit**

```bash
git add src/routes/admin.js
git commit -m "feat: add analytics, push subs, scheduled posts, and read receipts data to admin GET"
```

---

### Task 3: admin.js — add new action routes

**Files:**
- Modify: `src/routes/admin.js`

Context: `admin.js` already has routes for invites, users, events, feedback. We need 4 more: cancel a scheduled post, reschedule a post, remove a push subscription, and send a test push. The test push route returns JSON (used by a client-side `fetch` — no page reload). Import `sendTestPushById` from `push.js`.

- [ ] **Step 1: Update the `push.js` import at the top of `admin.js`**

Find this line near the top:
```js
const { sendPushToUser } = require('../push');
```
Replace with:
```js
const { sendPushToUser, sendTestPushById } = require('../push');
```

- [ ] **Step 2: Add the 4 new routes before `module.exports`**

Add the following block before the final `module.exports = router;` line:

```js
// Cancel a scheduled post (null publish_at and soft-delete it).
router.post('/posts/:id/cancel-scheduled', async (req, res) => {
  try {
    const [[post]] = await pool.query(
      'SELECT id, publish_at FROM posts WHERE id = ? AND deleted_at IS NULL',
      [req.params.id]
    );
    if (!post || !post.publish_at || new Date(post.publish_at) <= new Date()) {
      req.flash('error', 'Scheduled post not found.');
      return res.redirect('/admin');
    }
    await pool.query(
      'UPDATE posts SET publish_at = NULL, deleted_at = NOW() WHERE id = ?',
      [req.params.id]
    );
    req.flash('success', 'Scheduled post cancelled.');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not cancel post.');
  }
  res.redirect('/admin');
});

// Update the scheduled time of a future post; new time must be in the future.
router.post('/posts/:id/reschedule', async (req, res) => {
  const { publish_at } = req.body;
  if (!publish_at) {
    req.flash('error', 'No date provided.');
    return res.redirect('/admin');
  }
  const parsed = new Date(publish_at);
  if (isNaN(parsed.getTime()) || parsed <= new Date()) {
    req.flash('error', 'New time must be in the future.');
    return res.redirect('/admin');
  }
  try {
    const [[post]] = await pool.query(
      'SELECT id FROM posts WHERE id = ? AND deleted_at IS NULL AND publish_at > NOW()',
      [req.params.id]
    );
    if (!post) {
      req.flash('error', 'Scheduled post not found.');
      return res.redirect('/admin');
    }
    await pool.query('UPDATE posts SET publish_at = ? WHERE id = ?', [parsed, req.params.id]);
    req.flash('success', 'Post rescheduled.');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not reschedule post.');
  }
  res.redirect('/admin');
});

// Delete a push subscription row permanently.
router.post('/push/:id/remove', async (req, res) => {
  try {
    await pool.query('DELETE FROM push_subscriptions WHERE id = ?', [req.params.id]);
    req.flash('success', 'Subscription removed.');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not remove subscription.');
  }
  res.redirect('/admin');
});

// Send a test push to a specific subscription; returns JSON (no page reload).
router.post('/push/:id/test', async (req, res) => {
  const result = await sendTestPushById(parseInt(req.params.id));
  res.json(result);
});
```

- [ ] **Step 3: Verify syntax**

```bash
node -e "require('./src/routes/admin.js')" 2>&1
```
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/routes/admin.js
git commit -m "feat: add cancel-scheduled, reschedule, push-remove, push-test routes to admin"
```

---

### Task 4: admin.ejs — tab shell + Overview tab

**Files:**
- Modify: `src/views/admin.ejs`

Context: `admin.ejs` is currently 289 lines with a flat layout. We are replacing it entirely with a tabbed structure. This task writes the complete file with: the tab bar, the Overview tab fully populated, and four empty placeholder panels for the remaining tabs. Subsequent tasks fill in those panels.

The tab bar uses CSS classes `tab-btn` and `tab-btn--active`. JS switches panels by toggling `hidden`. Active tab is persisted in `localStorage` under the key `adminTab`.

Each stat card shows a big number and a label. Top-posts lists show truncated labels with author and count. The events widget is the existing birthday/anniversary section relocated here.

- [ ] **Step 1: Replace `src/views/admin.ejs` entirely with the following content**

```ejs
<%- include('partials/head', { title: 'Admin' }) %>
<%- include('partials/nav') %>

<style>
  .tab-bar { display:flex; gap:0; border-bottom:1px solid rgba(0,0,0,0.07); margin-bottom:1.25rem; overflow-x:auto; }
  .dark .tab-bar { border-bottom-color:rgba(255,255,255,0.08); }
  .tab-btn {
    flex-shrink:0; padding:0.6rem 1rem; font-size:0.8125rem; font-weight:500;
    color:#64748b; border:none; background:transparent; cursor:pointer;
    border-bottom:2px solid transparent; margin-bottom:-1px;
    transition:color 0.15s, border-color 0.15s; white-space:nowrap;
  }
  .dark .tab-btn { color:#94a3b8; }
  .tab-btn:hover { color:#1e293b; }
  .dark .tab-btn:hover { color:#e2e8f0; }
  .tab-btn--active { color:#2563eb; border-bottom-color:#2563eb; }
  .dark .tab-btn--active { color:#60a5fa; border-bottom-color:#60a5fa; }
</style>

<div class="max-w-3xl mx-auto px-4 py-6">
  <h1 class="text-xl font-bold text-slate-800 dark:text-slate-100 mb-4">Admin Panel</h1>

  <% if (flash.error) { %><div class="mb-4 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-xl text-red-700 dark:text-red-300 text-sm"><%= flash.error %></div><% } %>

  <% if (flash.success) { %>
  <div class="mb-4 p-4 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-xl">
    <p class="text-sm font-semibold text-green-800 dark:text-green-300 mb-2">
      <% if (flash.invite_type === 'open') { %>Open invite — share freely (up to 50 uses, expires in 2 days):<% } else if (flash.invite_type === 'single') { %>New invite link — share this (single use, expires in 7 days):<% } else { %><%= flash.success %><% } %>
    </p>
    <% if (flash.invite_type) { %>
    <div class="flex items-center gap-2 flex-wrap">
      <code class="flex-1 text-xs bg-white dark:bg-slate-800 border border-green-200 dark:border-green-700 rounded-lg px-3 py-2 text-green-700 dark:text-green-300 break-all min-w-0"><%= flash.success %></code>
      <div class="flex gap-2 flex-shrink-0">
        <button onclick="navigator.clipboard.writeText('<%= flash.success %>').then(()=>this.textContent='Copied!')"
          class="text-xs bg-green-600 text-white px-3 py-2 rounded-lg hover:bg-green-700 transition-colors whitespace-nowrap min-h-[36px]">Copy link</button>
        <button id="show-qr-new" data-url="<%= flash.success %>"
          class="text-xs border border-green-300 dark:border-green-700 text-green-700 dark:text-green-300 px-3 py-2 rounded-lg hover:bg-green-50 dark:hover:bg-green-900/40 transition-colors whitespace-nowrap min-h-[36px]">Show QR</button>
      </div>
    </div>
    <div id="qr-new" class="mt-3 hidden"></div>
    <% } %>
  </div>
  <% } %>

  <%# Tab bar %>
  <nav class="tab-bar">
    <button class="tab-btn" data-tab="overview">Overview</button>
    <button class="tab-btn" data-tab="content">Content</button>
    <button class="tab-btn" data-tab="users">Users</button>
    <button class="tab-btn" data-tab="invites">Invites</button>
    <button class="tab-btn" data-tab="feedback">Feedback</button>
  </nav>

  <%# ── Overview tab ──────────────────────────────────────────────────────── %>
  <div id="tab-overview" class="tab-panel space-y-5">

    <%# Activity stats card %>
    <div class="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-5">
      <div class="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <h2 class="font-semibold text-slate-700 dark:text-slate-200">Activity</h2>
        <div class="flex rounded-lg border border-slate-200 dark:border-slate-600 overflow-hidden text-xs">
          <button id="stats-7d-btn" class="px-3 py-1.5 bg-brand-600 text-white transition-colors font-medium">7 days</button>
          <button id="stats-30d-btn" class="px-3 py-1.5 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">30 days</button>
        </div>
      </div>
      <div id="stats-7d" class="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div class="text-center p-3 bg-slate-50 dark:bg-slate-700/50 rounded-xl">
          <div class="text-2xl font-bold text-slate-800 dark:text-slate-100"><%= stats7d.posts %></div>
          <div class="text-xs text-slate-400 dark:text-slate-500 mt-1">Posts</div>
        </div>
        <div class="text-center p-3 bg-slate-50 dark:bg-slate-700/50 rounded-xl">
          <div class="text-2xl font-bold text-slate-800 dark:text-slate-100"><%= stats7d.comments %></div>
          <div class="text-xs text-slate-400 dark:text-slate-500 mt-1">Comments</div>
        </div>
        <div class="text-center p-3 bg-slate-50 dark:bg-slate-700/50 rounded-xl">
          <div class="text-2xl font-bold text-slate-800 dark:text-slate-100"><%= stats7d.reactions %></div>
          <div class="text-xs text-slate-400 dark:text-slate-500 mt-1">Reactions</div>
        </div>
        <div class="text-center p-3 bg-slate-50 dark:bg-slate-700/50 rounded-xl">
          <div class="text-2xl font-bold text-slate-800 dark:text-slate-100"><%= stats7d.new_members %></div>
          <div class="text-xs text-slate-400 dark:text-slate-500 mt-1">New members</div>
        </div>
      </div>
      <div id="stats-30d" class="grid grid-cols-2 sm:grid-cols-4 gap-3" style="display:none">
        <div class="text-center p-3 bg-slate-50 dark:bg-slate-700/50 rounded-xl">
          <div class="text-2xl font-bold text-slate-800 dark:text-slate-100"><%= stats30d.posts %></div>
          <div class="text-xs text-slate-400 dark:text-slate-500 mt-1">Posts</div>
        </div>
        <div class="text-center p-3 bg-slate-50 dark:bg-slate-700/50 rounded-xl">
          <div class="text-2xl font-bold text-slate-800 dark:text-slate-100"><%= stats30d.comments %></div>
          <div class="text-xs text-slate-400 dark:text-slate-500 mt-1">Comments</div>
        </div>
        <div class="text-center p-3 bg-slate-50 dark:bg-slate-700/50 rounded-xl">
          <div class="text-2xl font-bold text-slate-800 dark:text-slate-100"><%= stats30d.reactions %></div>
          <div class="text-xs text-slate-400 dark:text-slate-500 mt-1">Reactions</div>
        </div>
        <div class="text-center p-3 bg-slate-50 dark:bg-slate-700/50 rounded-xl">
          <div class="text-2xl font-bold text-slate-800 dark:text-slate-100"><%= stats30d.new_members %></div>
          <div class="text-xs text-slate-400 dark:text-slate-500 mt-1">New members</div>
        </div>
      </div>
    </div>

    <%# Top posts card %>
    <div class="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-5">
      <h2 class="font-semibold text-slate-700 dark:text-slate-200 mb-4">Top Posts</h2>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <p class="text-xs font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-2">By reads</p>
          <% if (!topByReads.length) { %><p class="text-xs text-slate-400">No data yet.</p><% } %>
          <% topByReads.forEach((p, i) => { %>
          <div class="flex items-center gap-2 py-1.5 <%= i < topByReads.length - 1 ? 'border-b border-slate-100 dark:border-slate-700' : '' %>">
            <span class="text-xs font-bold text-slate-300 dark:text-slate-600 w-4"><%= i + 1 %></span>
            <div class="flex-1 min-w-0">
              <p class="text-xs text-slate-700 dark:text-slate-200 truncate"><%= p.label %></p>
              <p class="text-xs text-slate-400 dark:text-slate-500"><%= p.author_name %></p>
            </div>
            <span class="text-xs font-semibold text-brand-600 dark:text-brand-400 flex-shrink-0"><%= p.cnt %></span>
          </div>
          <% }) %>
        </div>
        <div>
          <p class="text-xs font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-2">By reactions</p>
          <% if (!topByReactions.length) { %><p class="text-xs text-slate-400">No data yet.</p><% } %>
          <% topByReactions.forEach((p, i) => { %>
          <div class="flex items-center gap-2 py-1.5 <%= i < topByReactions.length - 1 ? 'border-b border-slate-100 dark:border-slate-700' : '' %>">
            <span class="text-xs font-bold text-slate-300 dark:text-slate-600 w-4"><%= i + 1 %></span>
            <div class="flex-1 min-w-0">
              <p class="text-xs text-slate-700 dark:text-slate-200 truncate"><%= p.label %></p>
              <p class="text-xs text-slate-400 dark:text-slate-500"><%= p.author_name %></p>
            </div>
            <span class="text-xs font-semibold text-brand-600 dark:text-brand-400 flex-shrink-0"><%= p.cnt %></span>
          </div>
          <% }) %>
        </div>
        <div>
          <p class="text-xs font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-2">By comments</p>
          <% if (!topByComments.length) { %><p class="text-xs text-slate-400">No data yet.</p><% } %>
          <% topByComments.forEach((p, i) => { %>
          <div class="flex items-center gap-2 py-1.5 <%= i < topByComments.length - 1 ? 'border-b border-slate-100 dark:border-slate-700' : '' %>">
            <span class="text-xs font-bold text-slate-300 dark:text-slate-600 w-4"><%= i + 1 %></span>
            <div class="flex-1 min-w-0">
              <p class="text-xs text-slate-700 dark:text-slate-200 truncate"><%= p.label %></p>
              <p class="text-xs text-slate-400 dark:text-slate-500"><%= p.author_name %></p>
            </div>
            <span class="text-xs font-semibold text-brand-600 dark:text-brand-400 flex-shrink-0"><%= p.cnt %></span>
          </div>
          <% }) %>
        </div>
      </div>
    </div>

    <%# Most active members card %>
    <div class="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-5">
      <h2 class="font-semibold text-slate-700 dark:text-slate-200 mb-3">Most Active Members</h2>
      <% if (!topMembers.length) { %><p class="text-sm text-slate-400">No data yet.</p><% } %>
      <div class="divide-y divide-slate-100 dark:divide-slate-700">
        <% topMembers.forEach(m => { %>
        <div class="flex items-center justify-between py-2.5">
          <p class="text-sm font-medium text-slate-800 dark:text-slate-100"><%= m.name %></p>
          <div class="flex gap-4 text-xs text-slate-400 dark:text-slate-500">
            <span><%= m.post_count %> posts</span>
            <span><%= m.comment_count %> comments</span>
            <span class="font-semibold text-slate-600 dark:text-slate-300"><%= m.post_count + m.comment_count %> total</span>
          </div>
        </div>
        <% }) %>
      </div>
    </div>

    <%# Events widget (relocated from its own section) %>
    <div class="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-5">
      <h2 class="font-semibold text-slate-700 dark:text-slate-200 mb-4">Birthday & Anniversary Reminders</h2>
      <p class="text-xs text-slate-400 dark:text-slate-500 mb-4">Events post automatically at 8am on the matching day.</p>
      <form method="POST" action="/admin/events" class="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        <input type="text" name="name" placeholder="Name" required
          class="col-span-2 sm:col-span-1 border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 placeholder-slate-400 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600 min-h-[40px]">
        <select name="type" class="border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600 min-h-[40px]">
          <option value="birthday">Birthday</option>
          <option value="anniversary">Anniversary</option>
        </select>
        <input type="number" name="month" placeholder="Month" min="1" max="12" required
          class="border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 placeholder-slate-400 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600 min-h-[40px]">
        <input type="number" name="day" placeholder="Day" min="1" max="31" required
          class="border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 placeholder-slate-400 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600 min-h-[40px]">
        <input type="text" name="note" placeholder="Extra note (optional)"
          class="col-span-2 sm:col-span-3 border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 placeholder-slate-400 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600 min-h-[40px]">
        <button type="submit" class="bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors min-h-[40px]">Add</button>
      </form>
      <% if (events.length) { %>
      <div class="divide-y divide-slate-100 dark:divide-slate-700">
        <% events.forEach(ev => { %>
        <div class="flex items-center justify-between py-2.5 gap-3">
          <div>
            <span class="text-sm font-medium text-slate-800 dark:text-slate-100"><%= ev.name %></span>
            <span class="text-xs text-slate-400 dark:text-slate-500 ml-2 capitalize"><%= ev.type %></span>
            <span class="text-xs text-slate-400 dark:text-slate-500 ml-1">· <%= ev.month %>/<%= ev.day %></span>
            <% if (ev.note) { %><span class="text-xs text-slate-400 dark:text-slate-500 ml-1">— <%= ev.note %></span><% } %>
          </div>
          <form method="POST" action="/admin/events/<%= ev.id %>/delete" onsubmit="return confirm('Delete this event?')">
            <button type="submit" class="text-xs text-slate-300 dark:text-slate-600 hover:text-red-400 transition-colors px-2 py-1 border border-slate-200 dark:border-slate-600 rounded-lg">Delete</button>
          </form>
        </div>
        <% }) %>
      </div>
      <% } else { %>
      <p class="text-sm text-slate-400 dark:text-slate-500 text-center py-4">No events yet.</p>
      <% } %>
    </div>
  </div><%# end tab-overview %>

  <%# ── Content tab (placeholder — filled in next task) ─────────────────── %>
  <div id="tab-content" class="tab-panel hidden space-y-5">
    <p class="text-slate-400 text-sm">Content tab coming soon.</p>
  </div>

  <%# ── Users tab (placeholder) ─────────────────────────────────────────── %>
  <div id="tab-users" class="tab-panel hidden space-y-5">
    <p class="text-slate-400 text-sm">Users tab coming soon.</p>
  </div>

  <%# ── Invites tab (placeholder) ───────────────────────────────────────── %>
  <div id="tab-invites" class="tab-panel hidden space-y-5">
    <p class="text-slate-400 text-sm">Invites tab coming soon.</p>
  </div>

  <%# ── Feedback tab (placeholder) ──────────────────────────────────────── %>
  <div id="tab-feedback" class="tab-panel hidden space-y-5">
    <p class="text-slate-400 text-sm">Feedback tab coming soon.</p>
  </div>

</div><%# end max-w-3xl %>

<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
<script src="/js/app.js"></script>
<script>
(function () {
  // ── Tab switching ──────────────────────────────────────────────────────────
  var tabs = document.querySelectorAll('.tab-btn');
  var panels = document.querySelectorAll('.tab-panel');
  var saved = localStorage.getItem('adminTab') || 'overview';

  function activateTab(name) {
    tabs.forEach(function(t) {
      t.classList.toggle('tab-btn--active', t.dataset.tab === name);
    });
    panels.forEach(function(p) {
      p.classList.toggle('hidden', p.id !== 'tab-' + name);
    });
    localStorage.setItem('adminTab', name);
  }

  tabs.forEach(function(t) {
    t.addEventListener('click', function() { activateTab(t.dataset.tab); });
  });
  activateTab(saved);

  // ── Activity 7d/30d toggle ─────────────────────────────────────────────────
  // Use style.display (not classList) to avoid Tailwind class specificity conflicts.
  var btn7 = document.getElementById('stats-7d-btn');
  var btn30 = document.getElementById('stats-30d-btn');
  var div7 = document.getElementById('stats-7d');
  var div30 = document.getElementById('stats-30d');
  if (btn7 && btn30) {
    btn7.addEventListener('click', function() {
      div7.style.display = 'grid'; div30.style.display = 'none';
      btn7.classList.add('bg-brand-600', 'text-white');
      btn7.classList.remove('text-slate-500');
      btn30.classList.remove('bg-brand-600', 'text-white');
      btn30.classList.add('text-slate-500');
    });
    btn30.addEventListener('click', function() {
      div30.style.display = 'grid'; div7.style.display = 'none';
      btn30.classList.add('bg-brand-600', 'text-white');
      btn30.classList.remove('text-slate-500');
      btn7.classList.remove('bg-brand-600', 'text-white');
      btn7.classList.add('text-slate-500');
    });
  }

  // ── QR code (for invite flash) ─────────────────────────────────────────────
  function makeQR(container, url) {
    container.classList.remove('hidden');
    if (container.children.length) return;
    var isDark = document.documentElement.classList.contains('dark');
    new QRCode(container, {
      text: url, width: 160, height: 160,
      colorDark: isDark ? '#e2e8f0' : '#1e293b',
      colorLight: isDark ? '#1e293b' : '#ffffff',
    });
  }
  var showQrNew = document.getElementById('show-qr-new');
  if (showQrNew) {
    showQrNew.addEventListener('click', function() {
      makeQR(document.getElementById('qr-new'), showQrNew.dataset.url);
    });
  }
}());
</script>
</body></html>
```

- [ ] **Step 2: Verify the admin page loads**

With the app running locally (`npm start`), visit `/admin` in a browser. Confirm:
- Tab bar shows 5 tabs
- Overview tab is active by default
- Activity cards show numbers
- Top Posts section shows 3 columns
- Most Active Members list shows
- Events widget shows the add form
- Clicking tabs switches panels
- Refreshing the page returns to the same tab

If app isn't running locally, verify syntax:
```bash
node -e "require('./src/app.js')" 2>&1 | head -3
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/views/admin.ejs
git commit -m "feat: add tabbed admin shell and Overview tab with analytics"
```

---

### Task 5: admin.ejs — Content tab (scheduled posts + read receipts)

**Files:**
- Modify: `src/views/admin.ejs`

Context: The Content tab panel currently contains a placeholder. Replace it with two panels: (1) Scheduled Posts — table of future posts with cancel and reschedule actions; (2) Per-Post Read Receipts — last 30 posts with read counts, each expandable to show reader names.

The reschedule form is revealed inline (hidden by default, toggled by a button). The cancel action is a POST form with a confirm dialog. The read receipts table uses `<details>` for expand/collapse.

Variables available: `scheduledPosts` (array of `{id, title, content, publish_at, author_name}`), `recentPostsForReads` (array of `{id, label, created_at, author_name, read_count}`), `readersByPost` (map of `postId → [reader names]`), `memberCount` (number).

- [ ] **Step 1: Replace the Content tab placeholder in `src/views/admin.ejs`**

Find this block (the placeholder div):
```ejs
  <%# ── Content tab (placeholder — filled in next task) ─────────────────── %>
  <div id="tab-content" class="tab-panel hidden space-y-5">
    <p class="text-slate-400 text-sm">Content tab coming soon.</p>
  </div>
```

Replace it with:
```ejs
  <%# ── Content tab ─────────────────────────────────────────────────────── %>
  <div id="tab-content" class="tab-panel hidden space-y-5">

    <%# Scheduled Posts %>
    <div class="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
      <div class="px-5 py-4 border-b border-slate-100 dark:border-slate-700">
        <h2 class="font-semibold text-slate-700 dark:text-slate-200">Scheduled Posts (<%= scheduledPosts.length %>)</h2>
      </div>
      <% if (!scheduledPosts.length) { %>
      <p class="text-sm text-slate-400 dark:text-slate-500 text-center py-6">No scheduled posts.</p>
      <% } else { %>
      <div class="divide-y divide-slate-100 dark:divide-slate-700">
        <% scheduledPosts.forEach(p => { %>
        <div class="px-5 py-4">
          <div class="flex items-start gap-3">
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">
                <%= p.title || p.content.substring(0, 60) + (p.content.length > 60 ? '…' : '') %>
              </p>
              <p class="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                by <%= p.author_name %> · Scheduled for
                <strong class="text-amber-600 dark:text-amber-400">
                  <%= new Date(p.publish_at).toLocaleString('en-US', { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }) %>
                </strong>
              </p>
            </div>
            <div class="flex gap-2 flex-shrink-0">
              <button type="button"
                class="reschedule-toggle text-xs text-brand-600 dark:text-brand-400 hover:text-brand-700 px-2 py-1.5 border border-brand-200 dark:border-brand-700 rounded-lg transition-colors min-h-[32px]"
                data-target="reschedule-<%= p.id %>">Reschedule</button>
              <form method="POST" action="/admin/posts/<%= p.id %>/cancel-scheduled" onsubmit="return confirm('Cancel and delete this scheduled post?')">
                <button type="submit" class="text-xs text-red-400 hover:text-red-600 px-2 py-1.5 border border-red-200 dark:border-red-800 rounded-lg transition-colors min-h-[32px]">Cancel post</button>
              </form>
            </div>
          </div>
          <div id="reschedule-<%= p.id %>" class="hidden mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">
            <form method="POST" action="/admin/posts/<%= p.id %>/reschedule" class="flex items-center gap-2 flex-wrap">
              <input type="datetime-local" name="publish_at"
                value="<%= new Date(p.publish_at).toISOString().slice(0,16) %>"
                class="border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-600 min-h-[34px]">
              <button type="submit" class="text-xs bg-brand-600 hover:bg-brand-700 text-white px-3 py-1.5 rounded-lg transition-colors min-h-[34px]">Save new time</button>
            </form>
          </div>
        </div>
        <% }) %>
      </div>
      <% } %>
    </div>

    <%# Per-Post Read Receipts %>
    <div class="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
      <div class="px-5 py-4 border-b border-slate-100 dark:border-slate-700">
        <h2 class="font-semibold text-slate-700 dark:text-slate-200">Read Receipts <span class="text-slate-400 font-normal text-sm">(last 30 posts)</span></h2>
      </div>
      <% if (!recentPostsForReads.length) { %>
      <p class="text-sm text-slate-400 dark:text-slate-500 text-center py-6">No posts yet.</p>
      <% } else { %>
      <div class="divide-y divide-slate-100 dark:divide-slate-700">
        <% recentPostsForReads.forEach(p => { %>
        <% const readers = readersByPost[p.id] || []; %>
        <details class="group">
          <summary class="flex items-center gap-3 px-5 py-3 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/30 list-none">
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-slate-800 dark:text-slate-100 truncate"><%= p.label %></p>
              <p class="text-xs text-slate-400 dark:text-slate-500"><%= p.author_name %> · <%= new Date(p.created_at).toLocaleDateString('en-US', { month:'short', day:'numeric' }) %></p>
            </div>
            <span class="text-xs font-semibold <%= readers.length === memberCount ? 'text-green-600 dark:text-green-400' : 'text-slate-500 dark:text-slate-400' %> flex-shrink-0">
              <%= readers.length %> / <%= memberCount %> read
            </span>
          </summary>
          <div class="px-5 pb-3 pt-1">
            <% if (!readers.length) { %>
            <p class="text-xs text-slate-400">No reads yet.</p>
            <% } else { %>
            <p class="text-xs text-slate-600 dark:text-slate-300"><%= readers.join(', ') %></p>
            <% } %>
          </div>
        </details>
        <% }) %>
      </div>
      <% } %>
    </div>
  </div><%# end tab-content %>
```

- [ ] **Step 2: Add reschedule toggle JS**

Find the closing `}());` of the IIFE script block at the bottom of `admin.ejs`. Before it, add:

```js
  // ── Reschedule inline toggle ───────────────────────────────────────────────
  document.querySelectorAll('.reschedule-toggle').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.getElementById(btn.dataset.target).classList.toggle('hidden');
    });
  });
```

- [ ] **Step 3: Verify**

Visit `/admin` in a browser, click the Content tab. Confirm:
- "Scheduled Posts" section shows (empty if no scheduled posts exist, otherwise shows post list with Reschedule/Cancel buttons)
- Clicking Reschedule reveals the datetime input inline
- "Read Receipts" section shows the last 30 posts
- Clicking a row expands to show reader names

If no scheduled posts exist to test with, verify the empty-state message shows. Verify syntax:
```bash
node -e "require('./src/app.js')" 2>&1 | head -3
```

- [ ] **Step 4: Commit**

```bash
git add src/views/admin.ejs
git commit -m "feat: add Content tab with scheduled posts and read receipts"
```

---

### Task 6: admin.ejs — Users tab (user management + push subscribers)

**Files:**
- Modify: `src/views/admin.ejs`

Context: The Users tab placeholder gets replaced with the existing user management section (moved from the old flat layout) plus a new push subscriber management section below it.

The push subscribers section lists subscriptions grouped visually by user. Each row has a Remove button (POST form) and a Test button (uses `fetch`, returns JSON inline feedback). The test result appears as a small status message next to the button.

Variables: `users` (existing), `pushSubs` (array of `{id, user_id, user_name, endpoint, created_at}`).

- [ ] **Step 1: Replace the Users tab placeholder in `src/views/admin.ejs`**

Find:
```ejs
  <%# ── Users tab (placeholder) ─────────────────────────────────────────── %>
  <div id="tab-users" class="tab-panel hidden space-y-5">
    <p class="text-slate-400 text-sm">Users tab coming soon.</p>
  </div>
```

Replace with:
```ejs
  <%# ── Users tab ───────────────────────────────────────────────────────── %>
  <div id="tab-users" class="tab-panel hidden space-y-5">

    <%# User management (identical to old flat layout) %>
    <div class="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
      <div class="px-5 py-4 border-b border-slate-100 dark:border-slate-700">
        <h2 class="font-semibold text-slate-700 dark:text-slate-200">Members (<%= users.length %>)</h2>
      </div>
      <div class="divide-y divide-slate-100 dark:divide-slate-700">
        <% users.forEach(u => { %>
        <div class="flex items-center gap-3 px-5 py-3 <%= !u.active ? 'opacity-50' : '' %>">
          <div class="w-8 h-8 rounded-full bg-brand-100 dark:bg-brand-600/20 flex items-center justify-center text-brand-600 dark:text-brand-400 font-semibold text-sm flex-shrink-0">
            <%= u.name.charAt(0).toUpperCase() %>
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-slate-800 dark:text-slate-100"><%= u.name %></p>
            <p class="text-xs text-slate-400 dark:text-slate-500 truncate"><%= u.email %></p>
          </div>
          <% if (u.id !== user.id) { %>
          <div class="flex gap-1.5 flex-shrink-0">
            <form method="POST" action="/admin/users/<%= u.id %>/set-role" class="flex items-center gap-1">
              <select name="role" class="text-xs border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-brand-600 min-h-[32px]">
                <option value="member" <%= u.role === 'member' ? 'selected' : '' %>>member</option>
                <option value="moderator" <%= u.role === 'moderator' ? 'selected' : '' %>>moderator</option>
                <option value="admin" <%= u.role === 'admin' ? 'selected' : '' %>>admin</option>
              </select>
              <button type="submit" class="text-xs text-slate-400 dark:text-slate-500 hover:text-brand-600 dark:hover:text-brand-400 px-2 py-1 border border-slate-200 dark:border-slate-600 rounded-lg transition-colors min-h-[32px]">Set</button>
            </form>
            <form method="POST" action="/admin/users/<%= u.id %>/toggle-active" onsubmit="return confirm('<%= u.active ? 'Deactivate this account?' : 'Reactivate this account?' %>')">
              <button type="submit" class="text-xs <%= u.active ? 'text-slate-400 dark:text-slate-500 hover:text-red-500' : 'text-green-600 hover:text-green-700' %> px-2 py-1 border border-slate-200 dark:border-slate-600 rounded-lg transition-colors">
                <%= u.active ? 'Disable' : 'Enable' %>
              </button>
            </form>
            <button type="button" class="user-edit-toggle text-xs text-slate-400 dark:text-slate-500 hover:text-brand-600 dark:hover:text-brand-400 px-2 py-1 border border-slate-200 dark:border-slate-600 rounded-lg transition-colors" data-target="user-edit-<%= u.id %>" title="Edit user">⚙</button>
          </div>
          <% } else { %>
          <span class="text-xs text-slate-300 dark:text-slate-600 hidden sm:block">you</span>
          <% } %>
        </div>
        <% if (u.id !== user.id) { %>
        <div id="user-edit-<%= u.id %>" class="hidden px-5 py-3 border-t border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/30 space-y-3">
          <form method="POST" action="/admin/users/<%= u.id %>/update-email" class="flex items-center gap-2 flex-wrap">
            <input type="email" name="email" value="<%= u.email %>" required
              class="flex-1 min-w-0 border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-600 min-h-[34px]">
            <button type="submit" class="text-xs bg-brand-600 hover:bg-brand-700 text-white px-3 py-1.5 rounded-lg transition-colors min-h-[34px] shrink-0">Update email</button>
          </form>
          <form method="POST" action="/admin/users/<%= u.id %>/send-reset">
            <button type="submit" class="text-xs text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400 px-3 py-1.5 border border-slate-200 dark:border-slate-600 rounded-lg transition-colors min-h-[34px]">Send password reset email</button>
          </form>
        </div>
        <% } %>
        <% }) %>
      </div>
    </div>

    <%# Push subscribers %>
    <div class="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
      <div class="px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
        <h2 class="font-semibold text-slate-700 dark:text-slate-200">Push Subscribers</h2>
        <span class="text-xs text-slate-400 dark:text-slate-500"><%= pushSubs.length %> subscription<%= pushSubs.length !== 1 ? 's' : '' %></span>
      </div>
      <% if (!pushSubs.length) { %>
      <p class="text-sm text-slate-400 dark:text-slate-500 text-center py-6">No push subscriptions.</p>
      <% } else { %>
      <div class="divide-y divide-slate-100 dark:divide-slate-700">
        <% pushSubs.forEach(sub => { %>
        <div class="flex items-center gap-3 px-5 py-3">
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-slate-800 dark:text-slate-100"><%= sub.user_name %></p>
            <p class="text-xs text-slate-400 dark:text-slate-500">
              Subscribed <%= new Date(sub.created_at).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }) %>
              · <span class="font-mono"><%= sub.endpoint.slice(-12) %></span>
            </p>
          </div>
          <div class="flex items-center gap-2 flex-shrink-0">
            <button type="button"
              class="push-test-btn text-xs text-brand-600 dark:text-brand-400 hover:text-brand-700 px-2 py-1.5 border border-brand-200 dark:border-brand-700 rounded-lg transition-colors min-h-[32px]"
              data-sub-id="<%= sub.id %>">Test</button>
            <span class="push-test-result-<%= sub.id %> text-xs hidden"></span>
            <form method="POST" action="/admin/push/<%= sub.id %>/remove" onsubmit="return confirm('Remove this push subscription?')">
              <button type="submit" class="text-xs text-red-400 hover:text-red-600 px-2 py-1.5 border border-red-200 dark:border-red-800 rounded-lg transition-colors min-h-[32px]">Remove</button>
            </form>
          </div>
        </div>
        <% }) %>
      </div>
      <% } %>
    </div>
  </div><%# end tab-users %>
```

- [ ] **Step 2: Add user-edit-toggle and push-test JS to the IIFE script block**

Find the closing `}());` of the script IIFE. Before it, add:

```js
  // ── User edit toggle ───────────────────────────────────────────────────────
  document.querySelectorAll('.user-edit-toggle').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.getElementById(btn.dataset.target).classList.toggle('hidden');
    });
  });

  // ── Push test button ───────────────────────────────────────────────────────
  document.querySelectorAll('.push-test-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var subId = btn.dataset.subId;
      var resultEl = document.querySelector('.push-test-result-' + subId);
      btn.disabled = true;
      btn.textContent = 'Sending…';
      fetch('/admin/push/' + subId + '/test', { method: 'POST', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          btn.disabled = false;
          btn.textContent = 'Test';
          if (resultEl) {
            resultEl.classList.remove('hidden');
            resultEl.textContent = data.ok ? '✓ sent' : '✗ ' + data.error;
            resultEl.className = resultEl.className.replace(/text-\w+-\d+/g, '') +
              (data.ok ? ' text-green-600 dark:text-green-400' : ' text-red-500');
            setTimeout(function() { resultEl.classList.add('hidden'); }, 4000);
          }
        })
        .catch(function() {
          btn.disabled = false;
          btn.textContent = 'Test';
        });
    });
  });
```

- [ ] **Step 3: Verify**

Visit `/admin`, click the Users tab. Confirm:
- User list shows with role selector, disable/enable, and ⚙ button
- Clicking ⚙ reveals email update and password reset forms
- Push subscribers section shows (or empty state if none)
- Test button is present for each subscription

Check syntax:
```bash
node -e "require('./src/app.js')" 2>&1 | head -3
```

- [ ] **Step 4: Commit**

```bash
git add src/views/admin.ejs
git commit -m "feat: add Users tab with user management and push subscriber management"
```

---

### Task 7: admin.ejs — Invites tab + Feedback tab

**Files:**
- Modify: `src/views/admin.ejs`

Context: Replace both remaining placeholder panels.

**Invites tab:** Replaces the old invite section with enhanced status-aware display. Each invite shows token (last 8 chars), creator, expiry, use count / max uses, a status badge (Pending/Used/Expired), and a Revoke button for Pending invites. The create form adds a Max Uses input (default 1). The `/admin/invites/:id/revoke` route already exists.

Status logic (computed in template):
- `Pending`: `use_count < max_uses && expires_at > now`
- `Used`: `use_count >= max_uses`
- `Expired`: `expires_at <= now && use_count < max_uses`

**Feedback tab:** Move the existing feedback section here unchanged.

Variables: `invites` (full list with `id, token, created_by_name, used_by_name, expires_at, max_uses, use_count, created_at`), `feedback` (existing).

- [ ] **Step 1: Replace the Invites tab placeholder in `src/views/admin.ejs`**

Find:
```ejs
  <%# ── Invites tab (placeholder) ───────────────────────────────────────── %>
  <div id="tab-invites" class="tab-panel hidden space-y-5">
    <p class="text-slate-400 text-sm">Invites tab coming soon.</p>
  </div>
```

Replace with:
```ejs
  <%# ── Invites tab ─────────────────────────────────────────────────────── %>
  <div id="tab-invites" class="tab-panel hidden space-y-5">
    <div class="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-5">
      <div class="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <h2 class="font-semibold text-slate-700 dark:text-slate-200">Invite Links</h2>
        <div class="flex gap-2 flex-wrap">
          <form method="POST" action="/admin/invites">
            <button type="submit" name="type" value="single" class="bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors min-h-[36px]">
              + Single-use (7 days)
            </button>
          </form>
          <form method="POST" action="/admin/invites">
            <button type="submit" name="type" value="open" class="bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors min-h-[36px]">
              + Open invite (2 days)
            </button>
          </form>
        </div>
      </div>

      <%
        const now = new Date();
        const pending = invites.filter(i => i.use_count < i.max_uses && new Date(i.expires_at) > now);
        const usedUp  = invites.filter(i => i.use_count >= i.max_uses);
        const expired = invites.filter(i => new Date(i.expires_at) <= now && i.use_count < i.max_uses);
      %>

      <% if (!pending.length && !usedUp.length && !expired.length) { %>
      <p class="text-slate-400 dark:text-slate-500 text-sm">No invites yet.</p>
      <% } %>

      <% if (pending.length) { %>
      <p class="text-xs font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-2">Pending (<%= pending.length %>)</p>
      <div class="space-y-2 mb-4">
        <% pending.forEach(invite => { const url = baseUrl + '/register?invite=' + invite.token; %>
        <div class="p-3 bg-slate-50 dark:bg-slate-700/50 rounded-xl">
          <div class="flex items-center gap-3 flex-wrap">
            <div class="flex-1 min-w-0">
              <code class="text-xs text-slate-600 dark:text-slate-300 break-all"><%= url %></code>
              <p class="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                Created by <%= invite.created_by_name %> ·
                Expires <%= new Date(invite.expires_at).toLocaleDateString('en-US', { month:'short', day:'numeric' }) %> ·
                <%= invite.use_count %> / <%= invite.max_uses %> uses
              </p>
            </div>
            <div class="flex gap-2 flex-shrink-0">
              <button onclick="navigator.clipboard.writeText('<%= url %>').then(()=>this.textContent='✓')"
                class="text-xs text-brand-600 dark:text-brand-400 hover:text-brand-700 px-2 py-1.5 border border-brand-200 dark:border-brand-700 rounded-lg transition-colors min-h-[32px]">Copy</button>
              <button class="qr-toggle text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 px-2 py-1.5 border border-slate-200 dark:border-slate-600 rounded-lg transition-colors min-h-[32px]" data-url="<%= url %>" data-target="qr-<%= invite.id %>">QR</button>
              <form method="POST" action="/admin/invites/<%= invite.id %>/revoke" onsubmit="return confirm('Revoke this invite?')">
                <button type="submit" class="text-xs text-red-500 hover:text-red-700 px-2 py-1.5 border border-red-200 dark:border-red-800 rounded-lg transition-colors min-h-[32px]">Revoke</button>
              </form>
            </div>
          </div>
          <div id="qr-<%= invite.id %>" class="mt-3 hidden"></div>
        </div>
        <% }) %>
      </div>
      <% } %>

      <% if (usedUp.length) { %>
      <details class="mb-3">
        <summary class="text-xs text-slate-400 dark:text-slate-500 cursor-pointer hover:text-slate-600 dark:hover:text-slate-300">Used (<%= usedUp.length %>)</summary>
        <div class="mt-2 space-y-1">
          <% usedUp.forEach(invite => { %>
          <p class="text-xs text-slate-400 dark:text-slate-500 px-3 py-1.5 bg-slate-50 dark:bg-slate-700/50 rounded-lg">
            <span class="font-mono"><%= invite.token.slice(-8) %></span> ·
            <%= invite.use_count %> / <%= invite.max_uses %> uses ·
            Created by <%= invite.created_by_name %>
            <% if (invite.used_by_name) { %> · Used by <strong><%= invite.used_by_name %></strong><% } %>
          </p>
          <% }) %>
        </div>
      </details>
      <% } %>

      <% if (expired.length) { %>
      <details>
        <summary class="text-xs text-slate-400 dark:text-slate-500 cursor-pointer hover:text-slate-600 dark:hover:text-slate-300">Expired (<%= expired.length %>)</summary>
        <div class="mt-2 space-y-1">
          <% expired.forEach(invite => { %>
          <p class="text-xs text-slate-400 dark:text-slate-500 px-3 py-1.5 bg-slate-50 dark:bg-slate-700/50 rounded-lg">
            <span class="font-mono"><%= invite.token.slice(-8) %></span> ·
            Expired <%= new Date(invite.expires_at).toLocaleDateString() %> ·
            Created by <%= invite.created_by_name %>
          </p>
          <% }) %>
        </div>
      </details>
      <% } %>
    </div>
  </div><%# end tab-invites %>
```

- [ ] **Step 2: Replace the Feedback tab placeholder in `src/views/admin.ejs`**

Find:
```ejs
  <%# ── Feedback tab (placeholder) ──────────────────────────────────────── %>
  <div id="tab-feedback" class="tab-panel hidden space-y-5">
    <p class="text-slate-400 text-sm">Feedback tab coming soon.</p>
  </div>
```

Replace with:
```ejs
  <%# ── Feedback tab ─────────────────────────────────────────────────────── %>
  <div id="tab-feedback" class="tab-panel hidden space-y-5">
    <div class="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
      <div class="px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
        <h2 class="font-semibold text-slate-700 dark:text-slate-200">Feedback</h2>
        <span class="text-xs text-slate-400 dark:text-slate-500"><%= feedback.filter(f => f.status === 'open').length %> open</span>
      </div>
      <% if (!feedback.length) { %>
      <p class="text-sm text-slate-400 dark:text-slate-500 text-center py-6">No feedback yet.</p>
      <% } else { %>
      <div class="divide-y divide-slate-100 dark:divide-slate-700">
        <% feedback.forEach(item => { %>
        <div class="px-5 py-4">
          <div class="flex items-start gap-3">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap mb-1">
                <% if (item.type === 'bug') { %>
                  <span class="text-xs font-medium bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 px-2 py-0.5 rounded-full">Bug</span>
                  <% if (item.severity) { %><span class="text-xs text-slate-400 dark:text-slate-500 capitalize"><%= item.severity %></span><% } %>
                <% } else { %>
                  <span class="text-xs font-medium bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded-full">Feature</span>
                <% } %>
                <span class="text-xs text-slate-400 dark:text-slate-500">from <%= item.user_name %> · <%= new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) %></span>
              </div>
              <p class="text-sm font-medium text-slate-800 dark:text-slate-100"><%= item.title %></p>
              <details class="mt-1">
                <summary class="text-xs text-slate-400 dark:text-slate-500 cursor-pointer hover:text-slate-600 dark:hover:text-slate-300">Show description</summary>
                <p class="text-sm text-slate-600 dark:text-slate-300 mt-1 whitespace-pre-wrap"><%= item.description %></p>
              </details>
              <% if (item.status === 'resolved') { %>
              <p class="text-xs text-green-600 dark:text-green-400 mt-2">
                Resolved <%= new Date(item.resolved_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) %>
                <% if (item.admin_note) { %> · "<%= item.admin_note %>"<% } %>
              </p>
              <% } %>
            </div>
            <% if (item.status === 'open') { %>
            <button type="button"
              class="resolve-toggle text-xs text-brand-600 dark:text-brand-400 hover:text-brand-700 px-3 py-1.5 border border-brand-200 dark:border-brand-700 rounded-lg transition-colors flex-shrink-0 min-h-[32px]"
              data-target="resolve-<%= item.id %>">Mark Resolved</button>
            <% } %>
          </div>
          <% if (item.status === 'open') { %>
          <div id="resolve-<%= item.id %>" class="hidden mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">
            <form method="POST" action="/admin/feedback/<%= item.id %>/resolve">
              <label class="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Optional message to <%= item.user_name %></label>
              <textarea name="admin_note" rows="2"
                class="w-full border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 placeholder-slate-400 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600 resize-none mb-2">Thanks for the report — this has been addressed!</textarea>
              <button type="submit"
                class="text-xs bg-brand-600 hover:bg-brand-700 text-white px-3 py-1.5 rounded-lg transition-colors min-h-[32px]">Confirm & Notify</button>
            </form>
          </div>
          <% } %>
        </div>
        <% }) %>
      </div>
      <% } %>
    </div>
  </div><%# end tab-feedback %>
```

- [ ] **Step 3: Add QR toggle and resolve-toggle JS to the script IIFE**

Find the closing `}());`. Before it, add:

```js
  // ── QR toggle (invite tab) ─────────────────────────────────────────────────
  document.querySelectorAll('.qr-toggle').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var container = document.getElementById(btn.dataset.target);
      if (!container.classList.contains('hidden')) { container.classList.add('hidden'); return; }
      makeQR(container, btn.dataset.url);
    });
  });

  // ── Resolve toggle (feedback tab) ─────────────────────────────────────────
  document.querySelectorAll('.resolve-toggle').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.getElementById(btn.dataset.target).classList.toggle('hidden');
    });
  });
```

- [ ] **Step 4: Verify**

Visit `/admin`, click:
- Invites tab: shows pending invites (or empty state), used/expired in collapsible sections
- Feedback tab: existing feedback renders correctly; Mark Resolved inline toggle works

Check syntax:
```bash
node -e "require('./src/app.js')" 2>&1 | head -3
```

- [ ] **Step 5: Commit**

```bash
git add src/views/admin.ejs
git commit -m "feat: add Invites tab with status badges and Feedback tab"
```

---

### Task 8: Feed — inline read receipt badge

**Files:**
- Modify: `src/routes/posts.js`
- Modify: `src/views/feed.ejs`
- Modify: `src/views/partials/post-card.ejs`

Context: Admins and moderators should see a "Read by N of M" badge on each post in the feed. The badge shows reader count vs total active members; clicking it expands to show reader names. Data is pre-fetched in the feed GET handler and passed to the post-card partial.

The feed partial currently receives: `post`, `isScheduled`, `reactionsByPost`, `reactionNames`, `commentsByPost`. We add `readersByPost` and `memberCount`.

- [ ] **Step 1: Add reader data to the feed GET handler in `src/routes/posts.js`**

In the GET `/` handler, find the existing read-map block (around line 61–70):
```js
    if (allPosts.length) {
      const ids = allPosts.map(p => p.id);
      const [readRows] = await pool.query(
        'SELECT post_id, COUNT(*) AS read_count FROM post_reads WHERE post_id IN (?) GROUP BY post_id',
        [ids]
      );
      const readMap = {};
      readRows.forEach(r => { readMap[r.post_id] = r.read_count; });
      allPosts.forEach(p => { p.read_count = readMap[p.id] || 0; });
    }
```

Replace it with:
```js
    let readersByPost = {};
    let memberCount = 0;
    if (allPosts.length) {
      const ids = allPosts.map(p => p.id);
      const [readRows] = await pool.query(
        'SELECT post_id, COUNT(*) AS read_count FROM post_reads WHERE post_id IN (?) GROUP BY post_id',
        [ids]
      );
      const readMap = {};
      readRows.forEach(r => { readMap[r.post_id] = r.read_count; });
      allPosts.forEach(p => { p.read_count = readMap[p.id] || 0; });

      if (userId && (req.session.user.role === 'admin' || req.session.user.role === 'moderator')) {
        const [readerRows] = await pool.query(
          `SELECT pr.post_id, u.name AS reader_name
           FROM post_reads pr JOIN users u ON pr.user_id = u.id
           WHERE pr.post_id IN (?)`,
          [ids]
        );
        readerRows.forEach(r => {
          if (!readersByPost[r.post_id]) readersByPost[r.post_id] = [];
          readersByPost[r.post_id].push(r.reader_name);
        });
        const [[mc]] = await pool.query('SELECT COUNT(*) AS cnt FROM users WHERE active = 1');
        memberCount = mc.cnt;
      }
    }
```

- [ ] **Step 2: Pass the new vars to `res.render` in the same handler**

Find:
```js
    res.render('feed', { bigNewsPosts, regularPosts, archivedBigNews, reactionsByPost, reactionNames, commentsByPost, latestPostId });
```

Replace with:
```js
    res.render('feed', { bigNewsPosts, regularPosts, archivedBigNews, reactionsByPost, reactionNames, commentsByPost, latestPostId, readersByPost, memberCount });
```

- [ ] **Step 3: Update all three post-card includes in `src/views/feed.ejs`**

There are three `include('partials/post-card', ...)` calls in `feed.ejs`. Each currently passes `{ post, isScheduled, reactionsByPost, reactionNames, commentsByPost }`. Add `readersByPost` and `memberCount` to all three:

```ejs
<%- include('partials/post-card', { post, isScheduled, reactionsByPost, reactionNames, commentsByPost, readersByPost, memberCount }) %>
```

Run this to find the exact lines to update:
```bash
grep -n "include('partials/post-card'" src/views/feed.ejs
```

Update all three occurrences.

- [ ] **Step 4: Add the read badge to `src/views/partials/post-card.ejs`**

Find the reactions section opener in `post-card.ejs`:
```ejs
  <%# Reactions — Teams-like chip+picker %>
```

Immediately before that line, insert:

```ejs
  <%# Read receipt badge — admin/mod only %>
  <% if (user && (user.role === 'admin' || user.role === 'moderator')) { %>
  <%
    const _cardReaders = (readersByPost && readersByPost[post.id]) || [];
    const _cardMemberCount = memberCount || 0;
  %>
  <div class="px-4 py-1.5 border-t border-slate-100 dark:border-slate-700">
    <details class="group">
      <summary class="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 cursor-pointer list-none transition-colors">
        👁 Read by <span class="font-medium <%= _cardReaders.length === _cardMemberCount && _cardMemberCount > 0 ? 'text-green-600 dark:text-green-400' : '' %>"><%= _cardReaders.length %> of <%= _cardMemberCount %></span>
        <% if (_cardReaders.length) { %><span class="group-open:hidden"> ▾</span><span class="hidden group-open:inline"> ▴</span><% } %>
      </summary>
      <% if (_cardReaders.length) { %>
      <p class="mt-1 text-xs text-slate-500 dark:text-slate-400"><%= _cardReaders.join(', ') %></p>
      <% } %>
    </details>
  </div>
  <% } %>
```

- [ ] **Step 5: Verify**

```bash
node -e "require('./src/app.js')" 2>&1 | head -3
```

Then visit the feed as an admin user. Confirm:
- Each post shows a "👁 Read by N of M" line above the reactions section
- Clicking it expands to show reader names
- Non-admin users do NOT see the badge (log in as a member and verify)

- [ ] **Step 6: Commit**

```bash
git add src/routes/posts.js src/views/feed.ejs src/views/partials/post-card.ejs
git commit -m "feat: add inline read receipt badge to post feed for admin/mod users"
```

---

## Self-Review

After all tasks are complete, verify the following end-to-end:

1. `/admin` loads without errors for an admin user
2. All 5 tabs switch correctly and localStorage persists the active tab on refresh
3. Activity toggle (7d / 30d) switches stat cards correctly
4. Scheduled posts appear in Content tab (create a test scheduled post if needed)
5. Read receipts table shows correct "N of M" per post
6. Push subscriber Test button returns inline success/error without page reload
7. Invite status badges show correctly (Pending/Used/Expired)
8. Feedback Resolve flow still works in the Feedback tab
9. Feed shows 👁 badge for admin users, not for members
10. Dark mode looks correct on all tabs
