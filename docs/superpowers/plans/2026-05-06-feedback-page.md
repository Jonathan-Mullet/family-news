# Feedback Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `/feedback` page where family members can report bugs and request features, backed by a DB table, an admin review section, and two-way email notifications.

**Architecture:** Six sequential tasks — DB schema → email functions → feedback route → feedback view → admin panel updates → nav links. Each builds on the previous; deploy and verify after each task by pushing to git (the self-hosted Pi runner auto-deploys on every push to main).

**Tech Stack:** Node.js + Express + EJS + Tailwind CDN, MySQL 8 via mysql2 pool, Nodemailer (existing `src/email.js` infrastructure).

---

## File Structure

**Create:**
- `src/routes/feedback.js` — `GET /feedback`, `POST /feedback/bug`, `POST /feedback/feature`; protected by `requireAuth`
- `src/views/feedback.ejs` — two-section form page with per-section success banners

**Modify:**
- `src/db.js` — add `feedback` `CREATE TABLE IF NOT EXISTS` block in `initDb()`
- `src/email.js` — add `sendFeedbackNotification` and `sendFeedbackResolved`; update `module.exports`
- `src/app.js` — register `app.use('/feedback', require('./routes/feedback'))`
- `src/routes/admin.js` — fetch `feedback` rows in `GET /`; add `POST /feedback/:id/resolve`
- `src/views/admin.ejs` — add Feedback section with inline resolve form
- `src/views/partials/nav.ejs` — add Feedback link in desktop nav and hamburger drawer

---

## Context for implementers

This is a Node.js/Express app deployed via Docker on a Raspberry Pi 5. Key patterns:

- **DB queries:** `const { pool } = require('../db')` → `await pool.query(sql, [params])` returns `[rows, fields]`; for a single row use `const [[row]] = await pool.query(...)`
- **Auth middleware:** `const { requireAuth, requireAdmin } = require('../middleware/auth')`; apply with `router.use(requireAuth)` at the top of a router file
- **Flash messages:** `req.flash('success', 'msg')` then `res.redirect(...)`, accessed in EJS as `<%= flash.success %>`
- **Fire-and-forget emails:** wrap in `(async () => { await sendX(...); })().catch(console.error)` — never `await` email calls in request handlers
- **Views:** EJS, start with `<%- include('partials/head', { title: '...' }) %>` + `<%- include('partials/nav') %>`, end with `</body></html>`
- **Deploy:** `git push` → GitHub Actions builds arm64 image → self-hosted Pi runner auto-deploys. Monitor with `gh run list --repo Jonathan-Mullet/family-news --limit 3`
- **Live DB check:** `sudo docker exec mysql mysql -uroot -pc0f62d7a499670fe2c1a159b1e9679a6 family_news -e "SQL"`

---

### Task 1: Add `feedback` table to DB

**Files:**
- Modify: `src/db.js` — inside `initDb()`, in the `tables` array, after the `push_subscriptions` block (after line 139)

- [ ] **Step 1: Add CREATE TABLE statement**

In `src/db.js`, in the `tables` array inside `initDb()`, append after the closing backtick+comma of the `push_subscriptions` block:

```js
    `CREATE TABLE IF NOT EXISTS feedback (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      user_id     INT NOT NULL,
      type        ENUM('bug', 'feature') NOT NULL,
      title       VARCHAR(150) NOT NULL,
      description TEXT NOT NULL,
      severity    ENUM('low', 'medium', 'high') DEFAULT NULL,
      status      ENUM('open', 'resolved') NOT NULL DEFAULT 'open',
      admin_note  TEXT DEFAULT NULL,
      created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME DEFAULT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`,
```

- [ ] **Step 2: Commit and deploy**

```bash
git add src/db.js
git commit -m "feat: add feedback table to DB schema"
git push
```

- [ ] **Step 3: Verify table was created**

Wait for both `build` and `deploy` jobs to show `completed`:
```bash
gh run list --repo Jonathan-Mullet/family-news --limit 3
```

Then confirm the table exists:
```bash
sudo docker exec mysql mysql -uroot -pc0f62d7a499670fe2c1a159b1e9679a6 family_news -e "DESCRIBE feedback;"
```

Expected: 10 columns — id, user_id, type, title, description, severity, status, admin_note, created_at, resolved_at.

---

### Task 2: Add email functions for feedback

**Files:**
- Modify: `src/email.js` — add two functions before `module.exports`; update the exports line

- [ ] **Step 1: Add `sendFeedbackNotification` and `sendFeedbackResolved`**

In `src/email.js`, insert both functions immediately before the `module.exports = { ... }` line at the end of the file:

```js
/**
 * Notifies the admin that a new feedback submission arrived.
 *
 * @param {string} adminEmail
 * @param {string} submitterName
 * @param {{type: string, title: string, description: string, severity: string|null}} item
 */
async function sendFeedbackNotification(adminEmail, submitterName, item) {
  const typeLabel = item.type === 'bug' ? '🐛 Bug Report' : '💡 Feature Request';
  const severityLine = item.severity
    ? `<p style="color:#475569"><strong>Severity:</strong> ${escapeHtml(item.severity)}</p>`
    : '';
  await sendMail(adminEmail, `[Family News] New feedback: ${escapeHtml(item.title)}`, `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:20px">
      <h2 style="color:#1e293b">${typeLabel}</h2>
      <p style="color:#475569"><strong>From:</strong> ${escapeHtml(submitterName)}</p>
      <p style="color:#475569"><strong>Title:</strong> ${escapeHtml(item.title)}</p>
      ${severityLine}
      <p style="color:#374151;background:#f8fafc;padding:12px;border-radius:8px;border-left:3px solid #4f46e5">
        ${escapeHtml(item.description)}
      </p>
    </div>
  `);
}

/**
 * Notifies the feedback submitter that their item has been addressed.
 *
 * @param {string} userEmail
 * @param {string} userName
 * @param {{title: string}} item
 * @param {string} adminNote - The message the admin wrote when resolving.
 */
async function sendFeedbackResolved(userEmail, userName, item, adminNote) {
  await sendMail(userEmail, `Re: your feedback — ${escapeHtml(item.title)}`, `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:20px">
      <h2 style="color:#1e293b">Feedback Update</h2>
      <p style="color:#475569">Hi ${escapeHtml(userName)}, just wanted to let you know your feedback has been addressed:</p>
      <p style="color:#374151;background:#f0fdf4;padding:12px;border-radius:8px;border-left:3px solid #16a34a;margin:8px 0">
        ${escapeHtml(adminNote)}
      </p>
      <p style="color:#94a3b8;font-size:12px;margin-top:16px">Your original feedback: "${escapeHtml(item.title)}"</p>
    </div>
  `);
}
```

- [ ] **Step 2: Update `module.exports`**

Replace the existing `module.exports` line:

```js
module.exports = { sendPasswordReset, sendNewPostNotification, sendCommentNotification, sendBigNewsNotification, sendPromotionNotification, sendMentionNotification, sendFeedbackNotification, sendFeedbackResolved };
```

- [ ] **Step 3: Commit**

```bash
git add src/email.js
git commit -m "feat: add sendFeedbackNotification and sendFeedbackResolved email functions"
```

---

### Task 3: Feedback route and app.js registration

**Files:**
- Create: `src/routes/feedback.js`
- Modify: `src/app.js` — add one `app.use` line after the photos route (line 105)

- [ ] **Step 1: Create `src/routes/feedback.js`**

```js
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { sendFeedbackNotification } = require('../email');

router.use(requireAuth);

router.get('/', (req, res) => {
  res.render('feedback', { submitted: req.query.submitted || null, error: req.query.error || null });
});

router.post('/bug', async (req, res) => {
  const title = req.body.title?.trim();
  const description = req.body.description?.trim();
  const severity = ['low', 'medium', 'high'].includes(req.body.severity) ? req.body.severity : 'low';
  if (!title || !description) return res.redirect('/feedback?error=1');
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
  }
  res.redirect('/feedback?submitted=bug');
});

router.post('/feature', async (req, res) => {
  const title = req.body.title?.trim();
  const description = req.body.description?.trim();
  if (!title || !description) return res.redirect('/feedback?error=1');
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
  }
  res.redirect('/feedback?submitted=feature');
});

module.exports = router;
```

- [ ] **Step 2: Register the route in `src/app.js`**

After `app.use('/', require('./routes/photos'));` (currently the last route registration), add:

```js
app.use('/feedback', require('./routes/feedback'));
```

- [ ] **Step 3: Commit and deploy**

```bash
git add src/routes/feedback.js src/app.js
git commit -m "feat: add feedback route (GET, POST bug/feature)"
git push
```

- [ ] **Step 4: Verify route is live**

Wait for deploy jobs to complete, then confirm the route responds (you'll get a template-not-found error until Task 4, but the route should hit without a 404):

```bash
curl -s -o /dev/null -w "%{http_code}" https://news.jonathan-mullet.com/feedback
```

Expected: 302 (redirects to /login because you're not logged in — proves the route registered and `requireAuth` is working).

---

### Task 4: Feedback view

**Files:**
- Create: `src/views/feedback.ejs`

- [ ] **Step 1: Create `src/views/feedback.ejs`**

```ejs
<%- include('partials/head', { title: 'Feedback' }) %>
<%- include('partials/nav') %>

<div class="max-w-2xl mx-auto px-4 py-6 space-y-8">
  <div>
    <h1 class="text-xl font-bold text-slate-800 dark:text-slate-100">Feedback</h1>
    <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">Got a bug to report or an idea? Let us know.</p>
  </div>

  <% if (error) { %>
  <div class="p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-xl text-red-700 dark:text-red-300 text-sm">
    Please fill in both the title and description.
  </div>
  <% } %>

  <%# Bug report %>
  <div class="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-5">
    <h2 class="font-semibold text-slate-700 dark:text-slate-200 mb-1">Report a Bug</h2>
    <p class="text-sm text-slate-400 dark:text-slate-500 mb-4">Something broken or not working as expected?</p>

    <% if (submitted === 'bug') { %>
    <div class="p-3 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-xl text-green-700 dark:text-green-300 text-sm mb-4">
      Thanks! Your bug report has been sent.
    </div>
    <% } %>

    <form method="POST" action="/feedback/bug" class="space-y-4">
      <div>
        <label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Bug title</label>
        <input type="text" name="title" required maxlength="150" placeholder="Short summary of the problem"
          class="w-full border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 placeholder-slate-400 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600">
      </div>
      <div>
        <label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Severity</label>
        <div class="flex gap-5 text-sm">
          <label class="flex items-center gap-1.5 text-slate-600 dark:text-slate-300 cursor-pointer">
            <input type="radio" name="severity" value="low" checked class="accent-brand-600"> Low
          </label>
          <label class="flex items-center gap-1.5 text-slate-600 dark:text-slate-300 cursor-pointer">
            <input type="radio" name="severity" value="medium" class="accent-brand-600"> Medium
          </label>
          <label class="flex items-center gap-1.5 text-slate-600 dark:text-slate-300 cursor-pointer">
            <input type="radio" name="severity" value="high" class="accent-brand-600"> High
          </label>
        </div>
      </div>
      <div>
        <label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Description</label>
        <textarea name="description" required rows="4" placeholder="What happened? What did you expect to happen?"
          class="w-full border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 placeholder-slate-400 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600 resize-none"></textarea>
      </div>
      <button type="submit"
        class="bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors">
        Send bug report
      </button>
    </form>
  </div>

  <%# Feature request %>
  <div class="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-5">
    <h2 class="font-semibold text-slate-700 dark:text-slate-200 mb-1">Request a Feature</h2>
    <p class="text-sm text-slate-400 dark:text-slate-500 mb-4">Have an idea for something new or a change you'd like?</p>

    <% if (submitted === 'feature') { %>
    <div class="p-3 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-xl text-green-700 dark:text-green-300 text-sm mb-4">
      Thanks! Your request has been submitted.
    </div>
    <% } %>

    <form method="POST" action="/feedback/feature" class="space-y-4">
      <div>
        <label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">What would you like?</label>
        <input type="text" name="title" required maxlength="150" placeholder="Short title for your request"
          class="w-full border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 placeholder-slate-400 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600">
      </div>
      <div>
        <label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Description</label>
        <textarea name="description" required rows="4" placeholder="Describe the change or addition you'd like to see."
          class="w-full border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 placeholder-slate-400 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600 resize-none"></textarea>
      </div>
      <button type="submit"
        class="bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors">
        Submit request
      </button>
    </form>
  </div>
</div>

</body></html>
```

- [ ] **Step 2: Commit and deploy**

```bash
git add src/views/feedback.ejs
git commit -m "feat: add feedback page view"
git push
```

- [ ] **Step 3: Verify the page renders**

Once deployed, log in to https://news.jonathan-mullet.com and visit `/feedback`. Confirm:
- Both "Report a Bug" and "Request a Feature" sections are visible
- Submitting the bug form with title + description redirects back with the green success banner above the bug section
- Submitting the feature form redirects back with success banner above the feature section
- Leaving title or description blank redirects back with the red error banner at the top
- Check the DB to confirm rows were inserted: `sudo docker exec mysql mysql -uroot -pc0f62d7a499670fe2c1a159b1e9679a6 family_news -e "SELECT id, type, title, severity, status FROM feedback;"`

---

### Task 5: Admin panel — Feedback section

**Files:**
- Modify: `src/routes/admin.js` — add `feedback` query to `GET /`; add `POST /feedback/:id/resolve`
- Modify: `src/views/admin.ejs` — add Feedback section before the closing `</div>` at line 182

- [ ] **Step 1: Fetch feedback in admin GET route**

In `src/routes/admin.js`, in the `router.get('/', ...)` handler, add a feedback query alongside the existing ones:

Replace:
```js
    const [users] = await pool.query(
      'SELECT id, name, email, role, active, created_at FROM users ORDER BY created_at'
    );
    const [invites] = await pool.query(`
      SELECT i.*, u1.name AS created_by_name, u2.name AS used_by_name
      FROM invites i
      JOIN users u1 ON i.created_by = u1.id
      LEFT JOIN users u2 ON i.used_by = u2.id
      ORDER BY i.created_at DESC LIMIT 30
    `);
    const [events] = await pool.query('SELECT * FROM events ORDER BY month, day, name');
    res.render('admin', { users, invites, events, baseUrl: process.env.BASE_URL });
```

With:
```js
    const [users] = await pool.query(
      'SELECT id, name, email, role, active, created_at FROM users ORDER BY created_at'
    );
    const [invites] = await pool.query(`
      SELECT i.*, u1.name AS created_by_name, u2.name AS used_by_name
      FROM invites i
      JOIN users u1 ON i.created_by = u1.id
      LEFT JOIN users u2 ON i.used_by = u2.id
      ORDER BY i.created_at DESC LIMIT 30
    `);
    const [events] = await pool.query('SELECT * FROM events ORDER BY month, day, name');
    const [feedback] = await pool.query(`
      SELECT f.*, u.name AS user_name, u.email AS user_email
      FROM feedback f
      JOIN users u ON f.user_id = u.id
      ORDER BY f.status ASC, f.created_at DESC
    `);
    res.render('admin', { users, invites, events, feedback, baseUrl: process.env.BASE_URL });
```

- [ ] **Step 2: Add resolve route to `src/routes/admin.js`**

In `src/routes/admin.js`, add this import at the top alongside the existing email import:

```js
const { sendPasswordReset, sendPromotionNotification, sendFeedbackResolved } = require('../email');
```

Then add the resolve route before `module.exports = router`:

```js
// Mark a feedback item resolved and optionally send a courtesy email to the submitter.
router.post('/feedback/:id/resolve', async (req, res) => {
  const note = req.body.admin_note?.trim() || 'Thanks for the report — this has been addressed!';
  try {
    const [[item]] = await pool.query(
      `SELECT f.*, u.email AS user_email, u.name AS user_name
       FROM feedback f JOIN users u ON f.user_id = u.id WHERE f.id = ?`,
      [req.params.id]
    );
    if (!item) { req.flash('error', 'Feedback item not found.'); return res.redirect('/admin'); }
    await pool.query(
      'UPDATE feedback SET status = "resolved", admin_note = ?, resolved_at = NOW() WHERE id = ?',
      [note, req.params.id]
    );
    (async () => {
      await sendFeedbackResolved(item.user_email, item.user_name, item, note);
    })().catch(console.error);
    req.flash('success', `Resolved and notified ${item.user_name}.`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not resolve feedback.');
  }
  res.redirect('/admin');
});
```

- [ ] **Step 3: Add Feedback section to `src/views/admin.ejs`**

In `src/views/admin.ejs`, insert the following section before the closing `</div>` at line 182 (the one that closes `max-w-3xl mx-auto px-4 py-6 space-y-6`):

```ejs
  <%# Feedback %>
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
                <% if (item.severity) { %>
                  <span class="text-xs text-slate-400 dark:text-slate-500 capitalize"><%= item.severity %></span>
                <% } %>
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
            data-target="resolve-<%= item.id %>">
            Mark Resolved
          </button>
          <% } %>
        </div>
        <% if (item.status === 'open') { %>
        <div id="resolve-<%= item.id %>" class="hidden mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">
          <form method="POST" action="/admin/feedback/<%= item.id %>/resolve">
            <label class="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Optional message to <%= item.user_name %></label>
            <textarea name="admin_note" rows="2"
              class="w-full border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 placeholder-slate-400 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600 resize-none mb-2">Thanks for the report — this has been addressed!</textarea>
            <button type="submit"
              class="text-xs bg-brand-600 hover:bg-brand-700 text-white px-3 py-1.5 rounded-lg transition-colors min-h-[32px]">
              Confirm & Notify
            </button>
          </form>
        </div>
        <% } %>
      </div>
      <% }) %>
    </div>
    <% } %>
  </div>
```

- [ ] **Step 4: Wire up the resolve-toggle JS**

In `src/views/admin.ejs`, inside the existing `<script>` block at the bottom (after the `user-edit-toggle` block), add:

```js
  document.querySelectorAll('.resolve-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById(btn.dataset.target).classList.toggle('hidden');
    });
  });
```

- [ ] **Step 5: Commit and deploy**

```bash
git add src/routes/admin.js src/views/admin.ejs
git commit -m "feat: add feedback section to admin panel with resolve flow"
git push
```

- [ ] **Step 6: Verify admin feedback section**

Once deployed, log in as admin and visit `/admin`. Scroll to the bottom — confirm:
- Feedback section appears with "N open" count
- Each submission shows type badge, title, submitter name, date
- Clicking "Show description" expands the description text
- Clicking "Mark Resolved" expands the inline form with the pre-filled textarea
- Submitting the form redirects back to `/admin` with flash success and the item now shows "Resolved [date]" with the note

---

### Task 6: Nav links

**Files:**
- Modify: `src/views/partials/nav.ejs` — add "Feedback" to desktop nav links and hamburger drawer nav

- [ ] **Step 1: Add to desktop nav**

In `src/views/partials/nav.ejs`, in the `.fn-nav-links` block (around line 166), add a Feedback link between Photos and Profile:

Replace:
```html
        <a href="/photos" class="fn-nav-link">Photos</a>
        <div class="fn-nav-sep"></div>
        <a href="/profile" class="fn-nav-link">Profile</a>
```

With:
```html
        <a href="/photos" class="fn-nav-link">Photos</a>
        <div class="fn-nav-sep"></div>
        <a href="/feedback" class="fn-nav-link">Feedback</a>
        <div class="fn-nav-sep"></div>
        <a href="/profile" class="fn-nav-link">Profile</a>
```

- [ ] **Step 2: Add to hamburger drawer**

In `src/views/partials/nav.ejs`, in the `.fn-drawer-nav` block (around line 220), add a Feedback link between Photos and Profile:

Replace:
```html
    <a href="/" class="fn-drawer-link">Feed</a>
    <a href="/photos" class="fn-drawer-link">Photos</a>
    <a href="/profile" class="fn-drawer-link">Profile</a>
```

With:
```html
    <a href="/" class="fn-drawer-link">Feed</a>
    <a href="/photos" class="fn-drawer-link">Photos</a>
    <a href="/feedback" class="fn-drawer-link">Feedback</a>
    <a href="/profile" class="fn-drawer-link">Profile</a>
```

- [ ] **Step 3: Commit and deploy**

```bash
git add src/views/partials/nav.ejs
git commit -m "feat: add Feedback link to desktop nav and mobile drawer"
git push
```

- [ ] **Step 4: Final verification**

Once deployed, verify end-to-end:
1. Desktop: "Feedback" link appears in the nav bar between Photos and Profile — click it to confirm it loads the feedback page
2. Mobile: Open the hamburger drawer — "Feedback" appears between Photos and Profile
3. Submit a bug report — confirm success banner, DB row inserted, admin receives email
4. Log in as admin, visit `/admin`, scroll to Feedback section — confirm the submission appears
5. Click "Mark Resolved", edit the message, submit — confirm flash success, row updates to resolved, item shows resolved date + note, submitter receives courtesy email
