# Settings Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `/profile` with a redesigned `/settings` page and restructure the hamburger drawer with primary/secondary navigation tiers.

**Architecture:** New `src/routes/settings.js` (copy of profile.js with redirects pointing to /settings), new `src/views/settings.ejs` (three-section card layout with inline edit UX and auto-save toggles), profile.js reduced to a single 301 redirect, nav.ejs drawer restructured to two-tier link hierarchy with section labels. All CSS additions appended to `src/public/css/theme.css`.

**Tech Stack:** Node.js/Express, EJS, MySQL, vanilla JS, CSS

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Modify | `src/public/css/theme.css` | Add drawer tier styles + full settings page CSS |
| Create | `src/routes/settings.js` | All settings handlers (copy of profile.js, redirects → /settings) |
| Modify | `src/routes/profile.js` | Replace with single 301 redirect to /settings |
| Modify | `src/app.js` | Register /settings route |
| Modify | `src/views/partials/nav.ejs` | Drawer restructure |
| Create | `src/views/settings.ejs` | New settings page view |

---

### Task 1: CSS — Drawer tier styles and settings page styles

**Files:**
- Modify: `src/public/css/theme.css`

This task appends two new blocks to theme.css: drawer tier classes after the existing drawer dark-mode section (~line 595), and settings page classes after the existing `.dark .fn-meta-val` line (~line 337). Both are pure additions — no existing CSS is changed.

- [ ] **Step 1: Read the current end of the drawer dark-mode section**

  Run: `grep -n "fn-drawer-sep" src/public/css/theme.css`
  Expected: line near 595 showing `.dark .fn-drawer-sep { background: ... }`

- [ ] **Step 2: Append drawer tier CSS after `.dark .fn-drawer-sep` block**

  In `src/public/css/theme.css`, after the `.dark .fn-drawer-sep` block, add:

  ```css
  /* Drawer — primary/secondary tiers */
  .fn-drawer-section-label {
    font-size: 0.65rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #b5a090;
    padding: 0.75rem 1.25rem 0.25rem;
    display: block;
  }
  .dark .fn-drawer-section-label { color: #7a6040; }

  .fn-drawer-link--primary {
    font-size: 1.05rem;
    padding: 0.85rem 1.25rem;
  }

  .fn-drawer-link--secondary {
    font-size: 0.875rem;
    color: #8b7355;
    padding: 0.6rem 1.25rem;
  }
  .fn-drawer-link--secondary:hover { color: #2c1810; }
  .dark .fn-drawer-link--secondary { color: #6b5030; }
  .dark .fn-drawer-link--secondary:hover { color: #f5e5d0; }

  .fn-drawer-footer-btn {
    display: block;
    width: calc(100% - 2rem);
    margin: 0.5rem 1rem;
    padding: 0.75rem 1rem;
    text-align: center;
    font-family: 'Crimson Pro', Georgia, serif;
    font-size: 0.95rem;
    color: #b9503c;
    background: none;
    border: 1px solid rgba(185, 80, 60, 0.35);
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
    text-decoration: none;
  }
  .fn-drawer-footer-btn:hover { background: rgba(185, 80, 60, 0.06); border-color: rgba(185, 80, 60, 0.6); }
  .dark .fn-drawer-footer-btn { color: #e08878; border-color: rgba(224, 136, 120, 0.3); }
  .dark .fn-drawer-footer-btn:hover { background: rgba(224, 136, 120, 0.07); border-color: rgba(224, 136, 120, 0.6); }
  ```

- [ ] **Step 3: Find line for settings CSS insertion**

  Run: `grep -n "fn-meta-val" src/public/css/theme.css`
  Expected: two lines — the rule and the dark variant (~lines 334, 337). Note the line of `.dark .fn-meta-val`.

