# Nav Cleanup, Feedback Redesign & Notification AJAX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Feedback link to hamburger drawer, convert desktop nav to icon-only shortcuts, stop notification toggles from scrolling the page to top, and redesign the feedback page with a conversational pill-selector UX.

**Architecture:** Four independent UI changes to the EJS/Express/CSS layer. No new routes; only `/settings/notifications` and `/settings/push-prefs` need AJAX variants. All changes are backwards-compatible — non-JS form fallback for notifications still redirects as before.

**Tech Stack:** Node.js/Express, EJS templates, vanilla CSS (fn-* BEM-ish classes), vanilla JS IIFEs, MySQL via mysql2/promise.

---

## File Map

| File | What changes |
|------|-------------|
| `src/views/partials/nav.ejs` | Task 1 (drawer link) + Task 2 (desktop icon nav) |
| `src/public/css/theme.css` | Task 2 (icon button CSS) + Task 5 (pill CSS) |
| `src/routes/settings.js` | Task 3 (AJAX JSON responses) |
| `src/views/settings.ejs` | Task 4 (AJAX fetch replaces form.submit) |
| `src/views/feedback.ejs` | Task 5 (pill UX redesign) |
| `src/routes/feedback.js` | Task 5 (add `from` to error redirects + render) |

---

### Task 1: Add Feedback link to hamburger drawer

**Files:**
- Modify: `src/views/partials/nav.ejs` (around line 280 — the Account section of the drawer nav)

The drawer nav currently has Settings then What's New under the "Account" section label. Feedback belongs right after What's New.

- [ ] **Step 1: Locate the What's New link in the drawer nav**

Open `src/views/partials/nav.ejs`. Find this block (around line 278–281):

```html
<span class="fn-drawer-section-label">Account</span>
<a href="/settings" class="fn-drawer-link fn-drawer-link--secondary">Settings</a>
<a href="/whats-new" class="fn-drawer-link fn-drawer-link--secondary">What's New</a>
```

- [ ] **Step 2: Add the Feedback link immediately after What's New**

Replace that block with:

```html
<span class="fn-drawer-section-label">Account</span>
<a href="/settings" class="fn-drawer-link fn-drawer-link--secondary">Settings</a>
<a href="/whats-new" class="fn-drawer-link fn-drawer-link--secondary">What's New</a>
<a href="/feedback" class="fn-drawer-link fn-drawer-link--secondary">Feedback</a>
```

- [ ] **Step 3: Manual smoke test**

Start the app (or check Docker logs for running container). Open the hamburger drawer. Confirm "Feedback" appears in the Account section after "What's New". Click it — should navigate to `/feedback`.

- [ ] **Step 4: Commit**

```bash
git add src/views/partials/nav.ejs
git commit -m "feat: add Feedback link to hamburger drawer under What's New"
```

---

### Task 2: Desktop nav → icon-only shortcuts

**Files:**
- Modify: `src/views/partials/nav.ejs` (lines 182–211 — the `.fn-nav-links` div)
- Modify: `src/public/css/theme.css` (add `.fn-nav-icon-btn` styles)

The desktop `.fn-nav-links` div currently holds the user name, separators, and all text nav links. Replace everything inside with two icon buttons: Search and Notifications. The dark-mode toggle and hamburger stay as-is in `.fn-nav-controls`.

- [ ] **Step 1: Add `.fn-nav-icon-btn` CSS to `src/public/css/theme.css`**

Find the `.fn-dark-toggle` rules (around line 86). Add these new rules immediately after the `.fn-dark-toggle` hover rule:

```css
.fn-nav-icon-btn {
  width: 2.75rem;
  height: 2.75rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: 50%;
  color: #8b7355;
  transition: background 0.15s, color 0.15s;
  padding: 0;
  flex-shrink: 0;
  text-decoration: none;
  position: relative;
}

.fn-nav-icon-btn:hover {
  background: rgba(44, 24, 16, 0.06);
  color: #2c1810;
}

.dark .fn-nav-icon-btn { color: #9a7e5a; }
.dark .fn-nav-icon-btn:hover { background: rgba(245, 229, 208, 0.07); color: #f5e5d0; }
```

- [ ] **Step 2: Replace the contents of `.fn-nav-links` in `src/views/partials/nav.ejs`**

