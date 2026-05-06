# Comments UX Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the always-visible comment form on feed cards with a slim pill (no comments) or collapsible inline thread (has comments), and add reply-overflow collapse on the post detail page.

**Architecture:** Pre-render all post comments into hidden HTML at page load (no AJAX). `enrichPosts()` gains a new full-comments query returning `commentsByPost` (replaces `latestCommentByPost`). All template and route changes flow from that rename. Post detail reply collapse is pure JS + template — no data changes needed there.

**Tech Stack:** Node.js/Express, EJS templates, MySQL, Node built-in `node:test`, vanilla JS IIFEs (same pattern as nav drawer), Tailwind CDN + custom `theme.css` classes.

---

## File Map

| File | Change |
|------|--------|
| `src/public/css/theme.css` | Append comment-section and reply-toggle CSS classes |
| `src/utils/feedData.js` | Replace latest-comment query with full-comments query; export `groupCommentsByPost` |
| `src/utils/feedData.test.js` | New — unit tests for `groupCommentsByPost` |
| `src/routes/posts.js` | Rename `latestCommentByPost` → `commentsByPost` in destructure + render |
| `src/routes/members.js` | Same rename |
| `src/views/feed.ejs` | Same rename in all 3 `post-card` include calls |
| `src/views/member.ejs` | Same rename in 1 `post-card` include call |
| `src/views/partials/post-card.ejs` | Replace latest-comment preview + always-visible form with new comment section |
| `src/views/post.ejs` | Add reply-overflow collapse for threads with 3+ replies |

---

## Task 1: CSS additions to theme.css

**Files:**
- Modify: `src/public/css/theme.css` (append to end)

- [ ] **Step 1: Append CSS classes**

Open `src/public/css/theme.css` and append these classes at the very end of the file:

```css
/* ── Comments UX (feed card toggle + pill input) ─────────────────────────── */
.fn-comment-section { display: none; }
.fn-comment-section--open { display: block; }

.fn-comment-pill--active {
  border-color: #8b5e3c !important;
  font-style: normal;
}
.dark .fn-comment-pill--active { border-color: #a97c50 !important; }

.fn-comment-send--hidden { display: none; }

/* ── Reply overflow toggle (post detail) ─────────────────────────────────── */
.fn-reply-toggle {
  display: inline-flex;
  align-items: center;
  font-size: 0.75rem;
  font-weight: 600;
  color: #8b5e3c;
  background: #fdf6f0;
  border: 1px solid #e5c9b0;
  border-radius: 9999px;
  padding: 3px 12px;
  cursor: pointer;
  margin-top: 4px;
  transition: background 0.15s;
}
.fn-reply-toggle:hover { background: #f5ebe0; }
.dark .fn-reply-toggle {
  color: #c49a6c;
  background: #2c1f14;
  border-color: #5c3d2e;
}
.dark .fn-reply-toggle:hover { background: #3a2a1c; }
```

- [ ] **Step 2: Verify the diff looks right**

```bash
git diff src/public/css/theme.css | tail -50
```

Expected: shows the new CSS block at the bottom with no accidental changes above it.

- [ ] **Step 3: Commit**

```bash
git add src/public/css/theme.css
git commit -m "style: add CSS classes for comment toggle and reply overflow"
```

---

## Task 2: Pure function + unit tests

