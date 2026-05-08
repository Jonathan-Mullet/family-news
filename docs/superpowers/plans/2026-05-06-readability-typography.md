# Readability & Typography Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise body copy from 14px to 16px and metadata from 12px to 14px across the whole site, with 18px post body on the post detail page, using surgical Tailwind class swaps.

**Architecture:** Pure template and CSS edits — no routes, no JS, no data changes. Every change is a Tailwind class swap (`text-xs` → `text-sm`, `text-sm` → `text-base`, add `text-lg`). Three files hold 95% of the work: `post-card.ejs`, `post.ejs`, and `theme.css`. Two minor files round out the rest.

**Tech Stack:** EJS templates, Tailwind CDN (all standard classes available), custom `theme.css`.

---

## File Map

| File | Change |
|------|--------|
| `src/public/css/theme.css` | `.fn-reply-toggle` font-size `0.75rem` → `0.875rem` |
| `src/views/profile.ejs` | One amber notice `text-xs` → `text-sm` |
| `src/views/partials/post-card.ejs` | Post body `text-sm`→`text-base`; metadata/UI `text-xs`→`text-sm`; comment content `text-sm`→`text-base` |
| `src/views/post.ejs` | Post body add `text-lg`; comments/replies `text-sm`→`text-base`, metadata `text-xs`→`text-sm` |

**What stays the same (do not touch):**
- Avatar initial-letter divs (the tiny letters inside avatar circles) — they're decorative, not reading content
- "Big News" and "Announcement" badge strips at top of cards — status indicators, intentionally compact
- Edit-toggle icon button (pencil emoji) — icon button, not text
- Edit/compose form inputs and textareas — `text-sm` is fine for writing
- Admin/mod pages — functional UIs, not in scope

---

## Task 1: theme.css and profile.ejs

**Files:**
- Modify: `src/public/css/theme.css`
- Modify: `src/views/profile.ejs`

No TDD for CSS/template changes — verify with grep counts and a server smoke test.

- [ ] **Step 1: Bump `.fn-reply-toggle` font-size in theme.css**

Find this line in `src/public/css/theme.css` (in the `.fn-reply-toggle` rule):
```css
  font-size: 0.75rem;
```
Replace with:
```css
  font-size: 0.875rem;
```

Verify with:
```bash
grep "fn-reply-toggle" src/public/css/theme.css -A 10 | grep font-size
```
Expected: `font-size: 0.875rem;`

- [ ] **Step 2: Bump amber notice in profile.ejs**

In `src/views/profile.ejs` find (line ~179):
```html
    <div id="push-email-notice" class="hidden mt-3 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-3">
```
Replace `text-xs` with `text-sm`:
```html
    <div id="push-email-notice" class="hidden mt-3 text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-3">
```

- [ ] **Step 3: Smoke-test server starts**

```bash
node src/app.js &
sleep 2
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/
kill %1
```
Expected: `302` or `200`. Any `500` means a crash — check logs.

- [ ] **Step 4: Commit**

```bash
git add src/public/css/theme.css src/views/profile.ejs
git commit -m "style: bump reply toggle and profile notice font sizes"
```

---

## Task 2: post-card.ejs

**Files:**
- Modify: `src/views/partials/post-card.ejs`

This file renders every post card on the feed and member pages. Changes:
- Post body: `text-sm` → `text-base` (14→16px)
- Comment content (top-level and replies): `text-sm` → `text-base` (14→16px)
- All metadata, UI labels, action links: `text-xs` → `text-sm` (12→14px)
- Avatar initial letters and badge strips: **leave as-is**

- [ ] **Step 1: Check current text-xs count**

```bash
grep -c "text-xs" src/views/partials/post-card.ejs
```
Expected: `21`. Note this number — after all changes it should drop to 4 (the 4 avatar initials + badge strips we intentionally keep).

- [ ] **Step 2: Bump post body to text-base**

