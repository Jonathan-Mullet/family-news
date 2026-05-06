# Video Link Embed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect YouTube and Vimeo URLs in post content and render them as inline 16:9 iframe players on both the feed and post detail views.

**Architecture:** A pure `extractVideoEmbed(content)` function in `src/utils/videoEmbed.js` scans raw post content for the first YouTube or Vimeo URL and returns an embed `src` URL (or `null`). It's registered as `app.locals.extractVideoEmbed` in `app.js` so EJS templates can call it directly. Both `post-card.ejs` (feed) and `post.ejs` (detail) render a responsive 16:9 `<iframe>` when a video is detected, falling back to the existing link card otherwise.

**Tech Stack:** Node.js, EJS templates, vanilla CSS. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-06-video-embed-design.md`

---

## File Map

| File | Change |
|---|---|
| `src/utils/videoEmbed.js` | **Create** — `extractVideoEmbed(content)` |
| `src/utils/videoEmbed.test.js` | **Create** — unit tests using `node:test` |
| `src/app.js` | Modify — register `app.locals.extractVideoEmbed` |
| `src/public/css/theme.css` | Modify — append `.video-wrapper` responsive styles |
| `src/views/partials/post-card.ejs` | Modify — add video embed block, update link card condition |
| `src/views/post.ejs` | Modify — same |

---

## Task 1: Create `src/utils/videoEmbed.js` with tests

**Files:**
- Create: `src/utils/videoEmbed.js`
- Create: `src/utils/videoEmbed.test.js`

- [ ] **Step 1: Write the test file**

Create `src/utils/videoEmbed.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractVideoEmbed } = require('./videoEmbed');

// ── null / empty ──────────────────────────────────────────────────────────────

test('returns null for null input', () => {
  assert.equal(extractVideoEmbed(null), null);
});

test('returns null for empty string', () => {
  assert.equal(extractVideoEmbed(''), null);
});

test('returns null for plain text with no URL', () => {
  assert.equal(extractVideoEmbed('Hello family!'), null);
});

test('returns null for non-video URL', () => {
  assert.equal(extractVideoEmbed('Check this out https://example.com/page'), null);
});

// ── YouTube ───────────────────────────────────────────────────────────────────

test('detects youtube.com/watch?v=', () => {
  assert.equal(
    extractVideoEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
    'https://www.youtube.com/embed/dQw4w9WgXcQ'
  );
});

test('detects youtu.be short URL', () => {
  assert.equal(
    extractVideoEmbed('https://youtu.be/dQw4w9WgXcQ'),
    'https://www.youtube.com/embed/dQw4w9WgXcQ'
  );
});

test('detects youtube.com/shorts/', () => {
  assert.equal(
    extractVideoEmbed('https://www.youtube.com/shorts/dQw4w9WgXcQ'),
    'https://www.youtube.com/embed/dQw4w9WgXcQ'
  );
});

test('detects m.youtube.com/watch?v=', () => {
  assert.equal(
    extractVideoEmbed('https://m.youtube.com/watch?v=dQw4w9WgXcQ'),
    'https://www.youtube.com/embed/dQw4w9WgXcQ'
  );
});

test('detects YouTube URL embedded mid-sentence', () => {
  assert.equal(
    extractVideoEmbed('Check this out https://youtu.be/dQw4w9WgXcQ it is amazing!'),
    'https://www.youtube.com/embed/dQw4w9WgXcQ'
  );
});

test('handles YouTube URL with extra query params before v=', () => {
  assert.equal(
    extractVideoEmbed('https://www.youtube.com/watch?list=PLxxx&v=dQw4w9WgXcQ'),
    'https://www.youtube.com/embed/dQw4w9WgXcQ'
  );
});

// ── Vimeo ─────────────────────────────────────────────────────────────────────

test('detects vimeo.com/ID', () => {
  assert.equal(
    extractVideoEmbed('https://vimeo.com/123456789'),
    'https://player.vimeo.com/video/123456789'
  );
});

test('does not match vimeo channel/group paths', () => {
  assert.equal(extractVideoEmbed('https://vimeo.com/channels/staffpicks'), null);
});

// ── Priority ──────────────────────────────────────────────────────────────────

test('YouTube takes priority when both YouTube and Vimeo present', () => {
  assert.equal(
    extractVideoEmbed('https://youtu.be/dQw4w9WgXcQ and https://vimeo.com/123456789'),
    'https://www.youtube.com/embed/dQw4w9WgXcQ'
  );
});
```

- [ ] **Step 2: Run tests to verify they all fail**

```bash
cd /home/jmull/projects/family-news && node --test src/utils/videoEmbed.test.js 2>&1
```

Expected: error — `Cannot find module './videoEmbed'`

- [ ] **Step 3: Create `src/utils/videoEmbed.js`**

```js
'use strict';

