# UX Polish & Admin Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the comment pill from feed cards, replace broken long-press reaction UX with a tappable summary line, and add admin ability to send password reset emails and update member email addresses.

**Architecture:** Three independent changes to existing files — no new routes files, no schema changes, no new views. Admin reset reuses the existing `password_reset_tokens` table and `sendPasswordReset` email helper from the self-serve forgot-password flow.

**Tech Stack:** Node.js/Express, EJS templating, MySQL2, Tailwind CSS (CDN), vanilla JS in `src/public/js/app.js`. No test suite exists — verification is manual via the running Docker container.

---

## File Map

| File | Change |
|------|--------|
| `src/views/partials/post-card.ejs` | Remove pill; change summary `<p>` to `<button class="reaction-summary">` |
| `src/views/post.ejs` | Change summary `<p>` to `<button class="reaction-summary">` |
| `src/public/js/app.js` | Remove long-press handlers + `_longPressActive`; add `.reaction-summary` click listener |
| `src/routes/admin.js` | Add `POST /admin/users/:id/send-reset` and `POST /admin/users/:id/update-email` |
| `src/views/admin.ejs` | Add ⚙ button + collapsible panel per user row; add toggle JS |

---

## Task 1: Remove the comment pill from post-card.ejs

**Files:**
- Modify: `src/views/partials/post-card.ejs`

- [ ] **Step 1: Remove the pill element**

