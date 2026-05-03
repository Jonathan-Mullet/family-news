# Reactions Visibility, Comments Prominence & Member Profile — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make reaction names visible on mobile via a summary line + long-press bottom sheet; make comments more prominent on feed cards with a pill button, latest-comment preview, and inline form; add a per-member post history page.

**Architecture:** Extend the feed and post-detail server queries to include reaction names and the latest comment per post (no extra client-side fetches). A shared bottom sheet element in the DOM handles long-press on mobile. A new `/member/:id` route + view reuses the existing `post-card.ejs` partial. Author names/avatars everywhere become links.

**Tech Stack:** Node.js/Express, EJS, Tailwind CDN, MySQL2, vanilla JS

**Note on testing:** This project has no test framework. Each task includes a manual verification step.

---

## File Map

| Action | File |
|--------|------|
| Modify | `src/routes/posts.js` — feed query + post-detail query |
| Modify | `src/routes/comments.js` — referer-aware redirect |
| Create | `src/routes/members.js` — new member profile route |
| Modify | `src/app.js` — register members route |
| Modify | `src/views/feed.ejs` — pass new variables to post-card includes |
| Modify | `src/views/partials/post-card.ejs` — summary line, data attr, comment pill, latest comment, inline form, author links |
| Modify | `src/views/post.ejs` — summary line, data attr, reaction names, author links, comment author links |
| Create | `src/views/member.ejs` — new member profile view |
| Modify | `src/public/js/app.js` — long-press bottom sheet |

---

## Task 1: Extend feed query with reaction names and latest comment

**Files:**
- Modify: `src/routes/posts.js` (lines 27–88, the `GET /` handler)

- [ ] **Step 1: Add two new variables before the `if (allPosts.length)` block**

  In `GET /`, find the line `let reactionsByPost = {};` (around line 50) and add two declarations directly below it:

  ```js
  let reactionsByPost = {};
  let reactionNames = {};
  let latestCommentByPost = {};
  ```

- [ ] **Step 2: Add two new queries inside `if (allPosts.length)`, after the photoRows block**

  After the block that ends with `photoRows.forEach(ph => { ... });`, add:

  ```js
  const [nameRows] = await pool.query(`
    SELECT r.post_id, r.emoji, u.name
    FROM reactions r JOIN users u ON r.user_id = u.id
    WHERE r.post_id IN (?)
    ORDER BY r.post_id, r.emoji, u.name
  `, [ids]);
  nameRows.forEach(r => {
    if (!reactionNames[r.post_id]) reactionNames[r.post_id] = {};
    if (!reactionNames[r.post_id][r.emoji]) reactionNames[r.post_id][r.emoji] = [];
    reactionNames[r.post_id][r.emoji].push(r.name);
  });

  const [latestCommentRows] = await pool.query(`
    SELECT c.post_id, c.content, u.name AS author_name, u.avatar_url AS author_avatar, u.id AS author_id
    FROM comments c JOIN users u ON c.user_id = u.id
    WHERE c.id IN (SELECT MAX(id) FROM comments WHERE post_id IN (?) GROUP BY post_id)
  `, [ids]);
  latestCommentRows.forEach(c => { latestCommentByPost[c.post_id] = c; });
  ```

- [ ] **Step 3: Pass the new variables to the feed render call**

  Change:
  ```js
  res.render('feed', { bigNewsPosts, regularPosts, archivedBigNews, reactionsByPost, latestPostId });
  ```
  To:
  ```js
  res.render('feed', { bigNewsPosts, regularPosts, archivedBigNews, reactionsByPost, reactionNames, latestCommentByPost, latestPostId });
  ```

- [ ] **Step 4: Update all three post-card includes in `src/views/feed.ejs`**

  There are three `include('partials/post-card', ...)` calls (big news, regular feed, archived). Change all three from:
  ```ejs
  <%- include('partials/post-card', { post, isScheduled, reactionsByPost }) %>
  ```
  To:
  ```ejs
  <%- include('partials/post-card', { post, isScheduled, reactionsByPost, reactionNames, latestCommentByPost }) %>
  ```

- [ ] **Step 5: Verify — start the server and load the feed**

  ```bash
  cd /home/jmull/projects/family-news && node src/app.js
  ```
  Expected: feed loads without errors. (The new variables aren't rendered yet — that's Task 2.)