- [ ] **Step 4: Append settings page CSS after `.dark .fn-meta-val` block**

  In `src/public/css/theme.css`, after `.dark .fn-meta-val { color: #f5e5d0; }`, add:

  ```css
  /* Settings page — section header */
  .fn-settings-section-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0 0 1rem;
    padding-bottom: 0.75rem;
    border-bottom: 1px solid rgba(139, 115, 85, 0.12);
  }
  .fn-settings-section-header svg { color: #8b7355; flex-shrink: 0; }
  .dark .fn-settings-section-header { border-bottom-color: rgba(154, 126, 90, 0.15); }
  .dark .fn-settings-section-header svg { color: #7a6040; }

  .fn-settings-section-label {
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #8b7355;
  }
  .dark .fn-settings-section-label { color: #7a6040; }

  /* Settings page — rows */
  .fn-settings-row-wrap { position: relative; }

  .fn-settings-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 0;
    border-bottom: 1px solid rgba(139, 115, 85, 0.1);
    transition: opacity 0.15s;
  }
  .fn-settings-row:last-of-type { border-bottom: none; }
  .fn-settings-row-wrap--editing .fn-settings-row { opacity: 0.45; pointer-events: none; }

  .fn-settings-row-label {
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #8b7355;
    width: 5.5rem;
    flex-shrink: 0;
  }
  .dark .fn-settings-row-label { color: #7a6040; }

  .fn-settings-row-value {
    flex: 1;
    font-family: 'Crimson Pro', Georgia, serif;
    font-size: 1rem;
    color: #4a3825;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dark .fn-settings-row-value { color: #c8a880; }

  .fn-settings-row-edit {
    font-size: 0.78rem;
    color: #8b5e3c;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0.2rem 0.5rem;
    border-radius: 4px;
    transition: background 0.15s, color 0.15s;
    flex-shrink: 0;
    font-family: inherit;
    white-space: nowrap;
  }
  .fn-settings-row-edit:hover { background: rgba(139, 94, 60, 0.1); color: #6b3c1e; }
  .dark .fn-settings-row-edit { color: #c4895a; }
  .dark .fn-settings-row-edit:hover { background: rgba(196, 137, 90, 0.12); color: #e0a870; }

  .fn-row-form {
    display: none;
    padding: 0.75rem 0 0.25rem;
    border-bottom: 1px solid rgba(139, 115, 85, 0.1);
  }
  .fn-settings-row-wrap--editing .fn-row-form { display: block; }
  .fn-row-form-actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.75rem;
    flex-wrap: wrap;
  }

  /* Settings page — pill toggle switch */
  .fn-toggle {
    position: relative;
    display: inline-block;
    width: 44px;
    height: 24px;
    flex-shrink: 0;
  }
  .fn-toggle input { opacity: 0; width: 0; height: 0; position: absolute; }
  .fn-toggle-slider {
    position: absolute;
    inset: 0;
    background: rgba(139, 115, 85, 0.25);
    border-radius: 9999px;
    cursor: pointer;
    transition: background 0.2s;
  }
  .fn-toggle-slider::before {
    content: '';
    position: absolute;
    width: 18px;
    height: 18px;
    left: 3px;
    top: 3px;
    background: white;
    border-radius: 50%;
    transition: transform 0.2s;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  }
  .fn-toggle input:checked + .fn-toggle-slider { background: #8b5e3c; }
  .fn-toggle input:checked + .fn-toggle-slider::before { transform: translateX(20px); }
  .fn-toggle input:disabled + .fn-toggle-slider { opacity: 0.45; cursor: not-allowed; }
  .dark .fn-toggle-slider { background: rgba(154, 126, 90, 0.3); }
  .dark .fn-toggle input:checked + .fn-toggle-slider { background: #c4895a; }

  /* Settings page — toggle row layout */
  .fn-toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 0;
    border-bottom: 1px solid rgba(139, 115, 85, 0.1);
  }
  .fn-toggle-row:last-child { border-bottom: none; }
  .fn-toggle-row-label {
    font-family: 'Crimson Pro', Georgia, serif;
    font-size: 1rem;
    color: #4a3825;
  }
  .dark .fn-toggle-row-label { color: #c8a880; }
  .fn-toggle-row-sub {
    font-size: 0.78rem;
    color: #8b7355;
    margin-top: 0.1rem;
  }
  .dark .fn-toggle-row-sub { color: #7a6040; }

  /* Settings page — avatar row */
  .fn-settings-avatar-row {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.5rem 0 0.75rem;
    cursor: pointer;
    border-bottom: 1px solid rgba(139, 115, 85, 0.1);
  }
  .fn-settings-avatar-circle {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    overflow: hidden;
    flex-shrink: 0;
    background: #f5e8d5;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.25rem;
    font-weight: 700;
    color: #8b5e3c;
    border: 2px solid rgba(139, 94, 60, 0.18);
  }
  .dark .fn-settings-avatar-circle { background: #3a2415; color: #c4895a; border-color: rgba(196, 137, 90, 0.2); }
  .fn-settings-avatar-label {
    font-family: 'Crimson Pro', Georgia, serif;
    font-size: 1rem;
    color: #4a3825;
  }
  .dark .fn-settings-avatar-label { color: #c8a880; }
  .fn-settings-avatar-sub {
    font-size: 0.75rem;
    color: #8b7355;
    margin-top: 0.1rem;
  }
  .dark .fn-settings-avatar-sub { color: #7a6040; }
  .fn-settings-avatar-remove {
    font-size: 0.75rem;
    color: #b9503c;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    font-family: inherit;
    text-decoration: underline;
    margin-top: 0.2rem;
    display: block;
  }
  .fn-settings-avatar-remove:hover { color: #8b3020; }
  .dark .fn-settings-avatar-remove { color: #e08878; }

  /* Settings page — feedback footer link */
  .fn-settings-feedback-link {
    display: block;
    text-align: center;
    font-family: 'Crimson Pro', Georgia, serif;
    font-size: 0.9rem;
    color: #8b7355;
    text-decoration: none;
    margin-top: 1.25rem;
    padding: 0.5rem;
    transition: color 0.15s;
  }
  .fn-settings-feedback-link:hover { color: #4a3825; }
  .dark .fn-settings-feedback-link { color: #7a6040; }
  .dark .fn-settings-feedback-link:hover { color: #c8a880; }
  ```

- [ ] **Step 5: Verify CSS was written correctly**

  Run: `grep -n "fn-drawer-footer-btn\|fn-settings-section-label\|fn-toggle-slider\|fn-settings-feedback-link" src/public/css/theme.css`
  Expected: all four class names appear in the file

- [ ] **Step 6: Commit**

  ```bash
  cd /home/jmull/projects/family-news
  git add src/public/css/theme.css
  git commit -m "style: add drawer tier and settings page CSS classes"
  ```

---

### Task 2: Create src/routes/settings.js

**Files:**
- Create: `src/routes/settings.js`

This is a copy of `src/routes/profile.js` with three changes:
1. All `res.redirect('/profile')` calls become `res.redirect('/settings')`
2. `res.render('profile')` becomes `res.render('settings')`
3. The `push-prefs` handler redirects to `/settings` instead of `/profile`

- [ ] **Step 1: Read src/routes/profile.js to confirm current redirect targets**

  Run: `grep -n "redirect\|render" src/routes/profile.js`
  Expected: ~10 lines, all redirecting to '/profile', one render of 'profile'