Find (line ~61):
```html
      <p class="text-slate-700 dark:text-slate-300 text-sm leading-relaxed whitespace-pre-wrap"><%- renderContent(post.content) %></p>
```
Replace:
```html
      <p class="text-slate-700 dark:text-slate-300 text-base leading-relaxed whitespace-pre-wrap"><%- renderContent(post.content) %></p>
```

- [ ] **Step 3: Bump edit Cancel and Save buttons**

Find (lines ~71–72):
```html
        <button type="button" class="edit-cancel text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 px-3 py-1.5 border border-slate-200 dark:border-slate-600 rounded-lg transition-colors" data-post-id="<%= post.id %>">Cancel</button>
        <button type="submit" class="text-xs bg-brand-600 hover:bg-brand-700 text-white px-3 py-1.5 rounded-lg transition-colors font-medium">Save</button>
```
Replace both `text-xs` with `text-sm`:
```html
        <button type="button" class="edit-cancel text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 px-3 py-1.5 border border-slate-200 dark:border-slate-600 rounded-lg transition-colors" data-post-id="<%= post.id %>">Cancel</button>
        <button type="submit" class="text-sm bg-brand-600 hover:bg-brand-700 text-white px-3 py-1.5 rounded-lg transition-colors font-medium">Save</button>
```

- [ ] **Step 4: Bump post timestamp/location line**

Find (line ~26):
```html
          <p class="text-xs text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
```
Replace:
```html
          <p class="text-sm text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
```

- [ ] **Step 5: Bump OG description**

Find (line ~117):
```html
        <% if (post.og_description) { %><p class="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 mt-0.5"><%= post.og_description %></p><% } %>
```
Replace:
```html
        <% if (post.og_description) { %><p class="text-sm text-slate-500 dark:text-slate-400 line-clamp-2 mt-0.5"><%= post.og_description %></p><% } %>
```

- [ ] **Step 6: Bump reaction count and emoji picker toggle**

Find (line ~152):
```html
        <span class="reaction-count text-xs font-medium text-slate-500 dark:text-slate-400"><%= r.count %></span>
```
Replace:
```html
        <span class="reaction-count text-sm font-medium text-slate-500 dark:text-slate-400"><%= r.count %></span>
```

Find (line ~157, the emoji-picker-toggle button — starts with):
```html
      <button class="emoji-picker-toggle flex items-center gap-1 text-xs text-slate-400
```
Replace `text-xs` with `text-sm` in that button's class list:
```html
      <button class="emoji-picker-toggle flex items-center gap-1 text-sm text-slate-400
```

- [ ] **Step 7: Bump reaction summary line**

Find (line ~168):
```html
    <button class="reaction-summary text-xs text-slate-400 dark:text-slate-500 mt-1 py-1 leading-relaxed text-left w-full hover:text-slate-600 dark:hover:text-slate-300 transition-colors"><%= _summaryParts.join(' · ') %></button>
```
Replace `text-xs` with `text-sm`:
```html
    <button class="reaction-summary text-sm text-slate-400 dark:text-slate-500 mt-1 py-1 leading-relaxed text-left w-full hover:text-slate-600 dark:hover:text-slate-300 transition-colors"><%= _summaryParts.join(' · ') %></button>
```

- [ ] **Step 8: Bump pill input and send button (State A — no comments)**

Find (line ~185, the fn-comment-pill input):
```html
          class="fn-comment-pill flex-1 min-w-0 border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 placeholder-slate-400 italic rounded-full px-4 py-2 text-xs focus:outline-none transition-colors min-h-[36px]">
```
Replace `text-xs` with `text-sm`:
```html
          class="fn-comment-pill flex-1 min-w-0 border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 placeholder-slate-400 italic rounded-full px-4 py-2 text-sm focus:outline-none transition-colors min-h-[36px]">
```