/**
 * Extracts an embeddable iframe src URL from the first YouTube or Vimeo link
 * in `content`. Returns null if no supported video URL is found.
 *
 * Supported inputs → embed URLs:
 *   youtube.com/watch?v=ID   → https://www.youtube.com/embed/ID
 *   youtu.be/ID              → https://www.youtube.com/embed/ID
 *   youtube.com/shorts/ID    → https://www.youtube.com/embed/ID
 *   m.youtube.com/watch?v=ID → https://www.youtube.com/embed/ID
 *   vimeo.com/ID             → https://player.vimeo.com/video/ID
 *
 * @param {string|null|undefined} content - Raw post content text
 * @returns {string|null}
 */
function extractVideoEmbed(content) {
  if (!content) return null;

  // YouTube: handles watch?v=, youtu.be/, shorts/, m.youtube.com variants.
  // Video IDs are exactly 11 chars [A-Za-z0-9_-].
  // The (?:[^&\s]*&)* group skips any query params that appear before v=.
  const yt = content.match(
    /(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:[^&\s]*&)*v=|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
  );
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;

  // Vimeo: numeric IDs only — excludes /channels/, /groups/, /album/, etc.
  const vi = content.match(/(?:https?:\/\/)?(?:www\.)?vimeo\.com\/(\d+)(?:[/?#]|$)/);
  if (vi) return `https://player.vimeo.com/video/${vi[1]}`;

  return null;
}

module.exports = { extractVideoEmbed };
```

- [ ] **Step 4: Run tests to verify they all pass**

```bash
cd /home/jmull/projects/family-news && node --test src/utils/videoEmbed.test.js 2>&1
```

Expected: `# pass 13` (all 13 tests pass), `# fail 0`

- [ ] **Step 5: Commit**

```bash
cd /home/jmull/projects/family-news
git add src/utils/videoEmbed.js src/utils/videoEmbed.test.js
git commit -m "feat: add extractVideoEmbed utility (YouTube + Vimeo)"
```

---

## Task 2: Register `extractVideoEmbed` in `app.js` and add CSS

**Files:**
- Modify: `src/app.js` (lines 10 and 19)
- Modify: `src/public/css/theme.css` (append to end)

- [ ] **Step 1: Add import to `src/app.js`**

Current line 10:
```js
const { renderContent } = require('./utils/mentions');
```

Change to:
```js
const { renderContent } = require('./utils/mentions');
const { extractVideoEmbed } = require('./utils/videoEmbed');
```

- [ ] **Step 2: Register as app local in `src/app.js`**

Current line 19:
```js
app.locals.renderContent = renderContent;
```

Change to:
```js
app.locals.renderContent = renderContent;
app.locals.extractVideoEmbed = extractVideoEmbed;
```

- [ ] **Step 3: Append video wrapper CSS to `src/public/css/theme.css`**

Add to the very end of the file:

```css

/* ── Video embed ─────────────────────────────────────────────────────────────── */
.video-wrapper {
  position: relative;
  padding-bottom: 56.25%; /* 16:9 aspect ratio */
  height: 0;
  overflow: hidden;
  border-radius: 12px;
  margin-top: 12px;
}
.video-wrapper iframe {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border: 0;
}
```

- [ ] **Step 4: Verify app boots without errors**

```bash
cd /home/jmull/projects/family-news && timeout 5 node src/app.js 2>&1 || true
```

Expected: `ERROR: Missing required environment variables` (DB not available is fine — no require/syntax errors)

- [ ] **Step 5: Commit**

```bash
cd /home/jmull/projects/family-news
git add src/app.js src/public/css/theme.css
git commit -m "feat: register extractVideoEmbed app local; add video-wrapper CSS"
```

---

## Task 3: Add video embed to `src/views/partials/post-card.ejs`

**Files:**
- Modify: `src/views/partials/post-card.ejs` (lines 104–113)

The current link preview section (lines 104–113) looks like this:

```ejs
    <%# Link preview %>
    <% if (post.preview_url && (!post.photos || !post.photos.length)) { %>
    <a href="<%= post.preview_url %>" target="_blank" rel="noopener" class="mt-3 flex gap-3 border border-slate-200 dark:border-slate-600 rounded-xl p-3 hover:border-brand-400 dark:hover:border-brand-500 transition-colors overflow-hidden">
      <% if (post.og_image) { %><img src="<%= post.og_image %>" class="w-16 h-16 object-cover rounded-lg flex-shrink-0" loading="lazy" onerror="this.remove()"><% } %>
      <div class="min-w-0">
        <p class="text-sm font-medium text-slate-700 dark:text-slate-200 truncate"><%= post.og_title || post.preview_url %></p>
        <% if (post.og_description) { %><p class="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 mt-0.5"><%= post.og_description %></p><% } %>
      </div>
    </a>
    <% } %>
```

- [ ] **Step 1: Replace the link preview section**

Replace the block above with:

```ejs
    <%# Video embed or link preview %>
    <% const embedUrl = extractVideoEmbed(post.content); %>
    <% if (embedUrl) { %>
    <div class="video-wrapper">
      <iframe src="<%= embedUrl %>" allowfullscreen loading="lazy"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture">
      </iframe>
    </div>
    <% } else if (post.preview_url && (!post.photos || !post.photos.length)) { %>
    <a href="<%= post.preview_url %>" target="_blank" rel="noopener" class="mt-3 flex gap-3 border border-slate-200 dark:border-slate-600 rounded-xl p-3 hover:border-brand-400 dark:hover:border-brand-500 transition-colors overflow-hidden">
      <% if (post.og_image) { %><img src="<%= post.og_image %>" class="w-16 h-16 object-cover rounded-lg flex-shrink-0" loading="lazy" onerror="this.remove()"><% } %>
      <div class="min-w-0">
        <p class="text-sm font-medium text-slate-700 dark:text-slate-200 truncate"><%= post.og_title || post.preview_url %></p>
        <% if (post.og_description) { %><p class="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 mt-0.5"><%= post.og_description %></p><% } %>
      </div>
    </a>
    <% } %>
```

- [ ] **Step 2: Verify the app boots without template errors**

```bash
cd /home/jmull/projects/family-news && timeout 5 node src/app.js 2>&1 || true
```

Expected: `ERROR: Missing required environment variables` — no EJS parse errors

- [ ] **Step 3: Commit**

```bash
cd /home/jmull/projects/family-news
git add src/views/partials/post-card.ejs
git commit -m "feat: render YouTube/Vimeo embed in post-card feed view"
```

---

## Task 4: Add video embed to `src/views/post.ejs`

**Files:**
- Modify: `src/views/post.ejs` (lines 107–115)

The current link preview section (lines 107–115) looks like this:

```ejs
      <% if (post.preview_url && (!post.photos || !post.photos.length)) { %>
      <a href="<%= post.preview_url %>" target="_blank" rel="noopener" class="mt-3 flex gap-3 border border-slate-200 dark:border-slate-600 rounded-xl p-3 hover:border-brand-400 dark:hover:border-brand-500 transition-colors overflow-hidden">
        <% if (post.og_image) { %><img src="<%= post.og_image %>" class="w-16 h-16 object-cover rounded-lg flex-shrink-0" loading="lazy" onerror="this.remove()"><% } %>
        <div class="min-w-0">
          <p class="text-sm font-medium text-slate-700 dark:text-slate-200 truncate"><%= post.og_title || post.preview_url %></p>
          <% if (post.og_description) { %><p class="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 mt-0.5"><%= post.og_description %></p><% } %>
        </div>
      </a>
      <% } %>
```

- [ ] **Step 1: Replace the link preview section**

Replace the block above with:

```ejs
      <% const embedUrl = extractVideoEmbed(post.content); %>
      <% if (embedUrl) { %>
      <div class="video-wrapper">
        <iframe src="<%= embedUrl %>" allowfullscreen loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture">
        </iframe>
      </div>
      <% } else if (post.preview_url && (!post.photos || !post.photos.length)) { %>
      <a href="<%= post.preview_url %>" target="_blank" rel="noopener" class="mt-3 flex gap-3 border border-slate-200 dark:border-slate-600 rounded-xl p-3 hover:border-brand-400 dark:hover:border-brand-500 transition-colors overflow-hidden">
        <% if (post.og_image) { %><img src="<%= post.og_image %>" class="w-16 h-16 object-cover rounded-lg flex-shrink-0" loading="lazy" onerror="this.remove()"><% } %>
        <div class="min-w-0">
          <p class="text-sm font-medium text-slate-700 dark:text-slate-200 truncate"><%= post.og_title || post.preview_url %></p>
          <% if (post.og_description) { %><p class="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 mt-0.5"><%= post.og_description %></p><% } %>
        </div>
      </a>
      <% } %>
```

- [ ] **Step 2: Verify the app boots without template errors**

```bash
cd /home/jmull/projects/family-news && timeout 5 node src/app.js 2>&1 || true
```

Expected: `ERROR: Missing required environment variables` — no EJS parse errors

- [ ] **Step 3: Commit**

```bash
cd /home/jmull/projects/family-news
git add src/views/post.ejs
git commit -m "feat: render YouTube/Vimeo embed in post detail view"
```