---

## Task 2: Update post-card.ejs — data attribute, summary line, comment pill, latest comment, inline form

**Files:**
- Modify: `src/views/partials/post-card.ejs`

- [ ] **Step 1: Add `data-reaction-names` to the `<article>` element**

  Change the opening `<article>` tag from:
  ```html
  <article class="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden" data-post-id="<%= post.id %>">
  ```
  To:
  ```html
  <article class="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden" data-post-id="<%= post.id %>" data-reaction-names="<%= JSON.stringify((reactionNames && reactionNames[post.id]) ? reactionNames[post.id] : {}) %>">
  ```

- [ ] **Step 2: Replace the reactions section (the `border-t` div at the bottom of the card)**

  Find and replace the entire `<%# Reactions %>` section (from `<div class="px-4 py-2 border-t...">` to its closing `</div>`). Replace with:

  ```ejs
  <%# Reactions %>
  <div class="px-4 py-2 border-t border-slate-100 dark:border-slate-700">
    <div class="flex items-center gap-1 flex-wrap">
      <% ['❤️','👍','😂','😮','😢'].forEach(emoji => {
        const r = reactionsByPost[post.id]?.[emoji];
        const count = r?.count || 0;
        const active = r?.userReacted;
      %>
      <button class="reaction-btn flex items-center gap-1 px-2.5 py-1.5 rounded-full text-sm transition-all min-h-[36px]
        <%= active ? 'bg-brand-50 dark:bg-brand-600/20 border border-brand-200 dark:border-brand-700' : 'hover:bg-slate-50 dark:hover:bg-slate-700 border border-transparent' %>"
        data-post-id="<%= post.id %>" data-emoji="<%= emoji %>">
        <span><%= emoji %></span>
        <span class="reaction-count text-xs text-slate-500 dark:text-slate-400 <%= count === 0 ? 'hidden' : '' %>"><%= count %></span>
      </button>
      <% }) %>

      <div class="relative ml-1">
        <button class="emoji-picker-toggle p-1.5 rounded-full text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 text-sm min-h-[36px] min-w-[36px]" data-post-id="<%= post.id %>">＋</button>
        <div class="emoji-picker hidden absolute bottom-10 left-0 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-2xl shadow-xl p-2 z-20 grid grid-cols-4 gap-1 w-40">
          <% ['🎉','🙏','🔥','💯','🫶','👏','🥳','😍','🤣','😭','💪','🎂','🌟','👀','🤔','💔'].forEach(e => { %>
          <button class="reaction-btn text-lg p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors min-h-[40px]" data-post-id="<%= post.id %>" data-emoji="<%= e %>"><%= e %></button>
          <% }) %>
        </div>
      </div>

      <a href="/post/<%= post.id %>" class="ml-auto flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-full border border-slate-200 dark:border-slate-600 text-brand-600 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-900/20 transition-colors min-h-[32px] whitespace-nowrap">
        💬 <%= post.comment_count > 0 ? post.comment_count + (post.comment_count !== 1 ? ' comments' : ' comment') : 'Add a comment' %>
      </a>
    </div>

    <%# Reaction names summary line %>
    <%
      const _rn = (reactionNames && reactionNames[post.id]) ? reactionNames[post.id] : {};
      const _emojiOrder = ['❤️','👍','😂','😮','😢','🎉','🙏','🔥','💯','🫶','👏','🥳','😍','🤣','😭','💪','🎂','🌟','👀','🤔','💔'];
      const _summaryParts = _emojiOrder
        .filter(e => _rn[e] && _rn[e].length > 0)
        .map(e => {
          const ns = _rn[e];
          if (ns.length <= 2) return e + ' ' + ns.join(', ');
          return e + ' ' + ns.slice(0, 2).join(', ') + ' and ' + (ns.length - 2) + ' other' + (ns.length - 2 > 1 ? 's' : '');
        });
    %>
    <% if (_summaryParts.length) { %>
    <p class="text-xs text-slate-400 dark:text-slate-500 mt-1.5 leading-relaxed"><%= _summaryParts.join(' · ') %></p>
    <% } %>
  </div>

  <%# Latest comment preview %>
  <% if (latestCommentByPost && latestCommentByPost[post.id]) {
    const _lc = latestCommentByPost[post.id]; %>
  <div class="px-4 py-2.5 border-t border-slate-100 dark:border-slate-700 flex gap-2 items-start">
    <% if (_lc.author_avatar) { %>
    <img src="<%= _lc.author_avatar %>" class="w-6 h-6 rounded-full object-cover flex-shrink-0 mt-0.5" alt="">
    <% } else { %>
    <div class="w-6 h-6 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-300 font-semibold text-xs flex-shrink-0 mt-0.5">
      <%= _lc.author_name.charAt(0).toUpperCase() %>
    </div>
    <% } %>
    <div class="min-w-0 flex-1">
      <a href="/member/<%= _lc.author_id %>" class="text-xs font-semibold text-slate-700 dark:text-slate-200 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"><%= _lc.author_name %></a>
      <p class="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 break-words"><%= _lc.content %></p>
    </div>
  </div>
  <% } %>

  <%# Inline comment form %>
  <div class="px-4 py-2.5 border-t border-slate-100 dark:border-slate-700">
    <form method="POST" action="/posts/<%= post.id %>/comments" class="flex gap-2">
      <input type="text" name="content" placeholder="Add a comment..." required
        class="flex-1 min-w-0 border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 placeholder-slate-400 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-brand-600 min-h-[36px]">
      <button type="submit" class="bg-brand-600 text-white text-xs font-medium px-3 rounded-lg hover:bg-brand-700 transition-colors min-h-[36px] shrink-0">Send</button>
    </form>
  </div>
  ```