Find the current `.fn-nav-links` block (lines 182–211), which looks like:

```html
<div class="fn-nav-links">
  <% if (user) { %>
    <span class="fn-nav-user hidden sm:block"><%= user.name %></span>
    <div class="fn-nav-sep hidden sm:block"></div>
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
    <a href="/search" class="fn-nav-link">Search</a>
    <div class="fn-nav-sep"></div>
    <a href="/photos" class="fn-nav-link">Photos</a>
    <div class="fn-nav-sep"></div>
    <a href="/feedback" class="fn-nav-link">Feedback</a>
    <div class="fn-nav-sep"></div>
    <a href="/notifications" class="fn-nav-link">Notifications<% if (showNotificationDot) { %><span class="notif-dot" aria-hidden="true"></span><% } %></a>
    <div class="fn-nav-sep"></div>
    <a href="/whats-new" class="fn-nav-link">What's New</a>
    <div class="fn-nav-sep"></div>
    <a href="/profile" class="fn-nav-link">Profile</a>
    <div class="fn-nav-sep"></div>
    <a href="/logout" class="fn-nav-link fn-nav-link-danger">Sign out</a>
    <div class="fn-nav-sep"></div>
  <% } %>
</div>
```

Replace the entire block with:

```html
<div class="fn-nav-links">
  <% if (user) { %>
    <a href="/search" class="fn-nav-icon-btn" aria-label="Search">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
        <circle cx="11" cy="11" r="8"/>
        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
    </a>
    <a href="/notifications" class="fn-nav-icon-btn" aria-label="Notifications">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
        <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
      </svg>
      <% if (showNotificationDot) { %><span class="fn-hamburger-dot" aria-hidden="true"></span><% } %>
    </a>
  <% } %>
</div>
```

Note: `.fn-hamburger-dot` is already defined in nav.ejs CSS (position: absolute; top: 8px; right: 8px) and works on any `position: relative` parent — which `.fn-nav-icon-btn` now provides.

- [ ] **Step 3: Manual smoke test**

Open the site on desktop (viewport ≥ 768px). Confirm the nav bar shows only: logo | search icon | notifications icon | dark toggle | hamburger. All text links should be gone. Click search icon → goes to `/search`. Click notifications icon → goes to `/notifications`. Notification dot should appear on both the notifications icon and the hamburger when there are unread notifications.

- [ ] **Step 4: Commit**

```bash
git add src/views/partials/nav.ejs src/public/css/theme.css
git commit -m "feat: replace desktop nav text links with icon shortcuts (search + notifications)"
```

---

### Task 3: AJAX support in settings routes

**Files:**
- Modify: `src/routes/settings.js` (lines 76–91 for `/notifications`, lines 138–155 for `/push-prefs`)

Both routes currently always `res.redirect('/settings')`. They need to detect AJAX requests (via the `X-Requested-With` header that the client will send in Task 4) and respond with JSON instead.

- [ ] **Step 1: Update `/notifications` POST handler**

Find this block (lines 74–91):

```js
// Save the user's email notification preferences for new posts and comments.
// No flash success message — this is an auto-save handler; the flash message would be distracting.
router.post('/notifications', async (req, res) => {
  const notify_posts = req.body.notify_posts ? 1 : 0;
  const notify_comments = req.body.notify_comments ? 1 : 0;
  try {
    await pool.query(
      'UPDATE users SET notify_posts = ?, notify_comments = ? WHERE id = ?',
      [notify_posts, notify_comments, req.session.user.id]
    );
    req.session.user.notify_posts = notify_posts;
    req.session.user.notify_comments = notify_comments;
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not save preferences.');
  }
  res.redirect('/settings');
});
```

Replace with:

```js
// Save the user's email notification preferences for new posts and comments.
// No flash success message — this is an auto-save handler; the flash message would be distracting.
router.post('/notifications', async (req, res) => {
  const isAjax = req.headers['x-requested-with'] === 'XMLHttpRequest';
  const notify_posts = req.body.notify_posts ? 1 : 0;
  const notify_comments = req.body.notify_comments ? 1 : 0;
  try {
    await pool.query(
      'UPDATE users SET notify_posts = ?, notify_comments = ? WHERE id = ?',
      [notify_posts, notify_comments, req.session.user.id]
    );
    req.session.user.notify_posts = notify_posts;
    req.session.user.notify_comments = notify_comments;
  } catch (err) {
    console.error(err);
    if (isAjax) return res.status(500).json({ ok: false, error: 'Could not save preferences.' });
    req.flash('error', 'Could not save preferences.');
  }
  if (isAjax) return res.json({ ok: true });
  res.redirect('/settings');
});
```

