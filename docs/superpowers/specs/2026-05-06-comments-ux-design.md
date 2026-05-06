# Comments UX Overhaul — Design Spec

## Goal

Make comments more accessible without cluttering the feed. Feed cards collapse comments behind a toggle, expanding inline on tap. The always-visible comment form is replaced with a slim pill that reveals a Send button only when tapped. Post detail reply threads with 3+ replies collapse their overflow behind a "Show N more" toggle.

---

## Section 1 — Feed card comment UX

### State A: no comments on this post

Replace the existing latest-comment preview (`latestCommentByPost`) and always-visible comment form with a single slim pill input:

```
[ Be the first to comment…                               ]
```

- Full-width rounded-pill input, no avatar, no Send button
- Border: `border-slate-200 dark:border-slate-600`, placeholder text italic, `text-xs`
- On tap/focus: border transitions to amber (`border-brand-400`), Send button slides in to the right of the input
- Send submits the standard POST to `/posts/:id/comments` (no AJAX, no page-within-a-page, existing endpoint unchanged)
- Implemented as a real `<form>` wrapping the input so it works without JS; the Send button slides in via JS-toggled class

### State B: post has comments

Replace the existing latest-comment preview and always-visible comment form with a single toggle button:

```
💬 3 comments · Add yours ▾
```

- Style: `text-xs font-semibold text-brand-600`, no background, no border, left-aligned
- Below the toggle (hidden by default): a pre-rendered block containing all top-level comments, their replies, and a comment form at the bottom. This block is in the DOM at page load — it just has `display:none` initially.
- Tap toggle → block becomes visible, arrow flips to ▴
- Tap toggle again → block collapses
- Comment count in the label is the total number of top-level comments (not replies). E.g. `💬 3 comments · Add yours ▾` even if there are also replies.

### Pre-rendered comment block structure (feed card, expanded)

Each top-level comment:
- Avatar (26px, initial fallback), author name (`text-xs font-semibold`), content (`text-xs text-slate-500`), timestamp (`text-xs text-slate-400`), Reply button (text link, `text-xs text-brand-600`)
- Reply tap: scrolls/links to the post detail page (`/post/:id`) rather than opening a sub-form inline on the feed — keeps feed card complexity low

Each reply (indented `pl-8`):
- Same structure, smaller avatar (22px)

Comment form at bottom of expanded block:
- Full form: avatar (current user, 22px) + input + Send button
- Same POST endpoint as before

### JS behavior (feed card)

Define a template local for the comment count before the IIFE (EJS, inside `<% %>`):

```ejs
<% const _postComments = commentsByPost[post.id] || []; %>
<% const _commentCount = _postComments.length; %>
```

Small inline IIFE in `post-card.ejs` — same pattern as nav drawer:

```js
(function() {
  const toggle = document.getElementById('fn-comment-toggle-<%= post.id %>');
  const section = document.getElementById('fn-comment-section-<%= post.id %>');
  const pill = document.getElementById('fn-comment-pill-<%= post.id %>');
  const pillSend = document.getElementById('fn-comment-pill-send-<%= post.id %>');

  if (toggle && section) {
    toggle.addEventListener('click', function() {
      const isOpen = section.classList.toggle('fn-comment-section--open');
      toggle.textContent = isOpen
        ? '💬 <%= _commentCount %> comments · Add yours ▴'
        : '💬 <%= _commentCount %> comments · Add yours ▾';
    });
  }

  if (pill && pillSend) {
    pill.addEventListener('focus', function() {
      pill.classList.add('fn-comment-pill--active');
      pillSend.classList.remove('fn-comment-send--hidden');
    });
  }
})();
```

IDs are scoped to `post.id` to avoid collisions when multiple cards appear on the feed.

---

## Section 2 — Post detail: reply thread collapse

No change to how comments are loaded or structured on the post detail page. The existing `comments` array with nested `replies` is already correct.

Template change only in `src/views/post.ejs`:

For each top-level comment, check `comment.replies.length`:

- **≤ 2 replies:** render all replies as today — no change.
- **≥ 3 replies:** render only the first 3 replies, then a pill toggle:

```
↓ Show N more replies
```

Tapping the pill adds a class that makes the overflow replies visible; pill changes to `↑ Show less`. Each comment thread is independent.

Toggle button: `type="button"`, `text-xs font-semibold text-brand-600`, styled as a pill (`fn-reply-toggle` class in `theme.css`).