Find (line ~187, the Send button):
```html
          class="fn-comment-send--hidden bg-brand-600 text-white text-xs font-medium px-3 rounded-full hover:bg-brand-700 transition-colors min-h-[36px] shrink-0">Send</button>
```
Replace `text-xs` with `text-sm`:
```html
          class="fn-comment-send--hidden bg-brand-600 text-white text-sm font-medium px-3 rounded-full hover:bg-brand-700 transition-colors min-h-[36px] shrink-0">Send</button>
```

- [ ] **Step 9: Bump comment toggle label (State B)**

Find (line ~196):
```html
      class="text-xs font-semibold text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 transition-colors">
```
Replace `text-xs` with `text-sm`:
```html
      class="text-sm font-semibold text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 transition-colors">
```

- [ ] **Step 10: Bump top-level comment author name, content, and metadata**

Find the comment author name span (line ~210):
```html
          <span class="text-xs font-semibold text-slate-700 dark:text-slate-200"><%= comment.author_name %></span>
```
Replace `text-xs` with `text-sm`:
```html
          <span class="text-sm font-semibold text-slate-700 dark:text-slate-200"><%= comment.author_name %></span>
```

Find the comment content span (line ~211):
```html
          <span class="text-sm text-slate-500 dark:text-slate-400 ml-1 break-words"><%- renderContent(comment.content) %></span>
```
Replace `text-sm` with `text-base`:
```html
          <span class="text-base text-slate-500 dark:text-slate-400 ml-1 break-words"><%- renderContent(comment.content) %></span>
```

Find the comment timestamp (line ~213):
```html
            <time data-ts="<%= new Date(comment.created_at).toISOString() %>" data-fmt="compact" class="text-xs text-slate-400 dark:text-slate-500"></time>
```
Replace `text-xs` with `text-sm`:
```html
            <time data-ts="<%= new Date(comment.created_at).toISOString() %>" data-fmt="compact" class="text-sm text-slate-400 dark:text-slate-500"></time>
```

Find the Reply link (line ~214):
```html
            <a href="/post/<%= post.id %>" class="text-xs text-brand-600 dark:text-brand-400 hover:underline">Reply</a>
```
Replace `text-xs` with `text-sm`:
```html
            <a href="/post/<%= post.id %>" class="text-sm text-brand-600 dark:text-brand-400 hover:underline">Reply</a>
```

- [ ] **Step 11: Bump reply author name, content, and timestamp**

Find reply author name (line ~225):
```html
              <span class="text-xs font-semibold text-slate-700 dark:text-slate-200"><%= reply.author_name %></span>
```
Replace `text-xs` with `text-sm`:
```html
              <span class="text-sm font-semibold text-slate-700 dark:text-slate-200"><%= reply.author_name %></span>
```

Find reply content (line ~226):
```html
              <span class="text-sm text-slate-500 dark:text-slate-400 ml-1 break-words"><%- renderContent(reply.content) %></span>
```
Replace `text-sm` with `text-base`:
```html
              <span class="text-base text-slate-500 dark:text-slate-400 ml-1 break-words"><%- renderContent(reply.content) %></span>
```

Find reply timestamp (line ~227):
```html
              <time data-ts="<%= new Date(reply.created_at).toISOString() %>" data-fmt="compact" class="text-xs text-slate-400 dark:text-slate-500 block mt-0.5"></time>
```
Replace `text-xs` with `text-sm`:
```html
              <time data-ts="<%= new Date(reply.created_at).toISOString() %>" data-fmt="compact" class="text-sm text-slate-400 dark:text-slate-500 block mt-0.5"></time>
```

- [ ] **Step 12: Bump expanded comment form input and send button**

Find comment form input (line ~237):
```html
          class="mention-input flex-1 min-w-0 border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 placeholder-slate-400 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-600 min-h-[32px]">
```
Replace `text-xs` with `text-sm`:
```html
          class="mention-input flex-1 min-w-0 border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 placeholder-slate-400 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600 min-h-[32px]">
```

