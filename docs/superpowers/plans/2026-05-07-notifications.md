# Notifications System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a personal in-app notifications system (comment, reply, mention, reaction events) with a unified pulsing blue nav dot that also absorbs the existing What's New dot.

**Architecture:** A `notifications` table stores one row per event. Notifications are marked read when the user visits the relevant post (from anywhere) or visits /notifications. A single `showNotificationDot` local replaces `showChangelogDot` in the nav, combining unread personal notifications with unread changelog entries.

**Tech Stack:** Node.js/Express, EJS, MySQL (mysql2/promise), existing middleware pattern from app.js

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Create | `src/routes/notifications.js` | GET /notifications: query, mark-read, render |
| Create | `src/views/notifications.ejs` | Notifications page view |
| Modify | `src/db.js` | Add notifications table to initDb() |
| Modify | `src/app.js` | Add showNotificationDot middleware + register router |
| Modify | `src/views/partials/nav.ejs` | Add Notifications link + dot CSS; remove What's New dot |
| Modify | `src/routes/comments.js` | Insert comment/reply/mention notifications |
| Modify | `src/routes/posts.js` | Insert mention notifications; mark read on GET /post/:id |
| Modify | `src/routes/reactions.js` | Insert reaction notification when adding |

---

### Task 1: Add notifications table

**Files:**
- Modify: `src/db.js`

- [ ] **Step 1: Add the table definition**

In `src/db.js`, find the line `    \`CREATE TABLE IF NOT EXISTS changelog (` and the closing `\``,` for that table. Add the notifications table **after** the changelog table closing backtick-comma, still inside the `tables` array:

```js
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
```

- [ ] **Step 2: Add the index migration**

In `src/db.js`, find the last entry in the `migrations` array:
```js
    `ALTER TABLE users ADD COLUMN whats_new_seen_at DATETIME NULL`,
```

Add after it (still inside the migrations array):
```js
    `ALTER TABLE notifications ADD INDEX idx_user_read (user_id, read_at)`,
```

- [ ] **Step 3: Verify syntax**

```bash
node --check src/db.js
```

Expected: no output (clean).

- [ ] **Step 4: Commit**

```bash
git -C /home/jmull/projects/family-news add src/db.js
git -C /home/jmull/projects/family-news commit -m "feat: add notifications table to schema"
```

---

### Task 2: Update app.js middleware and register router

**Files:**
- Modify: `src/app.js`

The request-locals middleware lives at lines 55–75. The `if (req.session.user)` block currently ends with:
```js
    const latestAt = app.locals.latestChangelogAt;
    const seenAt = req.session.user.whats_new_seen_at;
    res.locals.showChangelogDot = !!(latestAt && (!seenAt || new Date(latestAt) > new Date(seenAt)));
  } else {
    res.locals.familyMembers = [];
    res.locals.showChangelogDot = false;
  }
```

- [ ] **Step 1: Extend the if-branch to compute showNotificationDot**

Replace the section above with:

```js
    const latestAt = app.locals.latestChangelogAt;
    const seenAt = req.session.user.whats_new_seen_at;
    res.locals.showChangelogDot = !!(latestAt && (!seenAt || new Date(latestAt) > new Date(seenAt)));
    try {
      const [[{ unread }]] = await pool.query(
        'SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND read_at IS NULL',
        [req.session.user.id]
      );
      res.locals.showNotificationDot = res.locals.showChangelogDot || unread > 0;
    } catch {
      res.locals.showNotificationDot = res.locals.showChangelogDot;
    }
  } else {
    res.locals.familyMembers = [];
    res.locals.showChangelogDot = false;
    res.locals.showNotificationDot = false;
  }