- [ ] **Step 3: Verify — reload the feed in a browser**

  Posts with reactions should show the summary line (e.g. "❤️ Sarah, Mom"). Posts with comments should show a "💬 3 comments" pill and the latest comment below. All posts should show the inline comment form. No JS errors in the browser console.

---

## Task 3: Make comment redirect referer-aware

**Files:**
- Modify: `src/routes/comments.js`

- [ ] **Step 1: Change the POST `/posts/:id/comments` redirect**

  Find the line at the end of the route handler:
  ```js
  res.redirect(`/post/${req.params.id}`);
  ```

  Replace it with:
  ```js
  const ref = req.get('Referer') || '';
  try {
    const refPath = new URL(ref).pathname;
    if (refPath === '/' || refPath.match(/^\/member\/\d+$/)) {
      return res.redirect(refPath);
    }
  } catch {}
  res.redirect(`/post/${req.params.id}`);
  ```

- [ ] **Step 2: Verify — submit the inline comment form on the feed**

  After submitting a comment from the feed card, the browser should stay on `/` (the feed), and the new comment should now appear as the latest comment preview on that post card.

---

## Task 4: Long-press bottom sheet in app.js

**Files:**
- Modify: `src/public/js/app.js`

- [ ] **Step 1: Insert bottom sheet setup code before the `// Reaction tooltip` comment**

  Find the line `// Reaction tooltip` and insert the following block directly before it:

  ```js
  // Reaction names bottom sheet (mobile long-press)
  const _reactionSheet = document.createElement('div');
  _reactionSheet.id = 'reaction-sheet';
  _reactionSheet.className = 'fixed inset-x-0 bottom-0 z-50 bg-white dark:bg-slate-800 rounded-t-2xl shadow-2xl border-t border-slate-200 dark:border-slate-700 p-5 translate-y-full transition-transform duration-300';
  _reactionSheet.innerHTML = '<div class="flex items-center justify-between mb-4"><h3 class="font-semibold text-slate-700 dark:text-slate-200 text-sm">Reactions</h3><button id="reaction-sheet-close" class="text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 text-xl min-h-[36px] min-w-[36px] flex items-center justify-center">✕</button></div><div id="reaction-sheet-content" class="space-y-3 max-h-64 overflow-y-auto"></div>';
  document.body.appendChild(_reactionSheet);

  let _sheetOverlay = null;
  let _longPressActive = false;

  function _showReactionSheet(names) {
    const content = document.getElementById('reaction-sheet-content');
    content.innerHTML = '';
    const order = ['❤️','👍','😂','😮','😢','🎉','🙏','🔥','💯','🫶','👏','🥳','😍','🤣','😭','💪','🎂','🌟','👀','🤔','💔'];
    order.filter(e => names[e]?.length).forEach(e => {
      const div = document.createElement('div');
      div.className = 'flex items-start gap-3';
      div.innerHTML = `<span class="text-xl leading-none">${e}</span><p class="text-sm text-slate-700 dark:text-slate-200">${names[e].join(', ')}</p>`;
      content.appendChild(div);
    });
    _sheetOverlay = document.createElement('div');
    _sheetOverlay.className = 'fixed inset-0 z-40 bg-black/30';
    document.body.appendChild(_sheetOverlay);
    _sheetOverlay.addEventListener('click', _hideReactionSheet);
    requestAnimationFrame(() => _reactionSheet.classList.remove('translate-y-full'));
  }

  function _hideReactionSheet() {
    _reactionSheet.classList.add('translate-y-full');
    if (_sheetOverlay) { _sheetOverlay.remove(); _sheetOverlay = null; }
  }

  document.getElementById('reaction-sheet-close').addEventListener('click', _hideReactionSheet);
  ```

