# Notification Dismiss Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users permanently delete individual notifications (X button + swipe) and all notifications at once (Clear all) without page reloads.

**Architecture:** Two new DELETE routes handle hard deletes. The view restructures each notification row from a bare `<a>` into a `<div>` wrapper containing the link and an absolute-positioned dismiss button. Optimistic UI: the row animates out immediately; the DELETE request fires in the background.

**Tech Stack:** Node.js/Express, EJS, MySQL (mysql2/promise), vanilla JS, Tailwind CDN

---

### Task 1: Add DELETE routes to notifications.js

**Files:**
- Modify: `src/routes/notifications.js`

The file currently has one route (`GET /`). Add two DELETE routes before `module.exports`.

- [ ] **Step 1: Open `src/routes/notifications.js` and append the two routes before `module.exports = router;`**

The complete file after your edits:

```js
// Lists, marks-read, and allows deletion of the current user's in-app notifications.
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

    if (res.locals.showChangelogDot) {
      pool.query('UPDATE users SET whats_new_seen_at = NOW() WHERE id = ?', [userId])
        .catch(e => console.error('whats_new_seen_at update error:', e.message));
      req.session.user.whats_new_seen_at = new Date();
    }

    res.render('notifications', { notifications });
  } catch (err) {
    console.error(err);
    res.render('error', { message: 'Could not load notifications.' });
  }
});

// Delete one notification — user_id check prevents deleting others' notifications
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM notifications WHERE id = ? AND user_id = ?',
      [req.params.id, req.session.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.json({ ok: false });
  }
});

// Delete all notifications for the current user
router.delete('/', requireAuth, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM notifications WHERE user_id = ?',
      [req.session.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.json({ ok: false });
  }
});

module.exports = router;
```

- [ ] **Step 2: Syntax-check**

```bash
node --check src/routes/notifications.js
```

Expected: no output (clean).

- [ ] **Step 3: Verify routes are registered**

`src/app.js` already has `app.use('/notifications', require('./routes/notifications'))`. Express routes DELETE verb through the same router — no app.js change needed.

- [ ] **Step 4: Commit**

```bash
git add src/routes/notifications.js
git commit -m "feat: add DELETE routes for notification dismiss"
```

---

### Task 2: Restructure notifications.ejs (HTML + CSS)

**Files:**
- Modify: `src/views/notifications.ejs`

Restructure each notification row from a bare `<a>` to a `<div class="notif-row">` wrapper containing the link + an absolute-positioned X button. Add clear-all button, `id="notif-list"` wrapper, and persistent hidden empty state. Add CSS for `.notif-dismiss` and `.notif-row` collapse animation.

No JavaScript behavior yet — X button renders but clicking does nothing until Task 3.

Note on spacing: the outer container uses Tailwind's `space-y-3`. Rows inside `#notif-list` each get `mt-3` via index (first row gets no margin). The `.notif-removing` CSS uses `!important` on margins to override `space-y-3`'s higher-specificity selector during the collapse animation.

Note on X button placement: the `<a>` tag gets `pr-8` (right padding) so text doesn't flow under the button.

- [ ] **Step 1: Replace the entire content of `src/views/notifications.ejs` with:**

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