**Files:**
- Modify: `src/utils/feedData.js` (extract `groupCommentsByPost`, add export)
- Create: `src/utils/feedData.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/utils/feedData.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { groupCommentsByPost } = require('./feedData');

test('groupCommentsByPost: empty rows returns empty object', () => {
  assert.deepEqual(groupCommentsByPost([]), {});
});

test('groupCommentsByPost: top-level comments grouped by post_id with empty replies', () => {
  const rows = [
    { id: 1, post_id: 10, parent_id: null, content: 'Hello', user_id: 1, author_name: 'Alice', author_avatar: null, created_at: new Date('2024-01-01') },
    { id: 2, post_id: 10, parent_id: null, content: 'World', user_id: 2, author_name: 'Bob',   author_avatar: null, created_at: new Date('2024-01-02') },
    { id: 3, post_id: 20, parent_id: null, content: 'Other', user_id: 1, author_name: 'Alice', author_avatar: null, created_at: new Date('2024-01-03') },
  ];
  const result = groupCommentsByPost(rows);
  assert.equal(result[10].length, 2);
  assert.equal(result[20].length, 1);
  assert.deepEqual(result[10][0].replies, []);
});

test('groupCommentsByPost: replies nested under their parent comment', () => {
  const rows = [
    { id: 1, post_id: 10, parent_id: null, content: 'Parent', user_id: 1, author_name: 'Alice', author_avatar: null, created_at: new Date('2024-01-01') },
    { id: 2, post_id: 10, parent_id: 1,    content: 'Reply1', user_id: 2, author_name: 'Bob',   author_avatar: null, created_at: new Date('2024-01-02') },
    { id: 3, post_id: 10, parent_id: 1,    content: 'Reply2', user_id: 1, author_name: 'Alice', author_avatar: null, created_at: new Date('2024-01-03') },
  ];
  const result = groupCommentsByPost(rows);
  assert.equal(result[10].length, 1);
  assert.equal(result[10][0].replies.length, 2);
  assert.equal(result[10][0].replies[0].content, 'Reply1');
  assert.equal(result[10][0].replies[1].content, 'Reply2');
});

test('groupCommentsByPost: reply with unknown parent_id is silently dropped', () => {
  const rows = [
    { id: 1, post_id: 10, parent_id: null, content: 'Parent', user_id: 1, author_name: 'Alice', author_avatar: null, created_at: new Date('2024-01-01') },
    { id: 2, post_id: 10, parent_id: 99,   content: 'Orphan', user_id: 2, author_name: 'Bob',   author_avatar: null, created_at: new Date('2024-01-02') },
  ];
  const result = groupCommentsByPost(rows);
  assert.equal(result[10].length, 1);
  assert.equal(result[10][0].replies.length, 0);
});
```

- [ ] **Step 2: Run the test — expect failure**

```bash
node --test src/utils/feedData.test.js
```