Overflow replies: wrapped in a `<div class="fn-reply-overflow hidden">`. The toggle's click handler removes `hidden`. A second click re-adds it.

Inline script added to the existing `<script>` block at the bottom of `post.ejs`:

```js
document.querySelectorAll('.fn-reply-toggle').forEach(btn => {
  btn.addEventListener('click', () => {
    const overflow = document.getElementById(btn.dataset.target);
    const isNowHidden = overflow.classList.toggle('hidden');
    btn.textContent = isNowHidden
      ? '↓ Show ' + btn.dataset.count + ' more replies'
      : '↑ Show less';
  });
});
```

---

## Section 3 — Architecture & data layer

### New DB query in `enrichPosts()`

Replace the "latest comment" query with a full-comments query. The returned key changes from `latestCommentByPost` to `commentsByPost`.

```sql
SELECT c.id, c.post_id, c.parent_id, c.content, c.created_at,
       u.id AS user_id, u.name AS author_name, u.avatar_url AS author_avatar
FROM comments c
JOIN users u ON c.user_id = u.id
WHERE c.post_id IN (?) AND c.deleted_at IS NULL
ORDER BY c.post_id, IFNULL(c.parent_id, c.id), c.created_at ASC
```

Grouping in JS after the query:

```js
const commentsByPost = {};
commentRows.forEach(row => {
  if (!commentsByPost[row.post_id]) commentsByPost[row.post_id] = [];
  if (!row.parent_id) {
    commentsByPost[row.post_id].push({ ...row, replies: [] });
  } else {
    const parent = commentsByPost[row.post_id].find(c => c.id === row.parent_id);
    if (parent) parent.replies.push(row);
  }
});
```

`enrichPosts()` returns `commentsByPost` instead of `latestCommentByPost`. The JSDoc and return value are updated accordingly.

### Route changes

All routes that call `enrichPosts()` and pass data to templates must rename the destructured variable:

```js
// Before
const { reactionsByPost, reactionNames, latestCommentByPost } = await enrichPosts(posts, user.id);
res.render('feed', { ..., latestCommentByPost });

// After
const { reactionsByPost, reactionNames, commentsByPost } = await enrichPosts(posts, user.id);
res.render('feed', { ..., commentsByPost });
```

The post detail route (`src/routes/posts.js`) is unaffected — it loads its own comments separately and already has the full nested structure.

### Template variables

`post-card.ejs` receives `commentsByPost` (map of postId → array of comment objects with nested replies).

`post.ejs` is unchanged — it already receives `comments` (flat top-level array with `.replies`).

### CSS additions to `theme.css`

New classes added (not in Tailwind's static scan):

```css
/* Feed card comment section */
.fn-comment-section { display: none; }
.fn-comment-section--open { display: block; }

.fn-comment-pill--active { border-color: #8b5e3c; }
.dark .fn-comment-pill--active { border-color: #a97c50; }

.fn-comment-send--hidden { display: none; }

/* Post detail reply overflow */
.fn-reply-toggle {
  font-size: 0.75rem;
  font-weight: 600;
  color: #8b5e3c;
  background: #fdf6f0;
  border: 1px solid #e5c9b0;
  border-radius: 9999px;
  padding: 3px 12px;
  cursor: pointer;
  margin-top: 4px;
}
.dark .fn-reply-toggle {
  color: #c49a6c;
  background: #2c1f14;
  border-color: #5c3d2e;
}
```

### Files changed

| File | Change |
|------|--------|
| `src/utils/feedData.js` | Replace latest-comment query with full-comments query; return `commentsByPost` |
| `src/routes/*.js` (callers of enrichPosts) | Rename `latestCommentByPost` → `commentsByPost` in destructure + render call |
| `src/views/partials/post-card.ejs` | Replace latest-comment preview + always-visible form with slim pill (no comments) or toggle + pre-rendered block (has comments) |
| `src/views/post.ejs` | Add reply-overflow collapse for threads with 3+ replies |
| `src/public/css/theme.css` | Add new comment-section and reply-toggle CSS classes |

No new routes, no new JS files, no new DB tables. Existing comment POST endpoints are unchanged.

---

## Out of scope

- Pagination of comments on the feed card (family site scale is fine without it)
- AJAX comment submission (full page reload on submit is acceptable and consistent with current behavior)
- Reply inline on the feed card (Reply tap links to post detail)
- Any changes to how comments are stored or the `comments` table schema