- [ ] **Step 2: Update `/push-prefs` POST handler**

Find this block (lines 136–155):

```js
// Save the user's push notification preferences for posts, comments, and big-news announcements.
// No flash success message — this is an auto-save handler; the flash message would be distracting.
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
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not save push preferences.');
  }
  res.redirect('/settings');
});
```

Replace with:

```js
// Save the user's push notification preferences for posts, comments, and big-news announcements.
// No flash success message — this is an auto-save handler; the flash message would be distracting.
router.post('/push-prefs', async (req, res) => {
  const isAjax = req.headers['x-requested-with'] === 'XMLHttpRequest';
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
  } catch (err) {
    console.error(err);
    if (isAjax) return res.status(500).json({ ok: false, error: 'Could not save push preferences.' });
    req.flash('error', 'Could not save push preferences.');
  }
  if (isAjax) return res.json({ ok: true });
  res.redirect('/settings');
});
```

- [ ] **Step 3: Manual smoke test**

```bash
# Start the app or exec into running container, then:
curl -s -X POST http://localhost:3000/settings/notifications \
  -H "X-Requested-With: XMLHttpRequest" \
  -H "Cookie: <copy session cookie from browser>" \
  -d "notify_posts=1&notify_comments=0"
# Expected: {"ok":true}
```

- [ ] **Step 4: Commit**

```bash
git add src/routes/settings.js
git commit -m "feat: add AJAX response to notification settings routes"
```

---

### Task 4: AJAX fetch for notification toggles (client-side)

**Files:**
- Modify: `src/views/settings.ejs` (lines 321–332 — the notification toggle JS)

The current code calls `t.closest('form').submit()` and `document.getElementById('push-prefs-form').submit()`. Replace with `fetch()` calls that send `X-Requested-With: XMLHttpRequest`. 

**Important:** The email prefs forms use hidden fields to carry the "other" toggle's value (e.g., the posts form has a hidden `notify_comments` field). These hidden fields were set at page-render time and go stale when the other toggle is changed via AJAX. Instead of using the form's hidden fields, read both toggles' current checked state directly from the DOM when building the request body. This ensures we always send fresh values regardless of order.

- [ ] **Step 1: Replace the email and push toggle JS in `src/views/settings.ejs`**

Find lines 321–332:

```js
  // ── Email notification auto-save toggles ──────────────────────────────────
  ['toggle-notify-posts', 'toggle-notify-comments'].forEach(function (id) {
    var t = document.getElementById(id);
    if (t) t.addEventListener('change', function () { t.closest('form').submit(); });
  });

  // ── Push pref auto-save toggles (shared form — all three sent together) ───
  document.querySelectorAll('#push-prefs-form input[type="checkbox"]').forEach(function (cb) {
    cb.addEventListener('change', function () {
      document.getElementById('push-prefs-form').submit();
    });
  });
```

Replace with:

```js
  // ── Email notification auto-save toggles (AJAX — avoids scroll-to-top) ───
  function _saveNotifPrefs(failedEl) {
    var posts = document.getElementById('toggle-notify-posts');
    var comments = document.getElementById('toggle-notify-comments');
    var body = 'notify_posts=' + (posts.checked ? 1 : 0) + '&notify_comments=' + (comments.checked ? 1 : 0);
    fetch('/settings/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: body
    }).then(function (r) {
      if (!r.ok && failedEl) failedEl.checked = !failedEl.checked;
    }).catch(function () {
      if (failedEl) failedEl.checked = !failedEl.checked;
    });
  }

  ['toggle-notify-posts', 'toggle-notify-comments'].forEach(function (id) {
    var t = document.getElementById(id);
    if (t) t.addEventListener('change', function () { _saveNotifPrefs(t); });
  });

  // ── Push pref auto-save toggles (AJAX — avoids scroll-to-top) ────────────
  function _savePushPrefs(failedEl) {
    var form = document.getElementById('push-prefs-form');
    if (!form) return;
    var posts = form.querySelector('[name="push_notify_posts"]');
    var comments = form.querySelector('[name="push_notify_comments"]');
    var bigNews = form.querySelector('[name="push_notify_big_news"]');
    var body = 'push_notify_posts=' + (posts.checked ? 1 : 0) +
               '&push_notify_comments=' + (comments.checked ? 1 : 0) +
               '&push_notify_big_news=' + (bigNews.checked ? 1 : 0);
    fetch('/settings/push-prefs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: body
    }).then(function (r) {
      if (!r.ok && failedEl) failedEl.checked = !failedEl.checked;
    }).catch(function () {
      if (failedEl) failedEl.checked = !failedEl.checked;
    });
  }

  document.querySelectorAll('#push-prefs-form input[type="checkbox"]').forEach(function (cb) {
    cb.addEventListener('change', function () { _savePushPrefs(cb); });
  });
```