```

- [ ] **Step 2: Register the notifications router**

Find this line in `src/app.js`:
```js
app.use('/whats-new', require('./routes/whats-new'));
```

Add the notifications router directly after it:
```js
app.use('/notifications', require('./routes/notifications'));
```

- [ ] **Step 3: Verify syntax**

```bash
node --check src/app.js
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git -C /home/jmull/projects/family-news add src/app.js
git -C /home/jmull/projects/family-news commit -m "feat: add showNotificationDot middleware and register notifications router"
```

---

### Task 3: Update nav.ejs

**Files:**
- Modify: `src/views/partials/nav.ejs`

- [ ] **Step 1: Add notif-dot CSS**

In `src/views/partials/nav.ejs`, find the first `</style>` closing tag (end of the main style block, after `.dark .fn-dark-toggle:hover { ... }`). Add these rules immediately before that `</style>`:

```css
  .notif-dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #3b82f6;
    margin-left: 4px;
    margin-bottom: 2px;
    vertical-align: middle;
    animation: notif-pulse 1.8s ease-in-out infinite;
  }
  @keyframes notif-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.4; transform: scale(0.75); }
  }
  .dark .notif-dot { background: #60a5fa; }
```

- [ ] **Step 2: Update desktop nav links**

Find this block in the desktop `fn-nav-links` section:
```html
        <a href="/feedback" class="fn-nav-link">Feedback</a>
        <div class="fn-nav-sep"></div>
        <a href="/whats-new" class="fn-nav-link">What's New<% if (showChangelogDot) { %><span class="inline-block w-1.5 h-1.5 rounded-full bg-brand-600 ml-1 mb-0.5 align-middle" aria-hidden="true"></span><% } %></a>
```

Replace it with:
```html
        <a href="/feedback" class="fn-nav-link">Feedback</a>
        <div class="fn-nav-sep"></div>
        <a href="/notifications" class="fn-nav-link">Notifications<% if (showNotificationDot) { %><span class="notif-dot" aria-hidden="true"></span><% } %></a>
        <div class="fn-nav-sep"></div>
        <a href="/whats-new" class="fn-nav-link">What's New</a>
```

- [ ] **Step 3: Update mobile drawer links**

Find this block in the drawer section:
```html
    <a href="/feedback" class="fn-drawer-link">Feedback</a>
    <a href="/whats-new" class="fn-drawer-link">What's New<% if (showChangelogDot) { %><span class="inline-block w-1.5 h-1.5 rounded-full bg-brand-600 ml-0.5 mb-0.5 align-middle" aria-hidden="true"></span><% } %></a>
```

Replace it with:
```html
    <a href="/feedback" class="fn-drawer-link">Feedback</a>
    <a href="/notifications" class="fn-drawer-link">Notifications<% if (showNotificationDot) { %><span class="notif-dot" aria-hidden="true"></span><% } %></a>
    <a href="/whats-new" class="fn-drawer-link">What's New</a>
```

- [ ] **Step 4: Commit**

```bash
git -C /home/jmull/projects/family-news add src/views/partials/nav.ejs
git -C /home/jmull/projects/family-news commit -m "feat: add Notifications nav link with pulsing dot; remove What's New dot"
```

---

### Task 4: Create the notifications route

**Files:**
- Create: `src/routes/notifications.js`

- [ ] **Step 1: Write the route file**

Create `src/routes/notifications.js` with this content:

```js
// Lists the current user's in-app notifications and marks them all as read.
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, async (req, res) => {
  const userId = req.session.user.id;
  try {
    const [notifications] = await pool.query(`
      SELECT n.id, n.type, n.post_id, n.meta, n.read_at, n.created_at,
             u.name AS actor_name, u.avatar_url AS actor_avatar,
             p.title AS post_title
      FROM notifications n
      JOIN users u ON n.actor_id = u.id
      JOIN posts p ON n.post_id = p.id
      WHERE n.user_id = ?
      ORDER BY n.created_at DESC
      LIMIT 50
    `, [userId]);

    await pool.query(
      'UPDATE notifications SET read_at = NOW() WHERE user_id = ? AND read_at IS NULL',
      [userId]
    );

    res.render('notifications', { notifications });
  } catch (err) {
    console.error(err);
    res.render('error', { message: 'Could not load notifications.' });
  }
});

module.exports = router;
```

- [ ] **Step 2: Verify syntax**

```bash
node --check src/routes/notifications.js
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git -C /home/jmull/projects/family-news add src/routes/notifications.js
git -C /home/jmull/projects/family-news commit -m "feat: add GET /notifications route"
```

---

### Task 5: Create the notifications view

**Files:**
- Create: `src/views/notifications.ejs`

- [ ] **Step 1: Write the view**

Create `src/views/notifications.ejs` with this content:

```ejs
<%- include('partials/head', { title: 'Notifications' }) %>
<%- include('partials/nav') %>