Find send button (line ~238):
```html
        <button type="submit" class="bg-brand-600 text-white text-xs font-medium px-3 rounded-lg hover:bg-brand-700 transition-colors min-h-[32px] shrink-0">Send</button>
```
Replace `text-xs` with `text-sm`:
```html
        <button type="submit" class="bg-brand-600 text-white text-sm font-medium px-3 rounded-lg hover:bg-brand-700 transition-colors min-h-[32px] shrink-0">Send</button>
```

- [ ] **Step 13: Verify final text-xs count**

```bash
grep -n "text-xs" src/views/partials/post-card.ejs
```

Expected remaining `text-xs` lines (these are the ones we intentionally left):
- Line ~3: Big News badge strip
- Line ~7: Announcement badge strip  
- Line ~50: edit-toggle icon button
- Line ~207: avatar initial letter div

If any other lines still show `text-xs`, re-read those lines and apply the bump.

- [ ] **Step 14: Commit**

```bash
git add src/views/partials/post-card.ejs
git commit -m "style: bump post-card typography — body to 16px, metadata to 14px"
```

---

## Task 3: post.ejs

**Files:**
- Modify: `src/views/post.ejs`

Post detail page. Changes:
- Post body: add `text-lg` (no current text size — inherits browser default, we want explicit 18px)
- Comment and reply content: `text-sm` → `text-base` (3 occurrences — visible replies, overflow replies)
- All metadata, author names, action links: `text-xs` → `text-sm`
- Avatar initial letters, badge strips, icon buttons: **leave as-is**

- [ ] **Step 1: Check current text-xs count**

```bash
grep -c "text-xs" src/views/post.ejs
```
Expected: `23`. After all changes it should drop to 5 (2 badge strips + 1 edit-toggle icon + 2 avatar initial divs in the overflow reply block).

- [ ] **Step 2: Add text-lg to post body**

Find (line ~66):
```html
        <p class="text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap"><%- renderContent(post.content) %></p>
```
Replace — add `text-lg` before `leading-relaxed`:
```html
        <p class="text-lg text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap"><%- renderContent(post.content) %></p>
```

- [ ] **Step 3: Bump edit Cancel and Save buttons**

Find (lines ~75–76):
```html
          <button type="button" class="edit-cancel text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 px-3 py-1.5 border border-slate-200 dark:border-slate-600 rounded-lg transition-colors" data-post-id="<%= post.id %>">Cancel</button>
          <button type="submit" class="text-xs bg-brand-600 hover:bg-brand-700 text-white px-3 py-1.5 rounded-lg transition-colors font-medium">Save</button>
```
Replace both `text-xs` with `text-sm`:
```html
          <button type="button" class="edit-cancel text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 px-3 py-1.5 border border-slate-200 dark:border-slate-600 rounded-lg transition-colors" data-post-id="<%= post.id %>">Cancel</button>
          <button type="submit" class="text-sm bg-brand-600 hover:bg-brand-700 text-white px-3 py-1.5 rounded-lg transition-colors font-medium">Save</button>
```

- [ ] **Step 4: Bump post timestamp/location line**

Find (line ~32):
```html
            <p class="text-xs text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
```
Replace:
```html
            <p class="text-sm text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
```

- [ ] **Step 5: Bump OG description**

Find (line ~119):
```html
          <% if (post.og_description) { %><p class="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 mt-0.5"><%= post.og_description %></p><% } %>
```
Replace:
```html
          <% if (post.og_description) { %><p class="text-sm text-slate-500 dark:text-slate-400 line-clamp-2 mt-0.5"><%= post.og_description %></p><% } %>
```

- [ ] **Step 6: Bump reaction count and reaction summary**