Expected: fails with something like `TypeError: groupCommentsByPost is not a function` (because it doesn't exist yet).

- [ ] **Step 3: Add `groupCommentsByPost` to `feedData.js`**

In `src/utils/feedData.js`, add the new function BEFORE the `enrichPosts` function, and add it to the `module.exports`:

Add after line 12 (`const { pool } = require('../db');`):

```js

/**
 * Groups a flat array of comment rows (from DB) into a postId → nested comment tree map.
 * Top-level comments (parent_id = null) get a replies array; replies nest under their parent.
 * Exported separately for unit testing without a DB connection.
 *
 * Rows must be ordered so each parent comment appears before its replies —
 * the SQL query in enrichPosts guarantees this via ORDER BY IFNULL(parent_id, id), created_at.
 *
 * @param {Array} rows - Flat comment rows from DB
 * @returns {Object}  Map of post_id → [{ ...comment, replies: [...] }]
 */
function groupCommentsByPost(rows) {
  const result = {};
  rows.forEach(row => {
    if (!result[row.post_id]) result[row.post_id] = [];
    if (!row.parent_id) {
      result[row.post_id].push({ ...row, replies: [] });
    } else {
      const parent = result[row.post_id].find(c => c.id === row.parent_id);
      if (parent) parent.replies.push(row);
    }
  });
  return result;
}
```

Change the final `module.exports` line from:
```js
module.exports = { enrichPosts };
```
to:
```js
module.exports = { enrichPosts, groupCommentsByPost };
```

- [ ] **Step 4: Run the test — expect pass**

```bash
node --test src/utils/feedData.test.js
```

Expected output (all passing):
```
▶ groupCommentsByPost: empty rows returns empty object
  ✔ groupCommentsByPost: empty rows returns empty object (N ms)
▶ groupCommentsByPost: top-level comments grouped by post_id with empty replies
  ✔ groupCommentsByPost: top-level comments grouped by post_id with empty replies (N ms)
...
ℹ tests 4
ℹ pass 4
ℹ fail 0
```

- [ ] **Step 5: Commit**

```bash
git add src/utils/feedData.js src/utils/feedData.test.js
git commit -m "feat: extract groupCommentsByPost with unit tests"
```

---

## Task 3: Update enrichPosts query and rename everywhere

**Files:**
- Modify: `src/utils/feedData.js` (replace query, update JSDoc, return `commentsByPost`)
- Modify: `src/routes/posts.js` (rename in destructure + render)
- Modify: `src/routes/members.js` (rename in destructure + render)
- Modify: `src/views/feed.ejs` (rename in 3 include calls)
- Modify: `src/views/member.ejs` (rename in 1 include call)

All five files must change in this task — the app will not start correctly until all are updated together.

- [ ] **Step 1: Replace the latest-comment query in `feedData.js`**

In `src/utils/feedData.js`, find the `enrichPosts` function. Make these changes:

**Change 1** — update the function signature's JSDoc return type. Find:
```js
 * @returns {Promise<{
 *   reactionsByPost:     Object,
 *   reactionNames:       Object,
 *   latestCommentByPost: Object
 * }>}
```
Replace with:
```js
 * @returns {Promise<{
 *   reactionsByPost: Object,
 *   reactionNames:   Object,
 *   commentsByPost:  Object
 * }>}
```

**Change 2** — update the opening variables block. Find:
```js
  const reactionsByPost = {};
  const reactionNames = {};
  const latestCommentByPost = {};

  // Nothing to load if there are no posts
  if (!posts.length) return { reactionsByPost, reactionNames, latestCommentByPost };
```
Replace with:
```js
  const reactionsByPost = {};
  const reactionNames = {};
  const commentsByPost = {};

  // Nothing to load if there are no posts
  if (!posts.length) return { reactionsByPost, reactionNames, commentsByPost };
```

**Change 3** — replace the entire `// ── Latest comment ──...` block at the bottom of `enrichPosts`. Find this block (everything from the comment to the closing `latestCommentByPost` assignment):

```js
  // ── Latest comment ─────────────────────────────────────────────────────────
  // Inline preview on feed cards shows only the most recent comment per post
  const [latestCommentRows] = await pool.query(`
    SELECT c.post_id, c.content, u.name AS author_name, u.avatar_url AS author_avatar, u.id AS author_id
    FROM comments c JOIN users u ON c.user_id = u.id
    WHERE c.id IN (SELECT MAX(id) FROM comments WHERE post_id IN (?) AND deleted_at IS NULL GROUP BY post_id)
  `, [ids]);
  latestCommentRows.forEach(c => { latestCommentByPost[c.post_id] = c; });

  return { reactionsByPost, reactionNames, latestCommentByPost };
```

Replace with:

```js
  // ── All comments (pre-rendered for feed card inline expand) ───────────────
  // ORDER BY IFNULL(parent_id, id) groups each thread together and ensures
  // the parent comment always precedes its replies in the result set.
  const [commentRows] = await pool.query(`
    SELECT c.id, c.post_id, c.parent_id, c.content, c.created_at,
           u.id AS user_id, u.name AS author_name, u.avatar_url AS author_avatar
    FROM comments c
    JOIN users u ON c.user_id = u.id
    WHERE c.post_id IN (?) AND c.deleted_at IS NULL
    ORDER BY c.post_id, IFNULL(c.parent_id, c.id), c.created_at ASC
  `, [ids]);
  Object.assign(commentsByPost, groupCommentsByPost(commentRows));

  return { reactionsByPost, reactionNames, commentsByPost };
```

- [ ] **Step 2: Update `src/routes/posts.js`**

Find (line ~58):
```js
    const { reactionsByPost, reactionNames, latestCommentByPost } = await enrichPosts(allPosts, userId);
```
Replace with:
```js
    const { reactionsByPost, reactionNames, commentsByPost } = await enrichPosts(allPosts, userId);
```

Find (line ~73):
```js
    res.render('feed', { bigNewsPosts, regularPosts, archivedBigNews, reactionsByPost, reactionNames, latestCommentByPost, latestPostId });
```
Replace with:
```js
    res.render('feed', { bigNewsPosts, regularPosts, archivedBigNews, reactionsByPost, reactionNames, commentsByPost, latestPostId });
```

- [ ] **Step 3: Update `src/routes/members.js`**

Find (line ~31):
```js
    const { reactionsByPost, reactionNames, latestCommentByPost } = await enrichPosts(posts, req.session.user.id);
```
Replace with:
```js
    const { reactionsByPost, reactionNames, commentsByPost } = await enrichPosts(posts, req.session.user.id);
```

Find (line ~33):
```js
    res.render('member', { profileUser, posts, reactionsByPost, reactionNames, latestCommentByPost });
```
Replace with:
```js
    res.render('member', { profileUser, posts, reactionsByPost, reactionNames, commentsByPost });
```

- [ ] **Step 4: Update `src/views/feed.ejs`**

There are 3 `post-card` include calls in this file. In each one, replace `latestCommentByPost` with `commentsByPost`.

Run this to find them:
```bash
grep -n "latestCommentByPost" src/views/feed.ejs
```

For each matching line, the include call looks like:
```ejs
<%- include('partials/post-card', { post, isScheduled, reactionsByPost, reactionNames, latestCommentByPost }) %>
```

Change to:
```ejs
<%- include('partials/post-card', { post, isScheduled, reactionsByPost, reactionNames, commentsByPost }) %>
```

Apply to all 3 occurrences.

- [ ] **Step 5: Update `src/views/member.ejs`**

Run this to find the line:
```bash
grep -n "latestCommentByPost" src/views/member.ejs
```

Change:
```ejs
<%- include('partials/post-card', { post, isScheduled, reactionsByPost, reactionNames, latestCommentByPost }) %>
```
to:
```ejs
<%- include('partials/post-card', { post, isScheduled, reactionsByPost, reactionNames, commentsByPost }) %>
```

- [ ] **Step 6: Verify no remaining references to the old name**

```bash
grep -rn "latestCommentByPost" src/
```

Expected: no output. If any results appear, fix them before proceeding.

- [ ] **Step 7: Smoke-test the server starts without errors**

```bash
node src/app.js &
sleep 2
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/
kill %1
```

Expected: `302` (redirect to login) or `200`. Any `500` means a crash — check the server log.

- [ ] **Step 8: Commit**

```bash
git add src/utils/feedData.js src/routes/posts.js src/routes/members.js src/views/feed.ejs src/views/member.ejs
git commit -m "feat: load all post comments in enrichPosts, rename to commentsByPost"
```

---

## Task 4: Feed card template — slim pill and expandable comments

**Files:**
- Modify: `src/views/partials/post-card.ejs` (replace bottom two sections)

This task replaces the "Latest comment preview" block and "Inline comment form" block with the new comment UX. The rest of the template is untouched.

- [ ] **Step 1: Remove the old comment sections**

In `src/views/partials/post-card.ejs`, find and delete the entire block that starts with:
```ejs
  <%# Latest comment preview %>
```
...and ends just before the closing:
```ejs
</article>
```

The block to delete is everything from `<%# Latest comment preview %>` through the closing `</div>` of the inline comment form (currently the last `</div>` before `</article>`).

Verify what you're deleting covers exactly these two EJS comment markers:
- `<%# Latest comment preview %>`
- `<%# Inline comment form %>`

- [ ] **Step 2: Insert the new comment section**

In place of the deleted block, insert the following before the closing `</article>`:

```ejs
  <%# Comments section %>
  <%
    const _postComments = (commentsByPost && commentsByPost[post.id]) || [];
    const _commentCount = _postComments.length;
  %>
  <% if (_commentCount === 0) { %>
  <%# State A: no comments — slim pill input %>
  <div class="px-4 py-2.5 border-t border-slate-100 dark:border-slate-700">
    <form method="POST" action="/posts/<%= post.id %>/comments">
      <div class="flex gap-2 items-center">
        <input type="text" name="content" required
          id="fn-comment-pill-<%= post.id %>"
          placeholder="Be the first to comment…"
          class="fn-comment-pill flex-1 min-w-0 border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 placeholder-slate-400 italic rounded-full px-4 py-2 text-xs focus:outline-none transition-colors min-h-[36px]">
        <button type="submit" id="fn-comment-pill-send-<%= post.id %>"
          class="fn-comment-send--hidden bg-brand-600 text-white text-xs font-medium px-3 rounded-full hover:bg-brand-700 transition-colors min-h-[36px] shrink-0">Send</button>
      </div>
    </form>
  </div>
  <% } else { %>
  <%# State B: has comments — toggle + pre-rendered block %>
  <div class="px-4 py-2 border-t border-slate-100 dark:border-slate-700">
    <button type="button" id="fn-comment-toggle-<%= post.id %>"
      class="text-xs font-semibold text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 transition-colors">
      💬 <%= _commentCount %> <%= _commentCount === 1 ? 'comment' : 'comments' %> · Add yours ▾
    </button>
  </div>
  <div id="fn-comment-section-<%= post.id %>" class="fn-comment-section border-t border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-700/20">
    <div class="px-4 py-3 space-y-3">
      <% _postComments.forEach(comment => { %>
      <div class="flex gap-2 items-start">
        <% if (comment.author_avatar) { %>
        <img src="<%= comment.author_avatar %>" class="w-6 h-6 rounded-full object-cover flex-shrink-0 mt-0.5" alt="">
        <% } else { %>
        <div class="w-6 h-6 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-300 font-semibold text-xs flex-shrink-0 mt-0.5"><%= comment.author_name.charAt(0).toUpperCase() %></div>
        <% } %>
        <div class="flex-1 min-w-0">
          <span class="text-xs font-semibold text-slate-700 dark:text-slate-200"><%= comment.author_name %></span>
          <span class="text-xs text-slate-500 dark:text-slate-400 ml-1 break-words"><%- renderContent(comment.content) %></span>
          <% if (comment.replies && comment.replies.length) { %>
          <% comment.replies.forEach(reply => { %>
          <div class="flex gap-2 items-start mt-1.5 pl-2">
            <% if (reply.author_avatar) { %>
            <img src="<%= reply.author_avatar %>" class="w-5 h-5 rounded-full object-cover flex-shrink-0 mt-0.5" alt="">
            <% } else { %>
            <div class="w-5 h-5 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-300 font-semibold text-[9px] flex-shrink-0 mt-0.5"><%= reply.author_name.charAt(0).toUpperCase() %></div>
            <% } %>
            <div class="flex-1 min-w-0">
              <span class="text-xs font-semibold text-slate-700 dark:text-slate-200"><%= reply.author_name %></span>
              <span class="text-xs text-slate-500 dark:text-slate-400 ml-1 break-words"><%- renderContent(reply.content) %></span>
            </div>
          </div>
          <% }) %>
          <% } %>
        </div>
      </div>
      <% }) %>
      <form method="POST" action="/posts/<%= post.id %>/comments" class="flex gap-2 items-center pt-2 border-t border-slate-100 dark:border-slate-600">
        <input type="text" name="content" placeholder="Add a comment…" required
          class="mention-input flex-1 min-w-0 border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 placeholder-slate-400 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-600 min-h-[32px]">
        <button type="submit" class="bg-brand-600 text-white text-xs font-medium px-3 rounded-lg hover:bg-brand-700 transition-colors min-h-[32px] shrink-0">Send</button>
      </form>
    </div>
  </div>
  <% } %>
  <script>
  (function() {
    var toggle   = document.getElementById('fn-comment-toggle-<%= post.id %>');
    var section  = document.getElementById('fn-comment-section-<%= post.id %>');
    var pill     = document.getElementById('fn-comment-pill-<%= post.id %>');
    var pillSend = document.getElementById('fn-comment-pill-send-<%= post.id %>');
    var count    = <%= _commentCount %>;
    var label    = count === 1 ? 'comment' : 'comments';

    if (toggle && section) {
      toggle.addEventListener('click', function() {
        var isOpen = section.classList.toggle('fn-comment-section--open');
        toggle.textContent = '💬 ' + count + ' ' + label + ' · Add yours ' + (isOpen ? '▴' : '▾');
      });
    }

    if (pill && pillSend) {
      pill.addEventListener('focus', function() {
        pill.classList.add('fn-comment-pill--active');
        pillSend.classList.remove('fn-comment-send--hidden');
      });
    }
  })();
  </script>
```

- [ ] **Step 3: Start the server and test manually**

```bash
node src/app.js
```

Open http://localhost:3000 and verify:

1. **Post with no comments:** Feed card shows a slim italic pill "Be the first to comment…". Tap/click it → border turns amber, Send button appears to the right. Type a comment and send → page reloads, comment now exists.
2. **Post with comments:** Feed card shows "💬 N comments · Add yours ▾". Tap → comments expand inline below. Tap again → collapses. Comment form inside the expanded block works.
3. **Dark mode:** Toggle dark mode, verify both states look correct (amber borders and warm backgrounds should show through).

Kill the server with Ctrl-C when done.

- [ ] **Step 4: Commit**

```bash
git add src/views/partials/post-card.ejs
git commit -m "feat: feed card comment UX — slim pill and inline expandable comments"
```

---

## Task 5: Post detail — reply thread collapse

**Files:**
- Modify: `src/views/post.ejs` (reply loop + script block)

No data changes. This is a pure template + JS change.

- [ ] **Step 1: Replace the reply forEach loop**

In `src/views/post.ejs`, find the reply rendering block inside the comments forEach. It looks like:

```ejs
        <% comment.replies.forEach(reply => { %>
        <div class="flex gap-3 pl-11">
          <a href="/member/<%= reply.user_id %>" class="flex-shrink-0 mt-0.5">
          <% if (reply.author_avatar) { %>
          <img src="<%= reply.author_avatar %>" class="w-8 h-8 rounded-full object-cover" alt="">
          <% } else { %>
          <div class="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-300 font-semibold text-xs">
            <%= reply.author_name.charAt(0).toUpperCase() %>
          </div>
          <% } %>
          </a>
          <div class="flex-1 min-w-0">
            <div class="bg-slate-50 dark:bg-slate-700/60 rounded-xl px-3 py-2.5">
              <a href="/member/<%= reply.user_id %>" class="text-xs font-semibold text-slate-700 dark:text-slate-200 hover:text-brand-600 dark:hover:text-brand-400 transition-colors mb-0.5 block"><%= reply.author_name %></a>
              <p class="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words"><%- renderContent(reply.content) %></p>
            </div>
            <div class="flex items-center gap-3 mt-1.5 px-1 flex-wrap">
              <time data-ts="<%= new Date(reply.created_at).toISOString() %>" data-fmt="compact" class="text-xs text-slate-400 dark:text-slate-500"></time>
              <% if (user.id === reply.user_id || user.role === 'admin' || user.role === 'moderator') { %>
              <form method="POST" action="/comments/<%= reply.id %>/delete" class="inline" onsubmit="return confirm('Delete comment?')">
                <button type="submit" class="text-xs text-slate-400 dark:text-slate-500 hover:text-red-400 transition-colors min-h-[36px] px-1">Delete</button>
              </form>
              <% } %>
            </div>
          </div>
        </div>
        <% }) %>
```

Replace it entirely with:

```ejs
        <%# First 3 replies always visible %>
        <% comment.replies.slice(0, 3).forEach(reply => { %>
        <div class="flex gap-3 pl-11">
          <a href="/member/<%= reply.user_id %>" class="flex-shrink-0 mt-0.5">
          <% if (reply.author_avatar) { %>
          <img src="<%= reply.author_avatar %>" class="w-8 h-8 rounded-full object-cover" alt="">
          <% } else { %>
          <div class="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-300 font-semibold text-xs">
            <%= reply.author_name.charAt(0).toUpperCase() %>
          </div>
          <% } %>
          </a>
          <div class="flex-1 min-w-0">
            <div class="bg-slate-50 dark:bg-slate-700/60 rounded-xl px-3 py-2.5">
              <a href="/member/<%= reply.user_id %>" class="text-xs font-semibold text-slate-700 dark:text-slate-200 hover:text-brand-600 dark:hover:text-brand-400 transition-colors mb-0.5 block"><%= reply.author_name %></a>
              <p class="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words"><%- renderContent(reply.content) %></p>
            </div>
            <div class="flex items-center gap-3 mt-1.5 px-1 flex-wrap">
              <time data-ts="<%= new Date(reply.created_at).toISOString() %>" data-fmt="compact" class="text-xs text-slate-400 dark:text-slate-500"></time>
              <% if (user.id === reply.user_id || user.role === 'admin' || user.role === 'moderator') { %>
              <form method="POST" action="/comments/<%= reply.id %>/delete" class="inline" onsubmit="return confirm('Delete comment?')">
                <button type="submit" class="text-xs text-slate-400 dark:text-slate-500 hover:text-red-400 transition-colors min-h-[36px] px-1">Delete</button>
              </form>
              <% } %>
            </div>
          </div>
        </div>
        <% }) %>
        <%# Overflow replies (3+) — toggle button + hidden block %>
        <% if (comment.replies.length > 3) { %>
        <% const _overflowCount = comment.replies.length - 3; %>
        <div class="pl-11">
          <button type="button" class="fn-reply-toggle"
            data-target="fn-reply-overflow-<%= comment.id %>"
            data-count="<%= _overflowCount %>">
            ↓ Show <%= _overflowCount %> more <%= _overflowCount === 1 ? 'reply' : 'replies' %>
          </button>
        </div>
        <div id="fn-reply-overflow-<%= comment.id %>" class="hidden space-y-3">
          <% comment.replies.slice(3).forEach(reply => { %>
          <div class="flex gap-3 pl-11">
            <a href="/member/<%= reply.user_id %>" class="flex-shrink-0 mt-0.5">
            <% if (reply.author_avatar) { %>
            <img src="<%= reply.author_avatar %>" class="w-8 h-8 rounded-full object-cover" alt="">
            <% } else { %>
            <div class="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-300 font-semibold text-xs">
              <%= reply.author_name.charAt(0).toUpperCase() %>
            </div>
            <% } %>
            </a>
            <div class="flex-1 min-w-0">
              <div class="bg-slate-50 dark:bg-slate-700/60 rounded-xl px-3 py-2.5">
                <a href="/member/<%= reply.user_id %>" class="text-xs font-semibold text-slate-700 dark:text-slate-200 hover:text-brand-600 dark:hover:text-brand-400 transition-colors mb-0.5 block"><%= reply.author_name %></a>
                <p class="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words"><%- renderContent(reply.content) %></p>
              </div>
              <div class="flex items-center gap-3 mt-1.5 px-1 flex-wrap">
                <time data-ts="<%= new Date(reply.created_at).toISOString() %>" data-fmt="compact" class="text-xs text-slate-400 dark:text-slate-500"></time>
                <% if (user.id === reply.user_id || user.role === 'admin' || user.role === 'moderator') { %>
                <form method="POST" action="/comments/<%= reply.id %>/delete" class="inline" onsubmit="return confirm('Delete comment?')">
                  <button type="submit" class="text-xs text-slate-400 dark:text-slate-500 hover:text-red-400 transition-colors min-h-[36px] px-1">Delete</button>
                </form>
                <% } %>
              </div>
            </div>
          </div>
          <% }) %>
        </div>
        <% } %>
```

- [ ] **Step 2: Add the reply toggle JS handler to the existing script block**

In `src/views/post.ejs`, find the existing `<script>` block near the bottom that contains the `.reply-toggle` handler. Add the following AFTER the existing `document.querySelectorAll('.edit-cancel')` block, before the closing `</script>`:

```js
  document.querySelectorAll('.fn-reply-toggle').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var overflow = document.getElementById(btn.dataset.target);
      var isNowHidden = overflow.classList.toggle('hidden');
      btn.textContent = isNowHidden
        ? '↓ Show ' + btn.dataset.count + ' more ' + (btn.dataset.count === '1' ? 'reply' : 'replies')
        : '↑ Show less';
    });
  });
```

- [ ] **Step 3: Start the server and test manually**

```bash
node src/app.js
```

Navigate to a post detail page that has a comment with 3+ replies. Verify:

1. First 3 replies are visible; overflow is hidden.
2. "↓ Show N more replies" toggle appears below the 3rd reply.
3. Tap toggle → all replies visible, button changes to "↑ Show less".
4. Tap "↑ Show less" → collapses back, button restores original text.
5. Comments with ≤ 2 replies: no toggle, all replies always visible.
6. Multiple comment threads on same page are independent.

Kill the server with Ctrl-C when done.

- [ ] **Step 4: Commit**

```bash
git add src/views/post.ejs
git commit -m "feat: collapse reply threads with 3+ replies on post detail"
```

---

## Self-review checklist (run before declaring done)

- [ ] All 5 tasks committed and `git log --oneline -5` shows 5 new commits
- [ ] `node --test src/utils/feedData.test.js` → 4 pass, 0 fail
- [ ] Feed page loads, no 500 errors
- [ ] Feed card with no comments: slim pill visible, tapping shows Send button
- [ ] Feed card with comments: toggle shows comment count, tapping expands inline
- [ ] Expanded comment block shows comment form that submits correctly
- [ ] Post detail: short threads (≤ 2 replies) unchanged
- [ ] Post detail: long thread (3+ replies) shows overflow toggle that works in both directions
- [ ] No remaining `latestCommentByPost` references: `grep -rn latestCommentByPost src/` → empty