- [ ] **Step 2: Replace the reaction button `forEach` block with the long-press-aware version**

  Find the entire block starting with `// Reactions` and `document.querySelectorAll('.reaction-btn').forEach(btn => {` (not the one inside `.emoji-picker`). Replace the existing `click` listener and add the touch listeners. The full updated forEach:

  ```js
  // Reactions
  document.querySelectorAll('.reaction-btn').forEach(btn => {
    const postId = btn.dataset.postId;
    const emoji = btn.dataset.emoji;

    btn.addEventListener('mouseenter', async () => {
      const countEl = btn.querySelector('.reaction-count');
      if (countEl?.classList.contains('hidden')) return;
      const names = await fetchReactionNames(postId);
      const list = names[emoji];
      if (list?.length) showTooltip(list.join(', '), btn);
    });

    btn.addEventListener('mouseleave', hideTooltip);

    // Long-press for mobile (500ms hold → bottom sheet with all reactors)
    let _pressTimer = null;
    btn.addEventListener('touchstart', () => {
      _pressTimer = setTimeout(() => {
        _pressTimer = null;
        _longPressActive = true;
        const article = btn.closest('article');
        if (!article) return;
        try { _showReactionSheet(JSON.parse(article.dataset.reactionNames || '{}')); } catch {}
      }, 500);
    }, { passive: true });
    btn.addEventListener('touchmove', () => {
      if (_pressTimer) { clearTimeout(_pressTimer); _pressTimer = null; }
    }, { passive: true });
    btn.addEventListener('touchend', () => {
      if (_pressTimer) { clearTimeout(_pressTimer); _pressTimer = null; }
    }, { passive: true });

    btn.addEventListener('click', () => {
      if (_longPressActive) { _longPressActive = false; return; }
      handleReactionClick(postId, emoji);
    });
  });
  ```

- [ ] **Step 3: Verify on mobile (or browser DevTools touch emulation)**

  Open the feed. Long-press (hold ~0.5s) on any emoji button that has a non-zero count. A bottom sheet should slide up from the bottom listing who reacted. Tapping outside or the ✕ button should dismiss it. A short tap should still toggle the reaction as before.

---

## Task 5: Extend post detail with reaction names

**Files:**
- Modify: `src/routes/posts.js` (GET `/post/:id` handler, lines 90–143)
- Modify: `src/views/post.ejs`

- [ ] **Step 1: Add reaction names query in the post detail handler**

  In `GET /post/:id`, find this block:
  ```js
  const reactionMap = {};
  reactions.forEach(r => { reactionMap[r.emoji] = { count: r.count, userReacted: r.user_reacted === 1 }; });
  ```

  Add directly below it:
  ```js
  const [reactionNameRows] = await pool.query(`
    SELECT r.emoji, u.name
    FROM reactions r JOIN users u ON r.user_id = u.id
    WHERE r.post_id = ?
    ORDER BY r.emoji, u.name
  `, [post.id]);
  const reactionNames = {};
  reactionNameRows.forEach(r => {
    if (!reactionNames[r.emoji]) reactionNames[r.emoji] = [];
    reactionNames[r.emoji].push(r.name);
  });
  ```