- [ ] **Step 2: Manual smoke test**

Open the Settings page in a browser. Scroll down to the Notifications section. Toggle any email or push preference on or off. Confirm:
1. The page does **not** scroll back to the top.
2. The toggle stays in its new position.
3. Refresh the page — the new preference value persists.

Also test the error revert: temporarily break the route (e.g., add `throw new Error('test')` in the handler, toggle, confirm the toggle reverts, then remove the throw).

- [ ] **Step 3: Commit**

```bash
git add src/views/settings.ejs
git commit -m "feat: use AJAX for notification toggle saves to prevent scroll-to-top"
```

---

### Task 5: Feedback page redesign — conversational pill UX

**Files:**
- Modify: `src/views/feedback.ejs` (full rewrite of layout)
- Modify: `src/routes/feedback.js` (add `from` to error redirects; add `autoOpen` to render call)
- Modify: `src/public/css/theme.css` (add pill + feedback page CSS)

The current feedback page shows two cards (bug report and feature request) simultaneously. The new design shows a heading and two pill buttons. Clicking a pill reveals the corresponding form. On redirect back (after submit or error), the correct form auto-opens.

- [ ] **Step 1: Update `src/routes/feedback.js` to pass `autoOpen` and `from`**

Replace the entire file contents with:

```js
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { sendFeedbackNotification } = require('../email');

router.use(requireAuth);

router.get('/', (req, res) => {
  const submitted = req.query.submitted || null;
  const error = req.query.error || null;
  const autoOpen = submitted || req.query.from || null;
  res.render('feedback', { submitted, error, autoOpen });
});

router.post('/bug', async (req, res) => {
  const title = req.body.title?.trim();
  const description = req.body.description?.trim();
  const severity = ['low', 'medium', 'high'].includes(req.body.severity) ? req.body.severity : 'low';
  if (!title || !description) return res.redirect('/feedback?error=1&from=bug');
  if (title.length > 150) return res.redirect('/feedback?error=1&from=bug');
  if (description.length > 5000) return res.redirect('/feedback?error=1&from=bug');
  try {
    await pool.query(
      'INSERT INTO feedback (user_id, type, title, description, severity) VALUES (?, "bug", ?, ?, ?)',
      [req.session.user.id, title, description, severity]
    );
    const [[admin]] = await pool.query('SELECT email FROM users WHERE role = "admin" LIMIT 1');
    if (admin) {
      (async () => {
        await sendFeedbackNotification(admin.email, req.session.user.name, { type: 'bug', title, description, severity });
      })().catch(console.error);
    }
  } catch (err) {
    console.error(err);
    return res.redirect('/feedback?error=1&from=bug');
  }
  res.redirect('/feedback?submitted=bug');
});

router.post('/feature', async (req, res) => {
  const title = req.body.title?.trim();
  const description = req.body.description?.trim();
  if (!title || !description) return res.redirect('/feedback?error=1&from=feature');
  if (title.length > 150) return res.redirect('/feedback?error=1&from=feature');
  if (description.length > 5000) return res.redirect('/feedback?error=1&from=feature');
  try {
    await pool.query(
      'INSERT INTO feedback (user_id, type, title, description) VALUES (?, "feature", ?, ?)',
      [req.session.user.id, title, description]
    );
    const [[admin]] = await pool.query('SELECT email FROM users WHERE role = "admin" LIMIT 1');
    if (admin) {
      (async () => {
        await sendFeedbackNotification(admin.email, req.session.user.name, { type: 'feature', title, description, severity: null });
      })().catch(console.error);
    }
  } catch (err) {
    console.error(err);
    return res.redirect('/feedback?error=1&from=feature');
  }
  res.redirect('/feedback?submitted=feature');
});

module.exports = router;
```