- [ ] **Step 2: Create src/routes/settings.js**

  Create `src/routes/settings.js` with the following content (identical to profile.js except redirects and render target):

  ```js
  const express = require('express');
  const router = express.Router();
  const bcrypt = require('bcrypt');
  const { pool } = require('../db');
  const { requireAuth } = require('../middleware/auth');
  const { handleAvatarUpload, deleteUploadedFile } = require('./upload');

  router.use(requireAuth);

  router.get('/', (req, res) => {
    res.render('settings');
  });

  router.post('/name', async (req, res) => {
    const { name } = req.body;
    if (!name?.trim()) { req.flash('error', 'Name is required.'); return res.redirect('/settings'); }
    try {
      await pool.query('UPDATE users SET name = ? WHERE id = ?', [name.trim(), req.session.user.id]);
      req.session.user.name = name.trim();
      req.flash('success', 'Name updated.');
    } catch (err) { console.error(err); req.flash('error', 'Could not update name.'); }
    res.redirect('/settings');
  });

  router.post('/email', async (req, res) => {
    const { email, password } = req.body;
    if (!email?.trim()) { req.flash('error', 'Email is required.'); return res.redirect('/settings'); }
    try {
      const [rows] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [req.session.user.id]);
      if (!await bcrypt.compare(password, rows[0].password_hash)) {
        req.flash('error', 'Current password is incorrect.');
        return res.redirect('/settings');
      }
      await pool.query('UPDATE users SET email = ? WHERE id = ?', [email.trim().toLowerCase(), req.session.user.id]);
      req.session.user.email = email.trim().toLowerCase();
      req.flash('success', 'Email updated.');
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        req.flash('error', 'That email is already in use.');
        return res.redirect('/settings');
      }
      console.error(err);
      req.flash('error', 'Could not update email.');
    }
    res.redirect('/settings');
  });

  router.post('/password', async (req, res) => {
    const { current_password, new_password } = req.body;
    if (!new_password || new_password.length < 8) {
      req.flash('error', 'New password must be at least 8 characters.');
      return res.redirect('/settings');
    }
    try {
      const [rows] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [req.session.user.id]);
      if (!await bcrypt.compare(current_password, rows[0].password_hash)) {
        req.flash('error', 'Current password is incorrect.');
        return res.redirect('/settings');
      }
      const hash = await bcrypt.hash(new_password, 12);
      await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.session.user.id]);
      req.flash('success', 'Password changed successfully.');
    } catch (err) { console.error(err); req.flash('error', 'Could not update password.'); }
    res.redirect('/settings');
  });

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
    }
    res.redirect('/settings');
  });

  router.post('/avatar', handleAvatarUpload, async (req, res) => {
    if (req.uploadError) { req.flash('error', req.uploadError); return res.redirect('/settings'); }
    if (!req.uploadedPath) { req.flash('error', 'No image received.'); return res.redirect('/settings'); }
    try {
      if (req.session.user.avatar_url) deleteUploadedFile(req.session.user.avatar_url);
      await pool.query('UPDATE users SET avatar_url = ? WHERE id = ?', [req.uploadedPath, req.session.user.id]);
      req.session.user.avatar_url = req.uploadedPath;
      req.flash('success', 'Profile photo updated.');
    } catch (err) { console.error(err); req.flash('error', 'Could not save photo.'); }
    res.redirect('/settings');
  });

  router.post('/avatar/remove', async (req, res) => {
    try {
      if (req.session.user.avatar_url) deleteUploadedFile(req.session.user.avatar_url);
      await pool.query('UPDATE users SET avatar_url = NULL WHERE id = ?', [req.session.user.id]);
      req.session.user.avatar_url = null;
      req.flash('success', 'Profile photo removed.');
    } catch (err) { console.error(err); req.flash('error', 'Could not remove photo.'); }
    res.redirect('/settings');
  });

  router.post('/birthday', async (req, res) => {
    const { birthday_month, birthday_day, birthday_year } = req.body;
    if (!birthday_month || !birthday_day || !birthday_year) { req.flash('error', 'Birthday is required.'); return res.redirect('/settings'); }
    const birthday = `${birthday_year}-${birthday_month}-${birthday_day}`;
    const date = new Date(birthday);
    if (isNaN(date.getTime()) || date >= new Date()) {
      req.flash('error', 'Please enter a valid birthday.');
      return res.redirect('/settings');
    }
    try {
      await pool.query('UPDATE users SET birthday = ? WHERE id = ?', [birthday, req.session.user.id]);
      req.session.user.birthday = birthday;
      req.flash('success', 'Birthday updated.');
    } catch (err) { console.error(err); req.flash('error', 'Could not update birthday.'); }
    res.redirect('/settings');
  });

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
    }
    res.redirect('/settings');
  });

  module.exports = router;
  ```

  Note: The `/notifications` and `/push-prefs` handlers do NOT call `req.flash('success', ...)` — these routes are called by auto-save toggles and silent saves; a flash message on every toggle would be distracting.

- [ ] **Step 3: Verify the file was created**

  Run: `grep -c "redirect('/settings')" src/routes/settings.js`
  Expected: 14 or more (every error and success redirect)

- [ ] **Step 4: Commit**

  ```bash
  git add src/routes/settings.js
  git commit -m "feat: add settings route (copy of profile handlers, all paths -> /settings)"
  ```

---

### Task 3: Register /settings in app.js, redirect /profile

**Files:**
- Modify: `src/app.js`
- Modify: `src/routes/profile.js`

- [ ] **Step 1: Register /settings route in app.js**

  In `src/app.js`, find the line:
  ```js
  app.use('/profile', require('./routes/profile'));
  ```
  Add the settings route immediately after it:
  ```js
  app.use('/profile', require('./routes/profile'));
  app.use('/settings', require('./routes/settings'));
  ```