- [ ] **Step 2: Pass `reactionNames` to the post render call**

  Change:
  ```js
  res.render('post', { post, reactions: reactionMap, comments: topLevel });
  ```
  To:
  ```js
  res.render('post', { post, reactions: reactionMap, comments: topLevel, reactionNames });
  ```

- [ ] **Step 3: Add `data-reaction-names` to the article element in `post.ejs`**

  Find the opening `<article>` tag and change it from:
  ```html
  <article class="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden" data-post-id="<%= post.id %>">
  ```
  To:
  ```html
  <article class="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden" data-post-id="<%= post.id %>" data-reaction-names="<%= JSON.stringify(reactionNames || {}) %>">
  ```

- [ ] **Step 4: Add the summary line in `post.ejs` reactions section**

  In `post.ejs`, find the reactions `<div class="px-5 py-3 border-t ...">`. After the emoji picker's closing `</div>` and before the closing `</div>` of the reactions section, add:

  ```ejs
    <%# Reaction names summary line %>
    <%
      const _allEmojis = ['❤️','👍','😂','😮','😢','🎉','🙏','🔥','💯','🫶','👏','🥳','😍','🤣','😭','💪','🎂','🌟','👀','🤔','💔'];
      const _summaryParts = _allEmojis
        .filter(e => reactionNames[e] && reactionNames[e].length > 0)
        .map(e => {
          const ns = reactionNames[e];
          if (ns.length <= 2) return e + ' ' + ns.join(', ');
          return e + ' ' + ns.slice(0, 2).join(', ') + ' and ' + (ns.length - 2) + ' other' + (ns.length - 2 > 1 ? 's' : '');
        });
    %>
    <% if (_summaryParts.length) { %>
    <p class="text-xs text-slate-400 dark:text-slate-500 mt-1.5 leading-relaxed"><%= _summaryParts.join(' · ') %></p>
    <% } %>
  ```

- [ ] **Step 5: Verify — load a post detail page that has reactions**

  The summary line should appear below the emoji buttons. Long-press on mobile should open the bottom sheet (same JS runs on this page too since `app.js` is loaded).

---

## Task 6: Create the member profile route

**Files:**
- Create: `src/routes/members.js`