Find (line ~136):
```html
        <span class="reaction-count text-xs text-slate-500 dark:text-slate-400 <%= count === 0 ? 'hidden' : '' %>"><%= count %></span>
```
Replace:
```html
        <span class="reaction-count text-sm text-slate-500 dark:text-slate-400 <%= count === 0 ? 'hidden' : '' %>"><%= count %></span>
```

Find (line ~160):
```html
      <button class="reaction-summary text-xs text-slate-400 dark:text-slate-500 mt-1 py-1.5 leading-relaxed text-left w-full hover:text-slate-600 dark:hover:text-slate-300 transition-colors"><%= _summaryParts.join(' · ') %></button>
```
Replace `text-xs` with `text-sm`:
```html
      <button class="reaction-summary text-sm text-slate-400 dark:text-slate-500 mt-1 py-1.5 leading-relaxed text-left w-full hover:text-slate-600 dark:hover:text-slate-300 transition-colors"><%= _summaryParts.join(' · ') %></button>
```

- [ ] **Step 7: Bump comment author name, content, and metadata**

Find comment author name (line ~188):
```html
              <a href="/member/<%= comment.user_id %>" class="text-xs font-semibold text-slate-700 dark:text-slate-200 hover:text-brand-600 dark:hover:text-brand-400 transition-colors mb-0.5 block"><%= comment.author_name %></a>
```
Replace `text-xs` with `text-sm`:
```html
              <a href="/member/<%= comment.user_id %>" class="text-sm font-semibold text-slate-700 dark:text-slate-200 hover:text-brand-600 dark:hover:text-brand-400 transition-colors mb-0.5 block"><%= comment.author_name %></a>
```

Find comment content (line ~189):
```html
              <p class="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words"><%- renderContent(comment.content) %></p>
```
Replace `text-sm` with `text-base`:
```html
              <p class="text-base text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words"><%- renderContent(comment.content) %></p>
```

Find comment timestamp (line ~192):
```html
              <time data-ts="<%= new Date(comment.created_at).toISOString() %>" data-fmt="compact" class="text-xs text-slate-400 dark:text-slate-500"></time>
```
Replace `text-xs` with `text-sm`:
```html
              <time data-ts="<%= new Date(comment.created_at).toISOString() %>" data-fmt="compact" class="text-sm text-slate-400 dark:text-slate-500"></time>
```

Find Reply button (line ~193):
```html
              <button class="text-xs text-slate-400 dark:text-slate-500 hover:text-brand-600 dark:hover:text-brand-400 transition-colors reply-toggle min-h-[36px] px-1" data-target="reply-form-<%= comment.id %>">Reply</button>
```
Replace `text-xs` with `text-sm`:
```html
              <button class="text-sm text-slate-400 dark:text-slate-500 hover:text-brand-600 dark:hover:text-brand-400 transition-colors reply-toggle min-h-[36px] px-1" data-target="reply-form-<%= comment.id %>">Reply</button>
```

Find comment Delete button (line ~196):
```html
                <button type="submit" class="text-xs text-slate-400 dark:text-slate-500 hover:text-red-400 transition-colors min-h-[36px] px-1">Delete</button>
```
Replace `text-xs` with `text-sm` (this pattern appears 3 times — for the comment and both reply blocks, so apply to all occurrences):
```html
                <button type="submit" class="text-sm text-slate-400 dark:text-slate-500 hover:text-red-400 transition-colors min-h-[36px] px-1">Delete</button>
```

Find the inline reply Send button (line ~205):
```html
                <button type="submit" class="bg-brand-600 text-white text-xs font-medium px-3 py-2 rounded-lg hover:bg-brand-700 transition-colors min-h-[40px] shrink-0">Send</button>
```
Replace `text-xs` with `text-sm`:
```html
                <button type="submit" class="bg-brand-600 text-white text-sm font-medium px-3 py-2 rounded-lg hover:bg-brand-700 transition-colors min-h-[40px] shrink-0">Send</button>
```

