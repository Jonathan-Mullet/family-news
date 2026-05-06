# Photo Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/photos` page that shows all family photos in a filterable square grid with lightbox support.

**Architecture:** New `src/routes/photos.js` queries `post_photos JOIN posts JOIN users` with optional member filter and 48-per-page pagination. New `src/views/photos.ejs` renders a scrollable avatar chip row and a CSS grid; clicking any photo calls the existing `_openLightbox()` from `app.js` with the full page's URL array. Nav gets a Photos link. No new DB tables.

**Tech Stack:** Node.js + Express + EJS + Tailwind CDN, MySQL 8. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-06-photo-library-design.md`

---

## File Map

| File | Change |
|---|---|
| `src/public/css/theme.css` | Append photo library CSS classes |
| `src/routes/photos.js` | **Create** — photos route with member filter + pagination |
| `src/app.js` | Mount photos router |
| `src/views/photos.ejs` | **Create** — chip row, grid, lightbox wiring, pagination |
| `src/views/partials/nav.ejs` | Add Photos nav link |

---

## Task 1: Append photo library CSS to `src/public/css/theme.css`

**Files:**
- Modify: `src/public/css/theme.css` (append to end)

- [ ] **Step 1: Append CSS**

Add to the very end of `src/public/css/theme.css`:

```css