<%
function timeAgo(date) {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  if (days < 7) return days + 'd ago';
  return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function describeNotification(n) {
  if (n.type === 'comment') return 'commented on your post';
  if (n.type === 'reply') return 'replied to your comment';
  if (n.type === 'mention') return 'mentioned you';
  if (n.type === 'reaction') return 'reacted ' + n.meta + ' to your post';
  return '';
}
%>

<div class="max-w-2xl mx-auto px-4 py-6 space-y-3">
  <h1 class="text-xl font-bold text-slate-800 dark:text-slate-100">Notifications</h1>

  <% if (showChangelogDot) { %>
  <a href="/whats-new" class="flex items-center gap-3 bg-brand-50 dark:bg-slate-800 rounded-2xl shadow-sm border border-brand-200 dark:border-slate-700 border-l-4 border-l-brand-600 p-4 hover:bg-brand-100 dark:hover:bg-slate-700 transition-colors no-underline">
    <div class="w-9 h-9 rounded-full bg-brand-100 dark:bg-brand-900/40 flex items-center justify-center flex-shrink-0 text-lg">📣</div>
    <div class="flex-1 min-w-0">
      <p class="text-sm font-medium text-slate-800 dark:text-slate-100">Family News has been updated</p>
      <p class="text-xs text-brand-600 dark:text-brand-400 mt-0.5">See what's new →</p>
    </div>
  </a>
  <% } %>

  <% if (notifications.length === 0 && !showChangelogDot) { %>
  <p class="text-sm text-slate-400 dark:text-slate-500 py-4">Nothing yet — you'll see comments, mentions, and reactions here.</p>
  <% } %>

  <% notifications.forEach(function(n) { %>
  <a href="/post/<%= n.post_id %>" class="flex items-start gap-3 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-4 transition-colors no-underline <%= !n.read_at ? 'bg-blue-50 dark:bg-blue-950/30 hover:bg-blue-100 dark:hover:bg-blue-950/50' : 'bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700' %>">
    <% if (n.actor_avatar) { %>
    <img src="<%= n.actor_avatar %>" class="w-9 h-9 rounded-full object-cover flex-shrink-0" alt="">
    <% } else { %>
    <div class="w-9 h-9 rounded-full bg-brand-200 dark:bg-slate-600 flex items-center justify-center flex-shrink-0 text-sm font-semibold text-brand-700 dark:text-slate-200">
      <%= n.actor_name.charAt(0).toUpperCase() %>
    </div>
    <% } %>
    <div class="flex-1 min-w-0">
      <p class="text-sm text-slate-800 dark:text-slate-100">
        <span class="font-semibold"><%= n.actor_name %></span> <%= describeNotification(n) %>
      </p>
      <% if (n.post_title) { %>
      <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate"><%= n.post_title %></p>
      <% } %>
      <p class="text-xs text-slate-400 dark:text-slate-500 mt-0.5"><%= timeAgo(n.created_at) %></p>
    </div>
  </a>
  <% }) %>
</div>

<script src="/js/app.js"></script>
</body></html>
```

- [ ] **Step 2: Commit**

```bash
git -C /home/jmull/projects/family-news add src/views/notifications.ejs
git -C /home/jmull/projects/family-news commit -m "feat: add notifications.ejs view"
```

---

### Task 6: Hook notifications into comments.js

**Files:**
- Modify: `src/routes/comments.js`

This task adds three notification types fired from the comment POST handler:
- `comment` — to the post owner when anyone comments (skip self)
- `reply` — to the parent comment's author when someone replies (skip self)
- `mention` — to each @mentioned user (skip self, already filtered)

- [ ] **Step 1: Capture the new comment's ID**

In `src/routes/comments.js`, find:
```js
    await pool.query(
      'INSERT INTO comments (post_id, parent_id, user_id, content) VALUES (?, ?, ?, ?)',
      [req.params.id, parent_id || null, req.session.user.id, resolvedContent]
    );
```

Replace with:
```js
    const [commentResult] = await pool.query(
      'INSERT INTO comments (post_id, parent_id, user_id, content) VALUES (?, ?, ?, ?)',
      [req.params.id, parent_id || null, req.session.user.id, resolvedContent]
    );
    const commentId = commentResult.insertId;
```

- [ ] **Step 2: Insert comment notification alongside the existing push**

Find this block (inside the `try` for sending to post author):
```js
        if (post.user_id !== req.session.user.id) {
          sendPushToUser(
            post.user_id,
            { title: `${req.session.user.name} commented on your post`, body: content.trim().substring(0, 100), url: `/post/${post.id}` },
            { checkColumn: 'push_notify_comments' }
          );
        }
```

Replace with:
```js
        if (post.user_id !== req.session.user.id) {
          sendPushToUser(
            post.user_id,
            { title: `${req.session.user.name} commented on your post`, body: content.trim().substring(0, 100), url: `/post/${post.id}` },
            { checkColumn: 'push_notify_comments' }
          );
          pool.query(
            'INSERT INTO notifications (user_id, actor_id, type, post_id, comment_id) VALUES (?, ?, ?, ?, ?)',
            [post.user_id, req.session.user.id, 'comment', post.id, commentId]
          ).catch(e => console.error('Notification insert error:', e.message));
        }
```

- [ ] **Step 3: Insert reply notification**

Find the closing `}` of the post-author notify `try` block, just before `// Fire-and-forget: mention notifications`. Add a new fire-and-forget block after the existing one (i.e., after the closing `}` of the post-author try/catch, before the mention block):