- [ ] **Step 2: Add feedback page CSS to `src/public/css/theme.css`**

Append to the end of `src/public/css/theme.css`:

```css
/* ── Feedback page ─────────────────────────────────────────── */
.fn-feedback-page {
  max-width: 36rem;
  margin: 0 auto;
  padding: 2rem 1rem 4rem;
}

.fn-feedback-title {
  font-family: 'Playfair Display', Georgia, serif;
  font-size: 1.6rem;
  font-weight: 700;
  color: #2c1810;
  margin-bottom: 0.25rem;
}

.fn-feedback-subtitle {
  font-family: 'Crimson Pro', Georgia, serif;
  font-size: 1rem;
  color: #8b7355;
  margin-bottom: 1.75rem;
}

.fn-feedback-pills {
  display: flex;
  gap: 0.75rem;
  margin-bottom: 1.75rem;
  flex-wrap: wrap;
}

.fn-feedback-pill {
  font-family: 'Crimson Pro', Georgia, serif;
  font-size: 1rem;
  font-weight: 600;
  color: #6b5442;
  background: transparent;
  border: 1.5px solid rgba(139, 115, 85, 0.4);
  border-radius: 2rem;
  padding: 0.45rem 1.1rem;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.fn-feedback-pill:hover {
  background: rgba(44, 24, 16, 0.05);
  border-color: rgba(139, 115, 85, 0.7);
  color: #2c1810;
}

.fn-feedback-pill--active {
  background: #2c1810;
  color: #f5e5d0;
  border-color: #2c1810;
}

.fn-feedback-pill--active:hover {
  background: #4a2818;
  border-color: #4a2818;
  color: #fff;
}

.fn-feedback-form-wrap {
  overflow: hidden;
  max-height: 0;
  opacity: 0;
  transition: max-height 0.35s ease, opacity 0.25s ease;
}

.fn-feedback-form-wrap--open {
  max-height: 900px;
  opacity: 1;
}

.fn-feedback-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding-top: 0.25rem;
}

.fn-feedback-severity {
  display: flex;
  gap: 1.5rem;
  font-family: 'Crimson Pro', Georgia, serif;
  font-size: 0.95rem;
  color: #6b5442;
}

.fn-feedback-severity label {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  cursor: pointer;
}

.dark .fn-feedback-title { color: #f5e5d0; }
.dark .fn-feedback-subtitle { color: #7a6040; }
.dark .fn-feedback-pill { color: #9a7e5a; border-color: rgba(154, 126, 90, 0.35); }
.dark .fn-feedback-pill:hover { background: rgba(245, 229, 208, 0.06); border-color: rgba(154, 126, 90, 0.6); color: #f5e5d0; }
.dark .fn-feedback-pill--active { background: #f5e5d0; color: #2c1810; border-color: #f5e5d0; }
.dark .fn-feedback-pill--active:hover { background: #fff; border-color: #fff; }
.dark .fn-feedback-severity { color: #9a7e5a; }
```

- [ ] **Step 3: Rewrite `src/views/feedback.ejs`**

Replace the entire file with:

```ejs
<%- include('partials/head', { title: 'Feedback' }) %>
<%- include('partials/nav') %>

<div class="fn-feedback-page">
  <h1 class="fn-feedback-title">What's on your mind?</h1>
  <p class="fn-feedback-subtitle">Let us know what you're thinking.</p>

  <% if (error) { %>
  <div class="fn-flash-error">Please fill in all required fields.</div>
  <% } %>

  <div class="fn-feedback-pills">
    <button type="button" class="fn-feedback-pill" id="pill-bug">
      🐛 Report a bug
    </button>
    <button type="button" class="fn-feedback-pill" id="pill-feature">
      💡 Share feedback
    </button>
  </div>

  <div class="fn-feedback-form-wrap" id="form-bug">
    <% if (submitted === 'bug') { %>
    <div class="fn-flash-success" style="margin-bottom:1rem;">Thanks! Your bug report has been sent.</div>
    <% } %>
    <form method="POST" action="/feedback/bug" class="fn-feedback-form">
      <div class="fn-field">
        <label class="fn-label" for="bug-title">Bug title</label>
        <input class="fn-input" id="bug-title" type="text" name="title" required maxlength="150"
          placeholder="Short summary of the problem" autocomplete="off">
      </div>
      <div class="fn-field">
        <label class="fn-label">Severity</label>
        <div class="fn-feedback-severity">
          <label><input type="radio" name="severity" value="low" checked> Low</label>
          <label><input type="radio" name="severity" value="medium"> Medium</label>
          <label><input type="radio" name="severity" value="high"> High</label>
        </div>
      </div>
      <div class="fn-field">
        <label class="fn-label" for="bug-desc">Description</label>
        <textarea class="fn-input" id="bug-desc" name="description" required rows="4"
          placeholder="What happened? What did you expect to happen?" style="resize:vertical;"></textarea>
      </div>
      <div>
        <button type="submit" class="fn-btn">Send bug report</button>
      </div>
    </form>
  </div>

  <div class="fn-feedback-form-wrap" id="form-feature">
    <% if (submitted === 'feature') { %>
    <div class="fn-flash-success" style="margin-bottom:1rem;">Thanks! Your request has been submitted.</div>
    <% } %>
    <form method="POST" action="/feedback/feature" class="fn-feedback-form">
      <div class="fn-field">
        <label class="fn-label" for="feature-title">What would you like?</label>
        <input class="fn-input" id="feature-title" type="text" name="title" required maxlength="150"
          placeholder="Short title for your request" autocomplete="off">
      </div>
      <div class="fn-field">
        <label class="fn-label" for="feature-desc">Description</label>
        <textarea class="fn-input" id="feature-desc" name="description" required rows="4"
          placeholder="Describe the change or addition you'd like to see." style="resize:vertical;"></textarea>
      </div>
      <div>
        <button type="submit" class="fn-btn">Submit request</button>
      </div>
    </form>
  </div>
</div>

<script>
(function () {
  var pills = {
    bug: document.getElementById('pill-bug'),
    feature: document.getElementById('pill-feature')
  };
  var forms = {
    bug: document.getElementById('form-bug'),
    feature: document.getElementById('form-feature')
  };

  function showForm(type) {
    Object.keys(pills).forEach(function (k) {
      pills[k].classList.toggle('fn-feedback-pill--active', k === type);
    });
    Object.keys(forms).forEach(function (k) {
      forms[k].classList.toggle('fn-feedback-form-wrap--open', k === type);
    });
  }

  pills.bug.addEventListener('click', function () { showForm('bug'); });
  pills.feature.addEventListener('click', function () { showForm('feature'); });

  <% if (autoOpen) { %>
  showForm('<%= autoOpen %>');
  <% } %>
}());
</script>

<script src="/js/app.js"></script>
</body></html>
```

- [ ] **Step 4: Manual smoke test**

Visit `/feedback`. Confirm:
1. Page shows heading + two pill buttons, no forms visible.
2. Click "🐛 Report a bug" → bug pill becomes active (filled), bug form smoothly reveals.
3. Click "💡 Share feedback" → feature pill becomes active, feature form reveals, bug form hides.
4. Submit the bug form with empty fields → redirects back to `/feedback?error=1&from=bug` → error banner shows, bug pill is active and form is open.
5. Submit a real bug report → redirects to `/feedback?submitted=bug` → bug form shows success message.
6. Check dark mode — pills and form look correct.

- [ ] **Step 5: Commit**

```bash
git add src/views/feedback.ejs src/routes/feedback.js src/public/css/theme.css
git commit -m "feat: redesign feedback page with conversational pill-selector UX"
```

---

## Final step: push and deploy

- [ ] **Push to GitHub (triggers auto-deploy on Pi)**

```bash
git push
```

Expected: GitHub Actions builds the arm64 Docker image and the self-hosted Pi runner pulls and restarts the container. No manual step needed.

- [ ] **Smoke test the deployed site**

1. On desktop: nav bar shows only icons (search, notifications, dark toggle, hamburger)
2. Hamburger drawer: "Feedback" appears in Account section under What's New
3. Settings page: toggling any notification preference does not scroll to top; preference persists on refresh
4. Feedback page: pill UX works end-to-end including success/error redirect states