- [ ] **Step 8: Bump visible reply author names, content, and timestamps (first-3 block)**

Find visible reply author name (line ~225):
```html
              <a href="/member/<%= reply.user_id %>" class="text-xs font-semibold text-slate-700 dark:text-slate-200 hover:text-brand-600 dark:hover:text-brand-400 transition-colors mb-0.5 block"><%= reply.author_name %></a>
```
Replace `text-xs` with `text-sm`:
```html
              <a href="/member/<%= reply.user_id %>" class="text-sm font-semibold text-slate-700 dark:text-slate-200 hover:text-brand-600 dark:hover:text-brand-400 transition-colors mb-0.5 block"><%= reply.author_name %></a>
```

Find visible reply content (line ~226):
```html
              <p class="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words"><%- renderContent(reply.content) %></p>
```
Replace `text-sm` with `text-base` — **this pattern appears twice** (once in the first-3 block, once in the overflow block). Apply to both:
```html
              <p class="text-base text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words"><%- renderContent(reply.content) %></p>
```

Find visible reply timestamp (line ~229):
```html
              <time data-ts="<%= new Date(reply.created_at).toISOString() %>" data-fmt="compact" class="text-xs text-slate-400 dark:text-slate-500"></time>
```
Replace `text-xs` with `text-sm` — **this pattern appears twice** (first-3 block and overflow block). Apply to both:
```html
              <time data-ts="<%= new Date(reply.created_at).toISOString() %>" data-fmt="compact" class="text-sm text-slate-400 dark:text-slate-500"></time>
```

- [ ] **Step 9: Bump overflow reply author names (overflow block)**

Find overflow reply author name (line ~263):
```html
                <a href="/member/<%= reply.user_id %>" class="text-xs font-semibold text-slate-700 dark:text-slate-200 hover:text-brand-600 dark:hover:text-brand-400 transition-colors mb-0.5 block"><%= reply.author_name %></a>
```
Replace `text-xs` with `text-sm`:
```html
                <a href="/member/<%= reply.user_id %>" class="text-sm font-semibold text-slate-700 dark:text-slate-200 hover:text-brand-600 dark:hover:text-brand-400 transition-colors mb-0.5 block"><%= reply.author_name %></a>
```

- [ ] **Step 10: Verify final text-xs count**

```bash
grep -n "text-xs" src/views/post.ejs
```

Expected remaining `text-xs` lines (intentionally kept):
- Line ~10: Big News badge strip
- Line ~14: Announcement badge strip
- Line ~56: edit-toggle icon button
- Line ~181: avatar initial div (comment)
- Line ~218: avatar initial div (first-3 replies)
- Line ~256: avatar initial div (overflow replies)

That's 6 remaining. Any extra lines still showing `text-xs` should be bumped to `text-sm` unless they match one of the above patterns.

- [ ] **Step 11: Smoke-test and verify post detail renders**

```bash
node src/app.js &
sleep 2
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/
kill %1
```
Expected: `302` or `200`.

- [ ] **Step 12: Commit**

```bash
git add src/views/post.ejs
git commit -m "style: bump post detail typography — body to 18px, comments to 16px, metadata to 14px"
```

---

## Self-review checklist (run before declaring done)

- [ ] `grep -c "text-xs" src/views/partials/post-card.ejs` → 4 or fewer
- [ ] `grep -c "text-xs" src/views/post.ejs` → 6 or fewer
- [ ] Server starts without 500 errors
- [ ] Feed page loads and post body text is visibly larger than before
- [ ] Post detail page loads and body text is noticeably larger than feed cards
- [ ] Comment text in both feed and detail is readable at arms length
- [ ] No visual clipping or overflow — text wraps correctly in card bounds
- [ ] Dark mode: text sizes consistent in dark mode (same classes, just color differs)
- [ ] Mobile: open on a phone or narrow browser window — cards don't overflow, text wraps cleanly