In `src/views/partials/post-card.ejs`, find and delete this block (it's the last child inside the `<div class="flex items-center gap-1 flex-wrap">` reactions row):

```ejs
      <a href="/post/<%= post.id %>" class="ml-auto flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-full border border-slate-200 dark:border-slate-600 text-brand-600 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-900/20 transition-colors min-h-[32px] whitespace-nowrap">
        💬 <%= post.comment_count > 0 ? post.comment_count + (post.comment_count !== 1 ? ' comments' : ' comment') : 'Add a comment' %>
      </a>
```

- [ ] **Step 2: Verify pill is removed**

```bash
grep -c "rounded-full border border-slate-200.*comment_count" src/views/partials/post-card.ejs
```
Expected: `0`

- [ ] **Step 3: Commit**

```bash
git add src/views/partials/post-card.ejs
git commit -m "Remove comment count pill from feed card"
```

---

## Task 2: Replace long-press with tappable summary line

**Files:**
- Modify: `src/views/partials/post-card.ejs`
- Modify: `src/views/post.ejs`
- Modify: `src/public/js/app.js`

- [ ] **Step 1: Update summary line in post-card.ejs**

In `src/views/partials/post-card.ejs`, find the summary paragraph (just after the `_summaryParts` scriptlet):

```ejs
    <% if (_summaryParts.length) { %>
    <p class="text-xs text-slate-400 dark:text-slate-500 mt-1.5 leading-relaxed"><%= _summaryParts.join(' · ') %></p>
    <% } %>
```

Replace with:

```ejs
    <% if (_summaryParts.length) { %>
    <button class="reaction-summary text-xs text-slate-400 dark:text-slate-500 mt-1.5 leading-relaxed text-left w-full hover:text-slate-600 dark:hover:text-slate-300 transition-colors"><%= _summaryParts.join(' · ') %></button>
    <% } %>
```

- [ ] **Step 2: Update summary line in post.ejs**

In `src/views/post.ejs`, find the summary paragraph (inside the reactions div, after the `_summaryParts` scriptlet):

```ejs
      <% if (_summaryParts.length) { %>
      <p class="text-xs text-slate-400 dark:text-slate-500 mt-1.5 leading-relaxed"><%= _summaryParts.join(' · ') %></p>
      <% } %>
```

Replace with:

```ejs
      <% if (_summaryParts.length) { %>
      <button class="reaction-summary text-xs text-slate-400 dark:text-slate-500 mt-1.5 leading-relaxed text-left w-full hover:text-slate-600 dark:hover:text-slate-300 transition-colors"><%= _summaryParts.join(' · ') %></button>
      <% } %>
```

- [ ] **Step 3: Remove long-press code from app.js**

In `src/public/js/app.js`, find the `reaction-btn` forEach block. It currently looks like this (approximately lines 122–175):

```js
document.querySelectorAll('.reaction-btn').forEach(btn => {
  // ... click handler with _longPressActive guard ...
  let _longPressTimer = null;
  let _longPressActive = false;
  btn.addEventListener('touchstart', () => { ... });
  btn.addEventListener('touchmove', () => { ... });
  btn.addEventListener('touchend', () => { ... });
});
```

Replace the entire block with a clean version that has no long-press logic:

```js
document.querySelectorAll('.reaction-btn').forEach(btn => {
  if (btn.closest('.emoji-picker')) return;
  btn.addEventListener('click', () => {
    const postId = btn.dataset.postId;
    const emoji = btn.dataset.emoji;
    handleReactionClick(postId, emoji, btn);
  });
});
```

- [ ] **Step 4: Add reaction-summary click listener in app.js**

Directly after the block you just wrote (still in `app.js`), add:

```js
document.querySelectorAll('.reaction-summary').forEach(btn => {
  btn.addEventListener('click', () => {
    const article = btn.closest('article[data-post-id]');
    if (!article) return;
    try {
      _showReactionSheet(JSON.parse(article.dataset.reactionNames || '{}'));
    } catch {}
  });
});
```

- [ ] **Step 5: Verify**

Check the long-press code is gone:
```bash
grep -c "touchstart" src/public/js/app.js
```
Expected: `0`

Check the summary listener is present:
```bash
grep -c "reaction-summary" src/public/js/app.js
```
Expected: `1`

- [ ] **Step 6: Commit**

```bash
git add src/views/partials/post-card.ejs src/views/post.ejs src/public/js/app.js
git commit -m "Replace long-press reaction names with tappable summary line"
```

---

## Task 3: Admin — send-reset and update-email routes

**Files:**
- Modify: `src/routes/admin.js`

- [ ] **Step 1: Add the send-reset route**

In `src/routes/admin.js`, add the `sendPasswordReset` import at the top alongside the existing requires:

```js
const crypto = require('crypto');
const { sendPasswordReset } = require('../email');
```

Then, before `module.exports = router;`, add:

```js
router.post('/users/:id/send-reset', async (req, res) => {
  try {
    const [[user]] = await pool.query('SELECT id, name, email FROM users WHERE id = ?', [req.params.id]);
    if (!user) { req.flash('error', 'User not found.'); return res.redirect('/admin'); }
    const token = crypto.randomBytes(32).toString('hex');
    await pool.query(
      'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 1 HOUR))',
      [user.id, token]
    );
    sendPasswordReset(user.email, token);
    req.flash('success', `Password reset email sent to ${user.name}.`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not send reset email.');
  }
  res.redirect('/admin');
});
```

- [ ] **Step 2: Add the update-email route**

Still in `src/routes/admin.js`, before `module.exports = router;`, add:

```js
router.post('/users/:id/update-email', async (req, res) => {
  const newEmail = req.body.email?.trim().toLowerCase();
  if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
    req.flash('error', 'Invalid email address.');
    return res.redirect('/admin');
  }
  try {
    const [[existing]] = await pool.query(
      'SELECT id FROM users WHERE email = ? AND id != ?', [newEmail, req.params.id]
    );
    if (existing) { req.flash('error', 'That email is already in use.'); return res.redirect('/admin'); }
    const [[user]] = await pool.query('SELECT name FROM users WHERE id = ?', [req.params.id]);
    if (!user) { req.flash('error', 'User not found.'); return res.redirect('/admin'); }
    await pool.query('UPDATE users SET email = ? WHERE id = ?', [newEmail, req.params.id]);
    req.flash('success', `Email updated for ${user.name}.`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not update email.');
  }
  res.redirect('/admin');
});
```

- [ ] **Step 3: Verify routes were added**

```bash
grep -c "send-reset\|update-email" src/routes/admin.js
```
Expected: `2`

- [ ] **Step 4: Commit**

```bash
git add src/routes/admin.js
git commit -m "Add admin routes: send password reset email, update member email"
```

---

## Task 4: Admin UI — ⚙ button and collapsible panel

**Files:**
- Modify: `src/views/admin.ejs`

- [ ] **Step 1: Add ⚙ button to each user row**

In `src/views/admin.ejs`, find the user row actions block. It currently ends with the `toggle-active` form. The full `<div class="flex gap-1.5 flex-shrink-0">` block looks like:

```ejs
        <div class="flex gap-1.5 flex-shrink-0">
          <form method="POST" action="/admin/users/<%= u.id %>/toggle-role" onsubmit="return confirm('<%= u.role === 'admin' ? 'Remove admin?' : 'Make admin?' %>')">
            <button type="submit" class="text-xs text-slate-400 dark:text-slate-500 hover:text-brand-600 dark:hover:text-brand-400 px-2 py-1 border border-slate-200 dark:border-slate-600 rounded-lg transition-colors" title="<%= u.role === 'admin' ? 'Remove admin' : 'Make admin' %>">
              <%= u.role === 'admin' ? '↓' : '↑' %>
            </button>
          </form>
          <form method="POST" action="/admin/users/<%= u.id %>/toggle-active" onsubmit="return confirm('<%= u.active ? 'Deactivate this account?' : 'Reactivate this account?' %>')">
            <button type="submit" class="text-xs <%= u.active ? 'text-slate-400 dark:text-slate-500 hover:text-red-500' : 'text-green-600 hover:text-green-700' %> px-2 py-1 border border-slate-200 dark:border-slate-600 rounded-lg transition-colors">
              <%= u.active ? 'Disable' : 'Enable' %>
            </button>
          </form>
        </div>
```

Replace with (adds the ⚙ button at the end of the flex row):

```ejs
        <div class="flex gap-1.5 flex-shrink-0">
          <form method="POST" action="/admin/users/<%= u.id %>/toggle-role" onsubmit="return confirm('<%= u.role === 'admin' ? 'Remove admin?' : 'Make admin?' %>')">
            <button type="submit" class="text-xs text-slate-400 dark:text-slate-500 hover:text-brand-600 dark:hover:text-brand-400 px-2 py-1 border border-slate-200 dark:border-slate-600 rounded-lg transition-colors" title="<%= u.role === 'admin' ? 'Remove admin' : 'Make admin' %>">
              <%= u.role === 'admin' ? '↓' : '↑' %>
            </button>
          </form>
          <form method="POST" action="/admin/users/<%= u.id %>/toggle-active" onsubmit="return confirm('<%= u.active ? 'Deactivate this account?' : 'Reactivate this account?' %>')">
            <button type="submit" class="text-xs <%= u.active ? 'text-slate-400 dark:text-slate-500 hover:text-red-500' : 'text-green-600 hover:text-green-700' %> px-2 py-1 border border-slate-200 dark:border-slate-600 rounded-lg transition-colors">
              <%= u.active ? 'Disable' : 'Enable' %>
            </button>
          </form>
          <button type="button" class="user-edit-toggle text-xs text-slate-400 dark:text-slate-500 hover:text-brand-600 dark:hover:text-brand-400 px-2 py-1 border border-slate-200 dark:border-slate-600 rounded-lg transition-colors" data-target="user-edit-<%= u.id %>" title="Edit user">⚙</button>
        </div>
```

- [ ] **Step 2: Add the collapsible panel below each user row**

The users list uses `<div class="divide-y divide-slate-100 dark:divide-slate-700">` with one `<div>` per user. Each user `<div>` currently ends after the `<% } %>` closing the if/else for self. Add the collapsible panel immediately before the closing `</div>` of the user row div:

Find this pattern (at the end of the per-user div, just before `<% }) %>`):

```ejs
        <span class="text-xs text-slate-300 dark:text-slate-600 hidden sm:block">you</span>
        <% } %>
      </div>
      <% }) %>
```

Replace with:

```ejs
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
```

- [ ] **Step 3: Add toggle JS to the admin page script block**

In `src/views/admin.ejs`, find the existing `<script>` block (after the QR code script). Add these lines inside the script block, after the existing `showQrNew` listener:

```js
  document.querySelectorAll('.user-edit-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById(btn.dataset.target).classList.toggle('hidden');
    });
  });
```

- [ ] **Step 4: Verify**

```bash
grep -c "user-edit-toggle\|send-reset\|update-email" src/views/admin.ejs
```
Expected: `3` or more

- [ ] **Step 5: Commit**

```bash
git add src/views/admin.ejs
git commit -m "Add admin per-user edit panel: update email, send password reset"
```

---

## Task 5: Build and deploy

- [ ] **Step 1: Push to remote**

```bash
git push
```

- [ ] **Step 2: Wait for GitHub Actions build**

Check status at: `https://github.com/Jonathan-Mullet/family-news/actions`

Wait until the latest workflow run shows a green checkmark (typically 2–4 minutes).

- [ ] **Step 3: Deploy**

```bash
cd /home/jmull/docker && docker compose pull family-news && docker compose up -d family-news
```

Expected: `Container family-news Started`

- [ ] **Step 4: Smoke test**

- Load the feed — confirm the `💬` pill is absent from post cards
- Tap the reaction names summary line on a post that has reactions — confirm the bottom sheet slides up
- Visit `/admin` — click ⚙ on a user row — confirm the panel expands with email field and reset button
- Confirm collapsing the panel works by clicking ⚙ again