- [ ] **Step 1: Create `src/routes/members.js`**

  ```js
  const express = require('express');
  const router = express.Router();
  const { pool } = require('../db');
  const { requireAuth } = require('../middleware/auth');

  router.get('/member/:id', requireAuth, async (req, res) => {
    try {
      const memberId = parseInt(req.params.id);
      if (!memberId) return res.render('error', { message: 'Member not found.' });

      const [[profileUser]] = await pool.query(
        'SELECT id, name, avatar_url, created_at FROM users WHERE id = ? AND active = 1',
        [memberId]
      );
      if (!profileUser) return res.render('error', { message: 'Member not found.' });

      const [posts] = await pool.query(`
        SELECT p.*, u.name AS author_name, u.avatar_url AS author_avatar,
          (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count,
          lp.og_title, lp.og_description, lp.og_image, lp.url AS preview_url
        FROM posts p
        JOIN users u ON p.user_id = u.id
        LEFT JOIN link_previews lp ON lp.post_id = p.id
        WHERE p.user_id = ? AND (p.publish_at IS NULL OR p.publish_at <= NOW() OR p.user_id = ?)
        ORDER BY p.created_at DESC
      `, [memberId, req.session.user.id]);

      posts.forEach(p => { p.photos = []; });
      let reactionsByPost = {};
      let reactionNames = {};
      let latestCommentByPost = {};

      if (posts.length) {
        const ids = posts.map(p => p.id);
        const userId = req.session.user.id;

        const [reactions] = await pool.query(`
          SELECT post_id, emoji, COUNT(*) AS count,
            MAX(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS user_reacted
          FROM reactions WHERE post_id IN (?)
          GROUP BY post_id, emoji
        `, [userId, ids]);
        reactions.forEach(r => {
          if (!reactionsByPost[r.post_id]) reactionsByPost[r.post_id] = {};
          reactionsByPost[r.post_id][r.emoji] = { count: r.count, userReacted: r.user_reacted === 1 };
        });

        const [nameRows] = await pool.query(`
          SELECT r.post_id, r.emoji, u.name
          FROM reactions r JOIN users u ON r.user_id = u.id
          WHERE r.post_id IN (?)
          ORDER BY r.post_id, r.emoji, u.name
        `, [ids]);
        nameRows.forEach(r => {
          if (!reactionNames[r.post_id]) reactionNames[r.post_id] = {};
          if (!reactionNames[r.post_id][r.emoji]) reactionNames[r.post_id][r.emoji] = [];
          reactionNames[r.post_id][r.emoji].push(r.name);
        });

        const [photoRows] = await pool.query(
          'SELECT post_id, photo_url FROM post_photos WHERE post_id IN (?) ORDER BY sort_order',
          [ids]
        );
        photoRows.forEach(ph => {
          const post = posts.find(p => p.id === ph.post_id);
          if (post) post.photos.push(ph.photo_url);
        });

        const [latestCommentRows] = await pool.query(`
          SELECT c.post_id, c.content, u.name AS author_name, u.avatar_url AS author_avatar, u.id AS author_id
          FROM comments c JOIN users u ON c.user_id = u.id
          WHERE c.id IN (SELECT MAX(id) FROM comments WHERE post_id IN (?) GROUP BY post_id)
        `, [ids]);
        latestCommentRows.forEach(c => { latestCommentByPost[c.post_id] = c; });
      }

      res.render('member', { profileUser, posts, reactionsByPost, reactionNames, latestCommentByPost });
    } catch (err) {
      console.error(err);
      res.render('error', { message: 'Could not load member page.' });
    }
  });

  module.exports = router;
  ```

---

## Task 7: Create the member profile view

**Files:**
- Create: `src/views/member.ejs`

- [ ] **Step 1: Create `src/views/member.ejs`**

  ```ejs
  <%- include('partials/head', { title: profileUser.name }) %>
  <%- include('partials/nav') %>

  <div class="max-w-2xl mx-auto px-4 py-6 space-y-4">
    <a href="/" class="text-sm text-slate-400 dark:text-slate-500 hover:text-brand-600 dark:hover:text-brand-400 transition-colors">← Feed</a>

    <div class="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-5 flex items-center gap-4">
      <% if (profileUser.avatar_url) { %>
      <img src="<%= profileUser.avatar_url %>" class="w-16 h-16 rounded-full object-cover flex-shrink-0" alt="">
      <% } else { %>
      <div class="w-16 h-16 rounded-full bg-brand-100 dark:bg-brand-600/20 flex items-center justify-center text-brand-600 dark:text-brand-400 font-bold text-2xl flex-shrink-0">
        <%= profileUser.name.charAt(0).toUpperCase() %>
      </div>
      <% } %>
      <div>
        <h1 class="text-lg font-bold text-slate-800 dark:text-slate-100"><%= profileUser.name %></h1>
        <p class="text-sm text-slate-400 dark:text-slate-500">Member since <%= new Date(profileUser.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) %></p>
        <p class="text-sm text-slate-400 dark:text-slate-500"><%= posts.length %> post<%= posts.length !== 1 ? 's' : '' %></p>
      </div>
    </div>

    <% if (!posts.length) { %>
    <p class="text-center text-slate-400 dark:text-slate-500 py-8">No posts yet.</p>
    <% } %>

    <% posts.forEach(post => { const isScheduled = post.publish_at && new Date(post.publish_at) > new Date(); %>
    <%- include('partials/post-card', { post, isScheduled, reactionsByPost, reactionNames, latestCommentByPost }) %>
    <% }) %>
  </div>

  <script src="/js/app.js"></script>
  </body></html>
  ```

---

## Task 8: Register route, link author names, commit and deploy

**Files:**
- Modify: `src/app.js`
- Modify: `src/views/partials/post-card.ejs`
- Modify: `src/views/post.ejs`

- [ ] **Step 1: Register the members route in `src/app.js`**

  Find the line:
  ```js
  app.use('/admin', require('./routes/admin'));
  ```
  Add directly below it:
  ```js
  app.use('/', require('./routes/members'));
  ```

- [ ] **Step 2: Link the author name/avatar in `post-card.ejs`**

  In `post-card.ejs`, find the author header block (around line 14–23):
  ```html
  <div class="flex items-center gap-2">
    <% if (post.author_avatar) { %>
    <img src="<%= post.author_avatar %>" class="w-9 h-9 rounded-full object-cover flex-shrink-0" alt="">
    <% } else { %>
    <div class="w-9 h-9 rounded-full bg-brand-100 dark:bg-brand-600/20 flex items-center justify-center text-brand-600 dark:text-brand-400 font-semibold text-sm flex-shrink-0">
      <%= post.author_name.charAt(0).toUpperCase() %>
    </div>
    <% } %>
    <div>
      <p class="text-sm font-semibold text-slate-800 dark:text-slate-100"><%= post.author_name %></p>
      <p class="text-xs text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
  ```

  Wrap the avatar and name in a link by replacing with:
  ```html
  <a href="/member/<%= post.user_id %>" class="flex items-center gap-2 hover:opacity-80 transition-opacity">
    <% if (post.author_avatar) { %>
    <img src="<%= post.author_avatar %>" class="w-9 h-9 rounded-full object-cover flex-shrink-0" alt="">
    <% } else { %>
    <div class="w-9 h-9 rounded-full bg-brand-100 dark:bg-brand-600/20 flex items-center justify-center text-brand-600 dark:text-brand-400 font-semibold text-sm flex-shrink-0">
      <%= post.author_name.charAt(0).toUpperCase() %>
    </div>
    <% } %>
    <p class="text-sm font-semibold text-slate-800 dark:text-slate-100"><%= post.author_name %></p>
  </a>
  <div>
    <p class="text-xs text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
  ```
  And close the new `<div>` after the timestamp paragraph's closing `</p>`:
  ```html
    </p>
  </div>
  ```

  (The timestamp + edited/scheduled indicator remain inside the inner `<div>`; only the name moves inside the `<a>`.)

- [ ] **Step 3: Link the author name/avatar in `post.ejs`**

  Find the author header block in `post.ejs` (around lines 20–30). Apply the same wrapping — avatar and name inside `<a href="/member/<%= post.user_id %>">`. The timestamp/edited/seen-by line stays outside the link in its own div.

- [ ] **Step 4: Link comment author names in `post.ejs`**

  In `post.ejs`, find each comment's author name render. There are two places — top-level comments and replies. In both, the commenter name is:
  ```html
  <p class="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-0.5"><%= comment.author_name %></p>
  ```
  And for replies:
  ```html
  <p class="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-0.5"><%= reply.author_name %></p>
  ```

  Change both to links:
  ```html
  <a href="/member/<%= comment.user_id %>" class="text-xs font-semibold text-slate-700 dark:text-slate-200 hover:text-brand-600 dark:hover:text-brand-400 transition-colors mb-0.5 block"><%= comment.author_name %></a>
  ```
  And for replies:
  ```html
  <a href="/member/<%= reply.user_id %>" class="text-xs font-semibold text-slate-700 dark:text-slate-200 hover:text-brand-600 dark:hover:text-brand-400 transition-colors mb-0.5 block"><%= reply.author_name %></a>
  ```

- [ ] **Step 5: Verify end-to-end**

  1. Load feed — author name/avatar should be tappable links.
  2. Tap an author name — navigates to `/member/:id` showing their posts only with header (name, avatar, member since, post count).
  3. Load a post detail page — author name is a link, commenter names are links.
  4. Long-press an emoji on mobile — bottom sheet appears.
  5. Submit inline comment from feed — stays on feed, comment preview updates on reload.

- [ ] **Step 6: Commit**

  ```bash
  cd /home/jmull/projects/family-news
  git add src/routes/posts.js src/routes/comments.js src/routes/members.js src/app.js \
    src/views/feed.ejs src/views/partials/post-card.ejs src/views/post.ejs src/views/member.ejs \
    src/public/js/app.js
  git commit -m "Add reaction names on mobile, comment prominence, and member profile pages"
  ```

- [ ] **Step 7: Push and deploy**

  ```bash
  git push origin main
  ```

  Wait for GitHub Actions build to complete (poll `https://api.github.com/repos/Jonathan-Mullet/family-news/actions/runs?per_page=1`), then:

  ```bash
  cd /home/jmull/docker && docker compose pull family-news && docker compose up -d family-news
  ```