/* ── Photo library ───────────────────────────────────────────────────────────── */
.photo-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 3px;
}
@media (min-width: 640px) {
  .photo-grid { grid-template-columns: repeat(4, 1fr); }
}
.photo-grid img {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  cursor: pointer;
  display: block;
}
.photo-chip-row {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding: 12px 0 8px;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
.photo-chip-row::-webkit-scrollbar { display: none; }
.photo-chip {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  text-decoration: none;
}
.photo-chip img, .photo-chip .photo-chip-initial {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid transparent;
}
.photo-chip-initial {
  display: flex;
  align-items: center;
  justify-content: center;
  background: #94a3b8;
  color: white;
  font-weight: 600;
  font-size: 1rem;
}
.photo-chip.active img, .photo-chip.active .photo-chip-initial {
  border-color: #8b5e3c;
}
.photo-chip span {
  font-size: 0.7rem;
  color: #64748b;
  max-width: 52px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dark .photo-chip span { color: #9a7e5a; }
```

- [ ] **Step 2: Verify app boots without errors**

```bash
cd /home/jmull/projects/family-news && timeout 5 node src/app.js 2>&1 || true
```

Expected: `ERROR: Missing required environment variables` — no CSS parse errors (CSS is not parsed by Node; this just confirms the file saves correctly).

- [ ] **Step 3: Commit**

```bash
cd /home/jmull/projects/family-news
git add src/public/css/theme.css
git commit -m "feat: add photo library CSS (grid, chip row, chip styles)"
```

---

## Task 2: Create `src/routes/photos.js` and mount in `src/app.js`

**Files:**
- Create: `src/routes/photos.js`
- Modify: `src/app.js` (line 104 — after push route)

- [ ] **Step 1: Create `src/routes/photos.js`**

```js
'use strict';
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const PAGE_SIZE = 48;

router.get('/photos', requireAuth, async (req, res) => {
  try {
    const memberId = parseInt(req.query.member) || null;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const offset = (page - 1) * PAGE_SIZE;

    // Members who have at least one photo (for filter chips)
    const [members] = await pool.query(`
      SELECT DISTINCT u.id, u.name, u.avatar_url
      FROM users u
      JOIN posts p ON p.user_id = u.id
      JOIN post_photos pp ON pp.post_id = p.id
      WHERE p.deleted_at IS NULL
        AND (p.publish_at IS NULL OR p.publish_at <= NOW())
        AND u.active = 1
      ORDER BY u.name ASC
    `);

    const baseWhere = 'p.deleted_at IS NULL AND (p.publish_at IS NULL OR p.publish_at <= NOW())';
    const whereClause = memberId ? `${baseWhere} AND p.user_id = ?` : baseWhere;
    const whereParams = memberId ? [memberId] : [];

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM post_photos pp JOIN posts p ON pp.post_id = p.id WHERE ${whereClause}`,
      whereParams
    );

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (page > totalPages) {
      return res.redirect(`/photos${memberId ? `?member=${memberId}` : ''}`);
    }

    const [photos] = await pool.query(
      `SELECT pp.photo_url, pp.post_id, p.created_at, p.user_id AS author_id
       FROM post_photos pp
       JOIN posts p ON pp.post_id = p.id
       WHERE ${whereClause}
       ORDER BY p.created_at DESC, pp.sort_order ASC
       LIMIT ? OFFSET ?`,
      [...whereParams, PAGE_SIZE, offset]
    );

    res.render('photos', { photos, members, currentMember: memberId, page, totalPages });
  } catch (err) {
    console.error(err);
    res.render('error', { message: 'Could not load photos.' });
  }
});

module.exports = router;
```

- [ ] **Step 2: Mount in `src/app.js`**

Current line 104:
```js
app.use('/push', require('./routes/push'));
```

Change to:
```js
app.use('/push', require('./routes/push'));
app.use('/', require('./routes/photos'));
```

- [ ] **Step 3: Verify app boots without errors**

```bash
cd /home/jmull/projects/family-news && timeout 5 node src/app.js 2>&1 || true
```

Expected: `ERROR: Missing required environment variables` — no `Cannot find module` or syntax errors.

- [ ] **Step 4: Commit**

```bash
cd /home/jmull/projects/family-news
git add src/routes/photos.js src/app.js
git commit -m "feat: add /photos route with member filter and pagination"
```

---

## Task 3: Create `src/views/photos.ejs`

**Files:**
- Create: `src/views/photos.ejs`

The route (Task 2) passes these variables to the template:
- `photos` — array of `{ photo_url, post_id, created_at, author_id }`
- `members` — array of `{ id, name, avatar_url }` (members who have photos)
- `currentMember` — number (selected member's id) or `null`
- `page` — current page number (1-based)
- `totalPages` — total number of pages

The existing `_openLightbox(urls, startIndex)` function in `src/public/js/app.js` accepts an array of URL strings and an index. It is already loaded on every page via `<script src="/js/app.js">`.

- [ ] **Step 1: Create `src/views/photos.ejs`**

```ejs
<%- include('partials/head', { title: 'Photos' }) %>
<%- include('partials/nav') %>

<div class="max-w-2xl mx-auto px-4 py-6">
  <h1 class="text-2xl font-bold font-display text-slate-800 dark:text-slate-100 mb-1">Photos</h1>

  <%# Member filter chips %>
  <div class="photo-chip-row mb-4">
    <a href="/photos" class="photo-chip <%= !currentMember ? 'active' : '' %>">
      <div class="photo-chip-initial" style="background:#8b5e3c;font-size:0.65rem;letter-spacing:0.02em;">All</div>
      <span>All</span>
    </a>
    <% members.forEach(m => { %>
    <a href="/photos?member=<%= m.id %>" class="photo-chip <%= currentMember === m.id ? 'active' : '' %>">
      <% if (m.avatar_url) { %>
      <img src="<%= m.avatar_url %>" alt="">
      <% } else { %>
      <div class="photo-chip-initial"><%= m.name.charAt(0).toUpperCase() %></div>
      <% } %>
      <span><%= m.name.split(' ')[0] %></span>
    </a>
    <% }) %>
  </div>

  <% if (!photos.length) { %>
  <div class="text-center py-16 text-slate-400 dark:text-slate-500">
    <div class="text-4xl mb-3">📷</div>
    <% if (currentMember) { %>
    <% const filterMember = members.find(m => m.id === currentMember); %>
    <p>No photos from <%= filterMember ? filterMember.name.split(' ')[0] : 'this member' %> yet.</p>
    <% } else { %>
    <p>No photos yet.</p>
    <% } %>
  </div>
  <% } else { %>

  <%# Photo grid %>
  <div class="photo-grid">
    <% photos.forEach((photo, i) => { %>
    <img src="<%= photo.photo_url %>"
         alt=""
         loading="lazy"
         onclick="_openLightbox(_galleryPhotos, <%= i %>)">
    <% }) %>
  </div>

  <%# Pagination %>
  <% if (totalPages > 1) { %>
  <% const memberParam = currentMember ? `&member=${currentMember}` : ''; %>
  <div class="flex items-center justify-center gap-4 mt-6 text-sm text-slate-600 dark:text-slate-400">
    <% if (page > 1) { %>
    <a href="/photos?page=<%= page - 1 %><%= memberParam %>" class="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-brand-400 dark:hover:border-brand-500 transition-colors">Previous</a>
    <% } %>
    <span>Page <%= page %> of <%= totalPages %></span>
    <% if (page < totalPages) { %>
    <a href="/photos?page=<%= page + 1 %><%= memberParam %>" class="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-brand-400 dark:hover:border-brand-500 transition-colors">Next</a>
    <% } %>
  </div>
  <% } %>

  <% } %>
</div>

<script src="/js/app.js"></script>
<script>
  const _galleryPhotos = <%- JSON.stringify(photos.map(p => p.photo_url)).replace(/<\//g, '<\\/') %>;
</script>
</body></html>
```

- [ ] **Step 2: Verify app boots without errors**

```bash
cd /home/jmull/projects/family-news && timeout 5 node src/app.js 2>&1 || true
```

Expected: `ERROR: Missing required environment variables` — no module or syntax errors. (EJS template syntax errors only surface on first request, not at boot.)

- [ ] **Step 3: Commit**

```bash
cd /home/jmull/projects/family-news
git add src/views/photos.ejs
git commit -m "feat: add photos.ejs template (grid, chip row, lightbox, pagination)"
```

---

## Task 4: Add Photos link to `src/views/partials/nav.ejs`

**Files:**
- Modify: `src/views/partials/nav.ejs`

- [ ] **Step 1: Add Photos link before Profile**

Current (around line 155):
```ejs
        <a href="/profile" class="fn-nav-link">Profile</a>
        <div class="fn-nav-sep"></div>
        <a href="/logout" class="fn-nav-link fn-nav-link-danger">Sign out</a>
```

Change to:
```ejs
        <a href="/photos" class="fn-nav-link">Photos</a>
        <div class="fn-nav-sep"></div>
        <a href="/profile" class="fn-nav-link">Profile</a>
        <div class="fn-nav-sep"></div>
        <a href="/logout" class="fn-nav-link fn-nav-link-danger">Sign out</a>
```

- [ ] **Step 2: Verify app boots without errors**

```bash
cd /home/jmull/projects/family-news && timeout 5 node src/app.js 2>&1 || true
```

Expected: `ERROR: Missing required environment variables` — no errors.

- [ ] **Step 3: Commit**

```bash
cd /home/jmull/projects/family-news
git add src/views/partials/nav.ejs
git commit -m "feat: add Photos link to nav"
```