```js
    // Fire-and-forget: reply notification
    if (parent_id) {
      (async () => {
        try {
          const [[parentComment]] = await pool.query(
            'SELECT user_id FROM comments WHERE id = ?',
            [parent_id]
          );
          if (parentComment && parentComment.user_id !== req.session.user.id) {
            await pool.query(
              'INSERT INTO notifications (user_id, actor_id, type, post_id, comment_id) VALUES (?, ?, ?, ?, ?)',
              [parentComment.user_id, req.session.user.id, 'reply', req.params.id, commentId]
            );
          }
        } catch (e) { console.error('Reply notification error:', e.message); }
      })();
    }
```

- [ ] **Step 4: Insert mention notifications alongside existing push/email**

Find this section inside the mention fire-and-forget async IIFE:
```js
            for (const mu of mentionedUsers) {
              sendPushToUser(mu.id, { title: `${authorName} mentioned you`, body: excerpt, url: `/post/${postId}` });
              sendMentionNotification(mu.email, mu.name, authorName, excerpt, postUrl);
            }
```

Replace with:
```js
            for (const mu of mentionedUsers) {
              sendPushToUser(mu.id, { title: `${authorName} mentioned you`, body: excerpt, url: `/post/${postId}` });
              sendMentionNotification(mu.email, mu.name, authorName, excerpt, postUrl);
              pool.query(
                'INSERT INTO notifications (user_id, actor_id, type, post_id, comment_id) VALUES (?, ?, ?, ?, ?)',
                [mu.id, req.session.user.id, 'mention', postId, commentId]
              ).catch(e => console.error('Mention notification insert error:', e.message));
            }
```

- [ ] **Step 5: Verify syntax**

```bash
node --check src/routes/comments.js
```

Expected: no output.

- [ ] **Step 6: Commit**

```bash
git -C /home/jmull/projects/family-news add src/routes/comments.js
git -C /home/jmull/projects/family-news commit -m "feat: insert comment/reply/mention notifications from comments route"
```

---

### Task 7: Hook mention notifications into posts.js (new post creation)

**Files:**
- Modify: `src/routes/posts.js`

When a new post is created, @mentioned users should receive an in-app `mention` notification. (Post edits are intentionally excluded — YAGNI.)

- [ ] **Step 1: Capture the new post's ID**

In `src/routes/posts.js`, find (inside the `POST /posts` handler):
```js
    const [result] = await pool.query(
      'INSERT INTO posts (user_id, title, content, publish_at, big_news) VALUES (?, ?, ?, ?, ?)',
      [req.session.user.id, title?.trim() || null, resolvedContent, publishAt, isBigNews]
    );
    const postId = result.insertId;
```

`postId` is already captured here — nothing to change in this step. Confirm it by reading lines 181–185.

- [ ] **Step 2: Insert mention notifications in the new-post mention block**

Find this section inside the new-post mention fire-and-forget IIFE (around line 224):
```js
            for (const mu of mentionedUsers) {
              sendPushToUser(mu.id, { title: `${authorName} mentioned you`, body: excerpt, url: `/post/${postId}` });
              sendMentionNotification(mu.email, mu.name, authorName, excerpt, postUrl);
            }
```

Replace with:
```js
            for (const mu of mentionedUsers) {
              sendPushToUser(mu.id, { title: `${authorName} mentioned you`, body: excerpt, url: `/post/${postId}` });
              sendMentionNotification(mu.email, mu.name, authorName, excerpt, postUrl);
              pool.query(
                'INSERT INTO notifications (user_id, actor_id, type, post_id) VALUES (?, ?, ?, ?)',
                [mu.id, req.session.user.id, 'mention', postId]
              ).catch(e => console.error('Mention notification insert error:', e.message));
            }
```

Note: `comment_id` is intentionally omitted (defaults to NULL) because this is a post-level mention, not inside a comment.

- [ ] **Step 3: Verify syntax**

```bash
node --check src/routes/posts.js
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git -C /home/jmull/projects/family-news add src/routes/posts.js
git -C /home/jmull/projects/family-news commit -m "feat: insert mention notifications from post creation"
```

---

### Task 8: Mark notifications read when viewing a post

**Files:**
- Modify: `src/routes/posts.js`

When a user visits `GET /post/:id`, all their unread notifications for that post should be marked read. This is what makes the dot disappear even when navigating from the feed.