- [ ] **Step 2: Simplify profile.js to a single redirect**

  Replace the entire content of `src/routes/profile.js` with:

  ```js
  const express = require('express');
  const router = express.Router();

  router.get('*', (req, res) => res.redirect(301, '/settings'));

  module.exports = router;
  ```

  This catches all GET requests to /profile/* and redirects. Old POST bookmarks don't exist so only GET needs handling.

- [ ] **Step 3: Verify app.js change**

  Run: `grep -A1 "routes/profile" src/app.js`
  Expected: shows the profile line immediately followed by the settings line

- [ ] **Step 4: Verify profile.js change**

  Run: `node -e "const r = require('./src/routes/profile'); console.log('ok')"`
  Run from: `/home/jmull/projects/family-news`
  Expected: prints `ok` (no syntax errors)

- [ ] **Step 5: Verify settings.js loads**

  Run: `node -e "const r = require('./src/routes/settings'); console.log('ok')"`
  Run from: `/home/jmull/projects/family-news`
  Expected: prints `ok` (no syntax errors)

- [ ] **Step 6: Commit**

  ```bash
  git add src/app.js src/routes/profile.js
  git commit -m "feat: register /settings route, reduce /profile to 301 redirect"
  ```

---

### Task 4: Restructure nav.ejs drawer

**Files:**
- Modify: `src/views/partials/nav.ejs`

Replace the `<nav class="fn-drawer-nav">` block and the `<div class="fn-drawer-footer">` block with the new two-tier structure. The header, overlay, open/close JS, and active-link script are unchanged.

Current drawer nav (lines 258–277 approx):
```html
<nav class="fn-drawer-nav">
  <a href="/" class="fn-drawer-link">Feed</a>
  <a href="/search" class="fn-drawer-link">Search</a>
  ...
</nav>
<div class="fn-drawer-footer">
  <a href="/logout" class="fn-drawer-link fn-drawer-link--danger">Sign out</a>
</div>
```

Replace with:

```html
<nav class="fn-drawer-nav">
  <a href="/" class="fn-drawer-link fn-drawer-link--primary">Feed</a>
  <a href="/search" class="fn-drawer-link fn-drawer-link--primary">Search</a>
  <a href="/photos" class="fn-drawer-link fn-drawer-link--primary">Photos</a>
  <a href="/notifications" class="fn-drawer-link fn-drawer-link--primary">Notifications<% if (showNotificationDot) { %><span class="notif-dot" aria-hidden="true"></span><% } %></a>

  <span class="fn-drawer-section-label">Account</span>
  <a href="/settings" class="fn-drawer-link fn-drawer-link--secondary">Settings</a>
  <a href="/whats-new" class="fn-drawer-link fn-drawer-link--secondary">What's New</a>

  <% if (user.role === 'admin' || user.role === 'moderator') { %>
    <span class="fn-drawer-section-label">Admin</span>
    <% if (user.role === 'admin') { %>
      <a href="/admin" class="fn-drawer-link fn-drawer-link--secondary">Admin</a>
    <% } %>
    <a href="/mod" class="fn-drawer-link fn-drawer-link--secondary">Mod</a>
    <a href="/guide" class="fn-drawer-link fn-drawer-link--secondary">Guide</a>
  <% } %>
</nav>
<div class="fn-drawer-footer">
  <a href="/logout" class="fn-drawer-footer-btn">Sign out</a>
</div>
```

- [ ] **Step 1: Make the drawer nav replacement**

  In `src/views/partials/nav.ejs`, find the exact block:
  ```
      <a href="/" class="fn-drawer-link">Feed</a>
  ```
  Replace from that line through the closing `</div>` of `fn-drawer-footer` with the new structure above.

- [ ] **Step 2: Verify active-link script still works**

  The active-link script at the bottom of nav.ejs uses `drawer.querySelectorAll('.fn-drawer-link')`. Since primary and secondary links all have `fn-drawer-link` class, this still works.

  Run: `grep -A5 "Highlight the drawer" src/views/partials/nav.ejs`
  Expected: script still queries `.fn-drawer-link`, unchanged.

- [ ] **Step 3: Verify no Profile or Feedback links remain in drawer**

  Run: `grep -i "profile\|feedback" src/views/partials/nav.ejs`
  Expected: no results (these have been removed from the drawer)

- [ ] **Step 4: Commit**

  ```bash
  git add src/views/partials/nav.ejs
  git commit -m "feat: restructure drawer with primary/secondary link tiers and section labels"
  ```

---

### Task 5: Create src/views/settings.ejs

**Files:**
- Create: `src/views/settings.ejs`

Three card sections: Profile (avatar, name, birthday), Account (email, password, role), Notifications (email toggles, push toggle). Each editable row uses inline edit UX with `.fn-settings-row-wrap` + `.fn-row-form`. Email notification toggles auto-save on change. Push toggle bridges to the existing push state machine via MutationObserver.

- [ ] **Step 1: Create src/views/settings.ejs**

  ```html
  <%- include('partials/head', { title: 'Settings' }) %>
  <%- include('partials/nav') %>

  <div class="fn-settings-page">
    <h1 class="fn-settings-title">Settings</h1>

    <% if (flash.error) { %><div class="fn-flash-error"><%= flash.error %></div><% } %>
    <% if (flash.success) { %><div class="fn-flash-success"><%= flash.success %></div><% } %>

    <%# ── Section 1: Profile ── %>
    <div class="fn-settings-card">
      <div class="fn-settings-section-header">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
        <span class="fn-settings-section-label">Profile</span>
      </div>

      <%# Avatar row %>
      <div>
        <div class="fn-settings-avatar-row" id="avatar-row">
          <div class="fn-settings-avatar-circle" id="avatar-preview">
            <% if (user.avatar_url) { %>
              <img src="<%= user.avatar_url %>" style="width:100%;height:100%;object-fit:cover;" alt="" id="avatar-img">
            <% } else { %>
              <%= user.name.charAt(0).toUpperCase() %>
            <% } %>
          </div>
          <div>
            <div class="fn-settings-avatar-label" id="avatar-change-label">Change photo</div>
            <div class="fn-settings-avatar-sub">JPG or PNG, up to 5 MB</div>
            <% if (user.avatar_url) { %>
              <button type="button" class="fn-settings-avatar-remove" id="avatar-remove-btn" onclick="event.stopPropagation()">Remove</button>
            <% } %>
          </div>
          <input type="file" id="avatar-file-input" accept="image/*" style="display:none;">
        </div>
        <div id="avatar-pending-actions" style="display:none;padding:0.5rem 0;border-bottom:1px solid rgba(139,115,85,0.1);">
          <div class="fn-row-form-actions">
            <button type="button" class="fn-btn" id="avatar-save-btn">Save photo</button>
            <button type="button" class="fn-btn-ghost" id="avatar-cancel-btn">Cancel</button>
          </div>
        </div>
      </div>

      <%# Display name row %>
      <div class="fn-settings-row-wrap" id="wrap-name">
        <div class="fn-settings-row">
          <span class="fn-settings-row-label">Name</span>
          <span class="fn-settings-row-value" id="val-name"><%= user.name %></span>
          <button class="fn-settings-row-edit" data-edit-row="wrap-name">Edit</button>
        </div>
        <div class="fn-row-form">
          <form method="POST" action="/settings/name">
            <div class="fn-field">
              <label class="fn-label" for="s-name">Display name</label>
              <input class="fn-input" type="text" id="s-name" name="name" value="<%= user.name %>" required autocomplete="name">
            </div>
            <div class="fn-row-form-actions">
              <button type="submit" class="fn-btn">Save</button>
              <button type="button" class="fn-btn-ghost" data-cancel-row="wrap-name">Cancel</button>
            </div>
          </form>
        </div>
      </div>

      <%# Birthday row %>
      <%
        const _months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
        const _bdVal = user.birthday || '';
        const _bdM = _bdVal ? _bdVal.slice(5,7) : '';
        const _bdD = _bdVal ? _bdVal.slice(8,10) : '';
        const _bdY = _bdVal ? _bdVal.slice(0,4) : '';
        let _bdDisplay = 'Not set';
        if (_bdVal) {
          const _mi = parseInt(_bdM, 10) - 1;
          _bdDisplay = _months[_mi] + ' ' + parseInt(_bdD, 10) + ', ' + _bdY;
        }
        const _bdNow = new Date().getFullYear();
      %>
      <div class="fn-settings-row-wrap" id="wrap-birthday">
        <div class="fn-settings-row">
          <span class="fn-settings-row-label">Birthday</span>
          <span class="fn-settings-row-value"><%= _bdDisplay %></span>
          <button class="fn-settings-row-edit" data-edit-row="wrap-birthday"><%= _bdVal ? 'Edit' : 'Add' %></button>
        </div>
        <div class="fn-row-form">
          <form method="POST" action="/settings/birthday">
            <div class="fn-field">
              <label class="fn-label">Birthday</label>
              <div style="display:flex;gap:0.5rem;">
                <select name="birthday_month" class="fn-select" style="flex:1.5;width:auto;min-width:0;" required>
                  <option value="" disabled <%= !_bdM ? 'selected' : '' %>>Month</option>
                  <% _months.forEach(function(m, i) { const v = ('0'+(i+1)).slice(-2); %>
                  <option value="<%= v %>" <%= _bdM === v ? 'selected' : '' %>><%= m %></option>
                  <% }); %>
                </select>
                <select name="birthday_day" class="fn-select" style="flex:0.8;width:auto;min-width:0;" required>
                  <option value="" disabled <%= !_bdD ? 'selected' : '' %>>Day</option>
                  <% for (let _d = 1; _d <= 31; _d++) { const v = ('0'+_d).slice(-2); %>
                  <option value="<%= v %>" <%= _bdD === v ? 'selected' : '' %>><%= _d %></option>
                  <% } %>
                </select>
                <select name="birthday_year" class="fn-select" style="flex:1;width:auto;min-width:0;" required>
                  <option value="" disabled <%= !_bdY ? 'selected' : '' %>>Year</option>
                  <% for (let _y = _bdNow; _y >= 1920; _y--) { %>
                  <option value="<%= _y %>" <%= _bdY === String(_y) ? 'selected' : '' %>><%= _y %></option>
                  <% } %>
                </select>
              </div>
            </div>
            <div class="fn-row-form-actions">
              <button type="submit" class="fn-btn">Save</button>
              <button type="button" class="fn-btn-ghost" data-cancel-row="wrap-birthday">Cancel</button>
            </div>
          </form>
        </div>
      </div>
    </div>

    <%# ── Section 2: Account ── %>
    <div class="fn-settings-card">
      <div class="fn-settings-section-header">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        <span class="fn-settings-section-label">Account</span>
      </div>

      <%# Email row %>
      <%
        const _ep = user.email.indexOf('@');
        const _maskedEmail = user.email.slice(0, Math.min(2, _ep)) + '•••' + user.email.slice(_ep);
      %>
      <div class="fn-settings-row-wrap" id="wrap-email">
        <div class="fn-settings-row">
          <span class="fn-settings-row-label">Email</span>
          <span class="fn-settings-row-value"><%= _maskedEmail %></span>
          <button class="fn-settings-row-edit" data-edit-row="wrap-email">Change</button>
        </div>
        <div class="fn-row-form">
          <form method="POST" action="/settings/email">
            <div class="fn-field">
              <label class="fn-label" for="s-email">New email</label>
              <input class="fn-input" type="email" id="s-email" name="email" value="<%= user.email %>" required autocomplete="email">
            </div>
            <div class="fn-field">
              <label class="fn-label" for="s-email-pw">Current password</label>
              <input class="fn-input" type="password" id="s-email-pw" name="password" required autocomplete="current-password">
            </div>
            <div class="fn-row-form-actions">
              <button type="submit" class="fn-btn">Save</button>
              <button type="button" class="fn-btn-ghost" data-cancel-row="wrap-email">Cancel</button>
            </div>
          </form>
        </div>
      </div>

      <%# Password row %>
      <div class="fn-settings-row-wrap" id="wrap-password">
        <div class="fn-settings-row">
          <span class="fn-settings-row-label">Password</span>
          <span class="fn-settings-row-value">••••••••</span>
          <button class="fn-settings-row-edit" data-edit-row="wrap-password">Change</button>
        </div>
        <div class="fn-row-form">
          <form method="POST" action="/settings/password">
            <div class="fn-field">
              <label class="fn-label" for="s-cur-pw">Current password</label>
              <input class="fn-input" type="password" id="s-cur-pw" name="current_password" required autocomplete="current-password">
            </div>
            <div class="fn-field">
              <label class="fn-label" for="s-new-pw">New password <span style="font-weight:400;letter-spacing:0;text-transform:none;opacity:0.7;">(min 8 characters)</span></label>
              <input class="fn-input" type="password" id="s-new-pw" name="new_password" required minlength="8" autocomplete="new-password">
            </div>
            <div class="fn-row-form-actions">
              <button type="submit" class="fn-btn">Save</button>
              <button type="button" class="fn-btn-ghost" data-cancel-row="wrap-password">Cancel</button>
            </div>
          </form>
        </div>
      </div>

      <%# Role row (read-only) %>
      <div class="fn-settings-row">
        <span class="fn-settings-row-label">Role</span>
        <span class="fn-settings-row-value" style="text-transform:capitalize;"><%= user.role %></span>
      </div>
    </div>

    <%# ── Section 3: Notifications ── %>
    <div class="fn-settings-card">
      <div class="fn-settings-section-header">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
        <span class="fn-settings-section-label">Notifications</span>
      </div>

      <%# New posts toggle — each toggle is its own form to avoid zeroing the other pref on submit %>
      <div class="fn-toggle-row">
        <div class="fn-toggle-row-label">New posts</div>
        <form method="POST" action="/settings/notifications" id="form-notify-posts">
          <input type="hidden" name="notify_comments" value="<%= user.notify_comments ? 1 : 0 %>">
          <label class="fn-toggle">
            <input type="checkbox" name="notify_posts" value="1" <%= user.notify_posts ? 'checked' : '' %> id="toggle-notify-posts">
            <span class="fn-toggle-slider"></span>
          </label>
        </form>
      </div>

      <%# Comments toggle %>
      <div class="fn-toggle-row">
        <div class="fn-toggle-row-label">Comments on my posts</div>
        <form method="POST" action="/settings/notifications" id="form-notify-comments">
          <input type="hidden" name="notify_posts" value="<%= user.notify_posts ? 1 : 0 %>">
          <label class="fn-toggle">
            <input type="checkbox" name="notify_comments" value="1" <%= user.notify_comments ? 'checked' : '' %> id="toggle-notify-comments">
            <span class="fn-toggle-slider"></span>
          </label>
        </form>
      </div>

      <%# Push notifications toggle row — bridged to existing push state machine via MutationObserver %>
      <div class="fn-toggle-row" id="push-toggle-row">
        <div>
          <div class="fn-toggle-row-label">Push notifications</div>
          <div class="fn-toggle-row-sub" id="push-toggle-status">Loading…</div>
        </div>
        <label class="fn-toggle">
          <input type="checkbox" id="push-settings-toggle" disabled>
          <span class="fn-toggle-slider"></span>
        </label>
      </div>

      <%# Push prefs sub-row (shown when push enabled) %>
      <div id="push-prefs-visible-row" style="display:none;padding:0.5rem 0;border-bottom:1px solid rgba(139,115,85,0.1);">
        <form method="POST" action="/settings/push-prefs" id="push-prefs-form">
          <label class="fn-checkbox-label" style="margin-bottom:0.5rem;">
            <input class="fn-checkbox" type="checkbox" name="push_notify_posts" value="1">
            <span>Posts</span>
          </label>
          <label class="fn-checkbox-label" style="margin-bottom:0.5rem;">
            <input class="fn-checkbox" type="checkbox" name="push_notify_comments" value="1">
            <span>Comments on my posts</span>
          </label>
          <label class="fn-checkbox-label" style="margin-bottom:0.75rem;">
            <input class="fn-checkbox" type="checkbox" name="push_notify_big_news" value="1">
            <span>Big News</span>
          </label>
          <button type="submit" class="fn-btn" style="font-size:0.85rem;padding:0.4rem 0.9rem;">Save push prefs</button>
        </form>
      </div>
    </div>

    <a href="/feedback" class="fn-settings-feedback-link">Send feedback to the admin</a>
  </div>

  <%# Hidden push state machine — app.js manages these IDs; kept in DOM for its logic but not displayed %>
  <div aria-hidden="true" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);">
    <div id="push-section"
      data-notify-posts="<%= user.push_notify_posts != null ? user.push_notify_posts : 1 %>"
      data-notify-comments="<%= user.push_notify_comments != null ? user.push_notify_comments : 1 %>"
      data-notify-big-news="<%= user.push_notify_big_news != null ? user.push_notify_big_news : 1 %>">
      <div id="push-state-default" class="hidden">
        <button id="push-enable-btn" type="button">Enable</button>
      </div>
      <div id="push-state-enabled" class="hidden">
        <button id="push-disable-btn" type="button">Disable</button>
        <form method="POST" action="/settings/push-prefs">
          <input type="checkbox" name="push_notify_posts" value="1">
          <input type="checkbox" name="push_notify_comments" value="1">
          <input type="checkbox" name="push_notify_big_news" value="1">
        </form>
      </div>
      <div id="push-state-denied" class="hidden">
        <p id="push-denied-instructions"></p>
      </div>
      <div id="push-ios-notice" class="hidden"></div>
      <div id="push-email-notice" class="hidden"></div>
    </div>
  </div>

  <%# Hidden avatar upload form (same pattern as profile.ejs) %>
  <form id="avatar-upload-form" method="POST" action="/settings/avatar" enctype="multipart/form-data" style="display:none;">
    <input type="file" name="avatar" id="avatar-upload-input">
  </form>
  <form id="avatar-remove-form" method="POST" action="/settings/avatar/remove" style="display:none;"></form>

  <script src="/js/app.js"></script>
  <script>
  (function () {
    // ── Inline edit rows ──────────────────────────────────────────────────────
    document.querySelectorAll('[data-edit-row]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.dataset.editRow;
        var wrap = document.getElementById(id);
        var isOpen = wrap.classList.contains('fn-settings-row-wrap--editing');
        document.querySelectorAll('.fn-settings-row-wrap--editing').forEach(function (w) {
          w.classList.remove('fn-settings-row-wrap--editing');
        });
        if (!isOpen) wrap.classList.add('fn-settings-row-wrap--editing');
      });
    });

    document.querySelectorAll('[data-cancel-row]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var wrap = document.getElementById(btn.dataset.cancelRow);
        wrap.classList.remove('fn-settings-row-wrap--editing');
      });
    });

    // ── Email notification auto-save toggles ──────────────────────────────────
    ['toggle-notify-posts', 'toggle-notify-comments'].forEach(function (id) {
      var t = document.getElementById(id);
      if (t) t.addEventListener('change', function () { t.closest('form').submit(); });
    });

    // ── Avatar ────────────────────────────────────────────────────────────────
    var avatarRow = document.getElementById('avatar-row');
    var avatarFileInput = document.getElementById('avatar-file-input');
    var avatarUploadInput = document.getElementById('avatar-upload-input');
    var avatarUploadForm = document.getElementById('avatar-upload-form');
    var avatarRemoveForm = document.getElementById('avatar-remove-form');
    var avatarPreview = document.getElementById('avatar-preview');
    var avatarPendingActions = document.getElementById('avatar-pending-actions');
    var avatarRemoveBtn = document.getElementById('avatar-remove-btn');
    var originalPreviewHtml = avatarPreview.innerHTML;
    var pendingFile = null;

    avatarRow.addEventListener('click', function () { avatarFileInput.click(); });
    if (avatarRemoveBtn) {
      avatarRemoveBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        avatarRemoveForm.submit();
      });
    }

    avatarFileInput.addEventListener('change', function (e) {
      var file = e.target.files[0];
      if (!file) return;
      pendingFile = file;
      var reader = new FileReader();
      reader.onload = function (ev) {
        avatarPreview.innerHTML = '<img src="' + ev.target.result + '" style="width:100%;height:100%;object-fit:cover;" alt="">';
        avatarPendingActions.style.display = 'block';
      };
      reader.readAsDataURL(file);
      avatarFileInput.value = '';
    });

    document.getElementById('avatar-save-btn').addEventListener('click', function () {
      if (!pendingFile) return;
      var dt = new DataTransfer();
      dt.items.add(pendingFile);
      avatarUploadInput.files = dt.files;
      avatarUploadForm.submit();
    });

    document.getElementById('avatar-cancel-btn').addEventListener('click', function () {
      avatarPreview.innerHTML = originalPreviewHtml;
      avatarPendingActions.style.display = 'none';
      pendingFile = null;
    });

    // ── Push toggle bridge ────────────────────────────────────────────────────
    // app.js shows/hides push state divs async after checking service worker state.
    // We observe those divs and sync a visible toggle accordingly.
    var pushToggle = document.getElementById('push-settings-toggle');
    var pushStatus = document.getElementById('push-toggle-status');
    var pushPrefsRow = document.getElementById('push-prefs-visible-row');
    var stateEnabled = document.getElementById('push-state-enabled');
    var stateDefault = document.getElementById('push-state-default');
    var stateDenied = document.getElementById('push-state-denied');
    var iosNotice = document.getElementById('push-ios-notice');

    function syncPushToggle() {
      var isEnabled = stateEnabled && stateEnabled.style.display !== '' && stateEnabled.style.display !== 'none';
      var isDenied = stateDenied && stateDenied.style.display !== '' && stateDenied.style.display !== 'none';
      var isIos = iosNotice && iosNotice.style.display !== '' && iosNotice.style.display !== 'none';

      pushToggle.disabled = isDenied || isIos;
      pushToggle.checked = isEnabled;

      if (isEnabled) {
        pushStatus.textContent = 'On for this device';
        pushPrefsRow.style.display = 'block';
        // Sync push prefs checkboxes from the hidden form's state (set by app.js via data-notify-* attrs)
        var section = document.getElementById('push-section');
        if (section) {
          var pp = document.querySelector('#push-prefs-form [name="push_notify_posts"]');
          var pc = document.querySelector('#push-prefs-form [name="push_notify_comments"]');
          var pb = document.querySelector('#push-prefs-form [name="push_notify_big_news"]');
          if (pp) pp.checked = section.dataset.notifyPosts !== '0';
          if (pc) pc.checked = section.dataset.notifyComments !== '0';
          if (pb) pb.checked = section.dataset.notifyBigNews !== '0';
        }
      } else if (isDenied) {
        pushStatus.textContent = 'Blocked by browser';
        pushPrefsRow.style.display = 'none';
      } else if (isIos) {
        pushStatus.textContent = 'Add to Home Screen first';
        pushPrefsRow.style.display = 'none';
      } else {
        pushStatus.textContent = 'Off';
        pushPrefsRow.style.display = 'none';
      }
    }

    var pushSection = document.getElementById('push-section');
    if (pushSection) {
      var observer = new MutationObserver(syncPushToggle);
      observer.observe(pushSection, { attributes: true, attributeFilter: ['style', 'class'], subtree: true });
    }

    pushToggle.addEventListener('change', function () {
      if (pushToggle.checked) {
        var enableBtn = document.getElementById('push-enable-btn');
        if (enableBtn) enableBtn.click();
      } else {
        var disableBtn = document.getElementById('push-disable-btn');
        if (disableBtn) disableBtn.click();
      }
    });
  }());
  </script>
  </body></html>
  ```

- [ ] **Step 2: Verify the file was created**

  Run: `wc -l src/views/settings.ejs`
  Expected: ~200+ lines

- [ ] **Step 3: Verify required IDs are present**

  Run: `grep -c 'push-state-default\|push-state-enabled\|push-state-denied\|push-ios-notice\|push-email-notice\|push-enable-btn\|push-disable-btn' src/views/settings.ejs`
  Expected: 7 (all seven IDs present)

- [ ] **Step 4: Verify script src is present**

  Run: `grep "app.js" src/views/settings.ejs`
  Expected: `<script src="/js/app.js"></script>`

- [ ] **Step 5: Commit**

  ```bash
  git add src/views/settings.ejs
  git commit -m "feat: add settings.ejs with inline edit UX, auto-save toggles, push bridge"
  ```

---

### Task 6: Deploy, smoke test, publish What's New

**Files:** None — this task deploys and verifies.

- [ ] **Step 1: Push to GitHub to trigger deploy**

  ```bash
  cd /home/jmull/projects/family-news
  git push
  ```

  Expected: push succeeds. GitHub Actions will build and deploy the image. The Pi runner auto-deploys.

- [ ] **Step 2: Wait for container to be running the new image**

  Run: `sudo docker compose -f /home/jmull/docker/docker-compose.yml ps family-news`
  Wait until the container shows `Up` status. Then run:
  ```bash
  sudo docker logs family-news --tail 20
  ```
  Expected: no startup errors, server listening message.

- [ ] **Step 3: Smoke test — /settings renders**

  Run: `curl -s -o /dev/null -w "%{http_code}" -b "connect.sid=SKIP" https://familynews.jonathan-mullet.com/settings`

  Note: this will redirect to /login (no session), which is correct behaviour.
  Expected: `302` (auth redirect) — confirms route exists and middleware fires.

- [ ] **Step 4: Smoke test — /profile redirects to /settings**

  Run: `curl -s -o /dev/null -w "%{http_code}" https://familynews.jonathan-mullet.com/profile`
  Expected: `301`

  Run: `curl -sI https://familynews.jonathan-mullet.com/profile | grep -i location`
  Expected: `Location: /settings`

- [ ] **Step 5: Open the settings page in the browser and verify**

  Open: https://familynews.jonathan-mullet.com/settings

  Verify:
  - Page title shows "Settings"
  - Three card sections: Profile, Account, Notifications
  - Click "Edit" on Name → inline form expands
  - Cancel closes the form
  - Opening a second row closes the first
  - Notification toggles are in correct initial state
  - Drawer shows primary links (Feed, Search, Photos, Notifications) at top
  - Drawer shows "Account" section label with Settings + What's New
  - Sign out is a bordered button at the bottom of the drawer
  - /profile in the browser → redirects to /settings

- [ ] **Step 6: Publish What's New entry**

  Run from `/home/jmull/projects/family-news`:
  ```bash
  node scripts/add-changelog.js --title "Settings page" --body "Profile settings got a makeover — everything's now in one clean Settings page with a simpler layout. Edit your name, birthday, email, and notifications all in one place. You can also reach it from the updated navigation menu."
  ```

  Then commit and push the sidecar:
  ```bash
  git add src/data/changelog-meta.json
  git commit -m "chore: update changelog sidecar for settings redesign"
  git push
  ```

---

## Self-Review

### Spec coverage

| Spec requirement | Covered by |
|-----------------|-----------|
| Drawer: primary links (Feed, Search, Photos, Notifications) | Task 4 |
| Drawer: "Account" section label with Settings + What's New | Task 4 |
| Drawer: "Admin" section label (admin/mod only) | Task 4 |
| Drawer: sign out bordered full-width button | Task 4 |
| Drawer: standalone Profile + Feedback links removed | Task 4 |
| `/settings` route with all handlers | Task 2 |
| `/profile` → 301 redirect to /settings | Task 3 |
| Three-section settings page (Profile, Account, Notifications) | Task 5 |
| Inline edit UX (one row open at a time, cancel/save) | Task 5 |
| Avatar row (click to change, remove button) | Task 5 |
| Birthday display with formatted date | Task 5 |
| Masked email display | Task 5 |
| Email notification auto-save toggles (each own form, carries other value) | Task 5 |
| Push notification toggle bridged to existing state machine | Task 5 |
| Push prefs sub-row (shown when enabled) | Task 5 |
| Feedback link below last section | Task 5 |
| Flash messages at top of page | Task 5 |
| CSS: all new classes in theme.css | Task 1 |
| What's New entry for members | Task 6 |

All spec requirements are covered. No placeholders.

### Type/name consistency check

- CSS class `.fn-settings-row-wrap` used in EJS: `id="wrap-name"`, `class="fn-settings-row-wrap"` ✓
- JS `data-edit-row="wrap-name"` matches element `id="wrap-name"` ✓
- Route actions in forms: `/settings/name`, `/settings/email`, `/settings/password`, `/settings/birthday`, `/settings/avatar`, `/settings/avatar/remove`, `/settings/notifications`, `/settings/push-prefs` — all match handlers in settings.js ✓
- Push IDs: `push-section`, `push-state-default`, `push-state-enabled`, `push-state-denied`, `push-ios-notice`, `push-email-notice`, `push-enable-btn`, `push-disable-btn` — all present in settings.ejs ✓