<style>
  .notif-dismiss {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    width: 1.5rem;
    height: 1.5rem;
    border-radius: 50%;
    border: none;
    background: transparent;
    color: #94a3b8;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.7rem;
    line-height: 1;
    transition: background 0.15s, color 0.15s;
    z-index: 1;
  }
  .notif-dismiss:hover { background: rgba(239,68,68,0.1); color: #ef4444; }
  .dark .notif-dismiss { color: #64748b; }
  .dark .notif-dismiss:hover { background: rgba(239,68,68,0.15); color: #f87171; }

  .notif-row {
    position: relative;
    overflow: hidden;
    transition: max-height 0.25s ease, opacity 0.2s ease, margin 0.25s ease;
    max-height: 200px;
  }
  .notif-row.notif-removing {
    opacity: 0;
    max-height: 0 !important;
    margin-top: 0 !important;
    margin-bottom: 0 !important;
  }
</style>

<div class="max-w-2xl mx-auto px-4 py-6 space-y-3">
  <div class="flex items-center justify-between">
    <h1 class="text-xl font-bold text-slate-800 dark:text-slate-100">Notifications</h1>
    <% if (notifications.length > 0) { %>
    <button id="notif-clear-all" type="button" class="text-xs text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 transition-colors">Clear all</button>
    <% } %>
  </div>

  <% if (showChangelogDot) { %>
  <a href="/whats-new" class="flex items-center gap-3 bg-brand-50 dark:bg-slate-800 rounded-2xl shadow-sm border border-brand-200 dark:border-slate-700 border-l-4 border-l-brand-600 p-4 hover:bg-brand-100 dark:hover:bg-slate-700 transition-colors no-underline">
    <div class="w-9 h-9 rounded-full bg-brand-100 dark:bg-brand-900/40 flex items-center justify-center flex-shrink-0 text-lg">📣</div>
    <div class="flex-1 min-w-0">
      <p class="text-sm font-medium text-slate-800 dark:text-slate-100">Family News has been updated</p>
      <p class="text-xs text-brand-600 dark:text-brand-400 mt-0.5">See what's new →</p>
    </div>
  </a>
  <% } %>

  <p id="notif-empty"
     style="<%= (notifications.length > 0 || showChangelogDot) ? 'display:none' : '' %>"
     class="text-sm text-slate-400 dark:text-slate-500 py-4">Nothing yet — you'll see comments, mentions, and reactions here.</p>

  <div id="notif-list">
    <% notifications.forEach(function(n, i) { %>
    <div class="notif-row<%= i > 0 ? ' mt-3' : '' %>" data-id="<%= n.id %>">
      <a href="/post/<%= n.post_id %>" class="flex items-start gap-3 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-4 pr-8 transition-colors no-underline <%= !n.read_at ? 'bg-blue-50 dark:bg-blue-950/30 hover:bg-blue-100 dark:hover:bg-blue-950/50' : 'bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700' %>">
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
      <button type="button" class="notif-dismiss" data-id="<%= n.id %>" aria-label="Dismiss notification" title="Dismiss">✕</button>
    </div>
    <% }) %>
  </div>
</div>

<script src="/js/app.js"></script>
</body></html>
```

- [ ] **Step 2: Visual verify**

Visit `/notifications` in a browser. Check:
- "Clear all" appears top-right of heading (only if there are notifications)
- Each notification row has a small ✕ button in its top-right corner
- Clicking the ✕ does nothing yet (no JS behavior — expected at this task)
- Tapping a notification still navigates to the post (the link still works)
- Empty state shows when there are no notifications

- [ ] **Step 3: Commit**

```bash
git add src/views/notifications.ejs
git commit -m "feat: add X dismiss button and clear-all to notifications view"
```

---

### Task 3: Add JavaScript — dismiss, clear-all, swipe

**Files:**
- Modify: `src/views/notifications.ejs`

Add a self-executing JS block between `<script src="/js/app.js"></script>` and `</body></html>`. This task adds all three behaviors: X button dismiss, clear-all, and touch swipe.

`dismissRow(row, url)` is the shared helper: adds `notif-removing` CSS class (triggers the collapse animation), fires the DELETE fetch, then removes the element from DOM after 280ms. If the list is now empty, reveals `#notif-empty` and removes the clear-all button.

- [ ] **Step 1: Replace the last two lines of `src/views/notifications.ejs`**

Current last two lines:
```
<script src="/js/app.js"></script>
</body></html>
```

Replace with:
```html
<script src="/js/app.js"></script>
<script>
(function () {
  function dismissRow(row, url) {
    row.classList.add('notif-removing');
    fetch(url, { method: 'DELETE', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
      .catch(function () { row.classList.remove('notif-removing'); });
    setTimeout(function () {
      row.remove();
      if (!document.querySelector('.notif-row')) {
        document.getElementById('notif-empty').style.display = '';
        var cb = document.getElementById('notif-clear-all');
        if (cb) cb.remove();
      }
    }, 280);
  }

  // X button dismiss
  document.querySelectorAll('.notif-dismiss').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      dismissRow(btn.closest('.notif-row'), '/notifications/' + btn.dataset.id);
    });
  });

  // Clear all
  var clearBtn = document.getElementById('notif-clear-all');
  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      var rows = document.querySelectorAll('.notif-row');
      rows.forEach(function (row) { row.classList.add('notif-removing'); });
      fetch('/notifications', { method: 'DELETE', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
        .catch(function () { rows.forEach(function (row) { row.classList.remove('notif-removing'); }); });
      setTimeout(function () {
        rows.forEach(function (row) { row.remove(); });
        document.getElementById('notif-empty').style.display = '';
        clearBtn.remove();
      }, 280);
    });
  }

  // Swipe left to dismiss (touch devices only)
  document.querySelectorAll('.notif-row').forEach(function (row) {
    var startX = 0, startY = 0, dragging = false;
    var link = row.querySelector('a');

    row.addEventListener('touchstart', function (e) {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      dragging = false;
    }, { passive: true });

    row.addEventListener('touchmove', function (e) {
      var dx = e.touches[0].clientX - startX;
      var dy = e.touches[0].clientY - startY;
      // Abort if this is more of a vertical scroll than a horizontal swipe
      if (!dragging && Math.abs(dy) > Math.abs(dx)) return;
      if (dx >= 0) return; // only left swipe
      dragging = true;
      e.preventDefault();
      link.style.transform = 'translateX(' + dx + 'px)';
      link.style.opacity = String(Math.max(0, 1 + dx / 200));
    }, { passive: false });

    row.addEventListener('touchend', function (e) {
      var dx = e.changedTouches[0].clientX - startX;
      if (dragging && dx < -80) {
        dismissRow(row, '/notifications/' + row.dataset.id);
      } else {
        link.style.transform = '';
        link.style.opacity = '';
      }
      dragging = false;
    });
  });
}());
</script>
</body></html>
```

- [ ] **Step 2: Verify behavior**

Desktop:
- Click ✕ on a notification → row collapses and disappears (≈0.25s animation), no page reload
- Click "Clear all" → all rows collapse and disappear, empty state appears, "Clear all" button disappears
- When last notification is dismissed individually, empty state appears and "Clear all" disappears

Mobile (or browser DevTools touch simulation):
- Swipe a row left → row follows your finger, fading slightly
- Swipe past 80px → row collapses and deletes
- Swipe less than 80px → row snaps back

- [ ] **Step 3: Commit and push**

```bash
git add src/views/notifications.ejs
git commit -m "feat: add dismiss JS — X button, clear-all, swipe"
git push
```