- [ ] **Step 1: Add the fire-and-forget mark-read call**

In `src/routes/posts.js`, find the existing `post_reads` insert inside `GET /post/:id` (around line 118):
```js
    await pool.query(
      'INSERT INTO post_reads (post_id, user_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE read_at = NOW()',
      [post.id, userId]
    );
```

Add immediately after it:
```js
    pool.query(
      'UPDATE notifications SET read_at = NOW() WHERE user_id = ? AND post_id = ? AND read_at IS NULL',
      [userId, post.id]
    ).catch(e => console.error('Notification read error:', e.message));
```

- [ ] **Step 2: Verify syntax**

```bash
node --check src/routes/posts.js
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git -C /home/jmull/projects/family-news add src/routes/posts.js
git -C /home/jmull/projects/family-news commit -m "feat: mark notifications read when viewing a post"
```

---

### Task 9: Hook reaction notifications into reactions.js

**Files:**
- Modify: `src/routes/reactions.js`

When a user adds a reaction (not removes), the post owner gets a `reaction` notification. The emoji is stored in `meta`. Self-reactions are skipped.

- [ ] **Step 1: Look up the post owner and insert the notification on add**

In `src/routes/reactions.js`, find the toggle handler's add-branch:
```js
    } else {
      await pool.query('INSERT INTO reactions (post_id, user_id, emoji) VALUES (?, ?, ?)', [postId, userId, emoji]);
      userReacted = true;
    }
```

Replace with:
```js
    } else {
      await pool.query('INSERT INTO reactions (post_id, user_id, emoji) VALUES (?, ?, ?)', [postId, userId, emoji]);
      userReacted = true;
      // Fire-and-forget: notify post owner (skip self-reactions)
      (async () => {
        try {
          const [[post]] = await pool.query('SELECT user_id FROM posts WHERE id = ?', [postId]);
          if (post && post.user_id !== userId) {
            await pool.query(
              'INSERT INTO notifications (user_id, actor_id, type, post_id, meta) VALUES (?, ?, ?, ?, ?)',
              [post.user_id, userId, 'reaction', postId, emoji]
            );
          }
        } catch (e) { console.error('Reaction notification error:', e.message); }
      })();
    }
```

- [ ] **Step 2: Verify syntax**

```bash
node --check src/routes/reactions.js
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git -C /home/jmull/projects/family-news add src/routes/reactions.js
git -C /home/jmull/projects/family-news commit -m "feat: insert reaction notification when a reaction is added"
```

---

### Task 10: End-to-end verification and deploy

**Files:** None (verification only)

- [ ] **Step 1: Check all modified files pass syntax check**

```bash
node --check src/db.js src/app.js src/routes/notifications.js src/routes/comments.js src/routes/posts.js src/routes/reactions.js
```

Expected: no output from any file.

- [ ] **Step 2: Push to deploy**

```bash
git -C /home/jmull/projects/family-news push
```

The GitHub Actions CI will build the arm64 Docker image and the self-hosted Pi runner will auto-deploy. Wait ~3 minutes for the build to complete.

- [ ] **Step 3: Verify the notifications table was created**

```bash
docker exec mysql mysql -u familynews -pf32a85d6b04822d2c090ce1c1aeea698 family_news -e "DESCRIBE notifications;" 2>/dev/null
```

Expected: table with columns `id, user_id, actor_id, type, post_id, comment_id, meta, read_at, created_at`.

- [ ] **Step 4: Manually verify in the browser at https://news.jonathan-mullet.com**

- Log in as a non-admin member. Navigate to the feed.
- Confirm "Notifications" link appears in the nav between Feedback and What's New.
- Confirm the What's New link no longer has a dot.
- Have another account post a comment on your post (or use the admin to post one). Navigate away and back — the blue pulsing dot should appear on Notifications.
- Click a post directly from the feed (not from /notifications) — the dot should disappear for that post's notifications.
- Visit /notifications — confirms the page loads, the What's New card appears if applicable, and notifications are listed.
- Confirm dark mode works on /notifications (toggle should function as on other pages).

- [ ] **Step 5: Publish a What's New entry**

```bash
cd /home/jmull/projects/family-news && node scripts/add-changelog.js \
  --title "Notifications" \
  --body "You'll now get notified right in the app when someone comments on your post, replies to your comment, mentions you, or reacts to something you shared. Look for the blue dot in the nav — tap Notifications to see everything. The dot also lights up when there are app updates in What's New."
git add src/data/changelog-meta.json
git commit -m "chore: update changelog sidecar"
git push
```
