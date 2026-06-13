# Comment Reactions + Inline Timestamps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move comment timestamps inline next to the author name, and add iMessage-style emoji reactions to comments (in-app + coalesced push notifications), with the same coalesced push added to post reactions.

**Architecture:** Mirror the existing post-reaction system (`reactions` table, `routes/reactions.js`, picker in `public/js/app.js`, `'reaction'` notification type). Add a `comment_reactions` table, a parallel API, a generalized picker, and a reusable in-memory push-coalescing layer shared by post + comment reactions.

**Tech Stack:** Node/Express, EJS, MySQL (mysql2 `pool`), web-push, `node --test` for unit tests (tests live in `src/utils/*.test.js`).

**Spec:** `docs/superpowers/specs/2026-06-12-comment-reactions-design.md`

**Conventions to follow:**
- DB changes go in `src/db.js` (CREATE TABLE in the init block; ALTERs in the idempotent `migrations` array — wrap in the existing try/catch that skips `ER_DUP_FIELDNAME`/duplicate errors).
- Notifications are raw `INSERT`s at call sites (no helper); always self-guard `actor !== recipient`.
- Pure, testable logic goes under `src/utils/` (so `npm test` picks it up); impure wiring (timers, push, DB) goes in `src/services/` or routes.
- Reaction routes are fire-and-forget for notifications/push (never block the JSON response).

---

### Task 1: Schema — `comment_reactions`, notification type, push pref column, shared emoji list

**Files:**
- Modify: `src/db.js` (init `CREATE TABLE` block + `migrations` array)
- Create: `src/utils/reactionEmoji.js`
- Test: `src/utils/reactionEmoji.test.js`

- [ ] **Step 1: Extract the shared emoji allowlist + test (write test first)**

Create `src/utils/reactionEmoji.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ALLOWED_EMOJI, QUICK_EMOJI, isAllowedEmoji } = require('./reactionEmoji');

test('allowlist contains the canonical 21 emojis', () => {
  assert.equal(ALLOWED_EMOJI.length, 21);
  assert.ok(ALLOWED_EMOJI.includes('❤️'));
});
test('quick set is the 6 iMessage-style emojis, all within the allowlist', () => {
  assert.deepEqual(QUICK_EMOJI, ['❤️', '👍', '😂', '😮', '😢', '🙏']);
  QUICK_EMOJI.forEach(e => assert.ok(ALLOWED_EMOJI.includes(e)));
});
test('isAllowedEmoji rejects non-listed input', () => {
  assert.equal(isAllowedEmoji('❤️'), true);
  assert.equal(isAllowedEmoji('🦄'), false);
  assert.equal(isAllowedEmoji(''), false);
});
```

- [ ] **Step 2: Run test, verify it fails** — `node --test src/utils/reactionEmoji.test.js` → FAIL (module missing).

- [ ] **Step 3: Create `src/utils/reactionEmoji.js`**
```js
// Single source of truth for permitted reaction emojis (posts + comments).
const ALLOWED_EMOJI = ['❤️', '👍', '😂', '😮', '😢', '🎉', '🙏', '🔥', '💯', '🫶', '👏', '🥳', '😍', '🤣', '😭', '💪', '🎂', '🌟', '👀', '🤔', '💔'];
// The 6 shown first in the iMessage-style quick bar.
const QUICK_EMOJI = ['❤️', '👍', '😂', '😮', '😢', '🙏'];
const isAllowedEmoji = (e) => ALLOWED_EMOJI.includes(e);
module.exports = { ALLOWED_EMOJI, QUICK_EMOJI, isAllowedEmoji };
```

- [ ] **Step 4: Run test, verify pass.**

- [ ] **Step 5: Add the table + migrations in `src/db.js`**
  - In the init block (near the existing `reactions` CREATE TABLE), add:
```sql
CREATE TABLE IF NOT EXISTS comment_reactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  comment_id INT NOT NULL,
  user_id INT NOT NULL,
  emoji VARCHAR(10) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_comment_reaction (comment_id, user_id, emoji),
  FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id)
)
```
  - In the `migrations` array (idempotent), add:
```js
`ALTER TABLE notifications MODIFY COLUMN type ENUM('comment','reply','mention','reaction','comment_reaction') NOT NULL`,
`ALTER TABLE users ADD COLUMN push_notify_reactions BOOLEAN DEFAULT 1`,
```
  (The existing migration loop's try/catch already swallows "column exists"/idempotent errors. Verify the ENUM `MODIFY` is safe to re-run — it is, it's declarative.)

- [ ] **Step 6: Verify the app boots** — `node -e "require('./src/db')"` style smoke or start the app locally; confirm no migration error in logs.

- [ ] **Step 7: Commit** — `feat(db): comment_reactions table, comment_reaction notif type, push_notify_reactions pref, shared emoji list`

---

### Task 2: Coalescing pure logic + tests

**Files:**
- Create: `src/utils/reactionCoalesce.js`
- Test: `src/utils/reactionCoalesce.test.js`

This module holds the PURE decision/formatting logic (no timers, no push). The service in Task 3 wraps it with real timers.

- [ ] **Step 1: Write the test first** (`src/utils/reactionCoalesce.test.js`):
```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { summarizeReactors, ReactionBuffer } = require('./reactionCoalesce');

test('summarizeReactors: single reactor names the emoji', () => {
  assert.equal(
    summarizeReactors([{ name: 'Emily', emoji: '❤️' }], 'comment'),
    'Emily reacted ❤️ to your comment'
  );
});
test('summarizeReactors: many reactors collapse to "+N others"', () => {
  const r = [{ name: 'Emily', emoji: '❤️' }, { name: 'Bob', emoji: '👍' }, { name: 'Cy', emoji: '😂' }];
  assert.equal(summarizeReactors(r, 'post'), 'Emily + 2 others reacted to your post');
});
test('summarizeReactors: de-dups the same actor (latest emoji wins) before counting', () => {
  const r = [{ name: 'Emily', emoji: '❤️' }, { name: 'Emily', emoji: '👍' }];
  assert.equal(summarizeReactors(r, 'comment'), 'Emily reacted 👍 to your comment');
});

test('ReactionBuffer: accumulates actors and flushes once after quiet window', () => {
  let nowMs = 1000;
  const flushed = [];
  const buf = new ReactionBuffer({ quietMs: 30000, capMs: 300000, now: () => nowMs, onFlush: (items) => flushed.push(items) });
  buf.add('k', { name: 'Emily', emoji: '❤️' }); nowMs += 10000;
  buf.add('k', { name: 'Bob', emoji: '👍' });   nowMs += 10000;
  buf.tick(); // not quiet yet (10s since last add)
  assert.equal(flushed.length, 0);
  nowMs += 31000; buf.tick(); // quiet window elapsed
  assert.equal(flushed.length, 1);
  assert.equal(flushed[0].length, 2);
});
test('ReactionBuffer: hard cap flushes even while still busy', () => {
  let nowMs = 0;
  const flushed = [];
  const buf = new ReactionBuffer({ quietMs: 30000, capMs: 300000, now: () => nowMs, onFlush: (i) => flushed.push(i) });
  for (let i = 0; i < 20; i++) { buf.add('k', { name: 'U' + i, emoji: '❤️' }); nowMs += 20000; buf.tick(); }
  assert.ok(flushed.length >= 1, 'cap forced at least one flush within the busy window');
});
test('ReactionBuffer: drop removes a pending actor before flush', () => {
  let nowMs = 0; const flushed = [];
  const buf = new ReactionBuffer({ quietMs: 30000, capMs: 300000, now: () => nowMs, onFlush: (i) => flushed.push(i) });
  buf.add('k', { name: 'Emily', emoji: '❤️' });
  buf.drop('k', 'Emily');
  nowMs += 31000; buf.tick();
  assert.equal(flushed.length, 0, 'no flush when the only actor was dropped');
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement `src/utils/reactionCoalesce.js`:**
```js
// Pure coalescing logic for reaction push notifications. No timers/IO here —
// the service layer drives tick()/flush with real time. `key` groups by
// (recipient, targetType, targetId).
function summarizeReactors(reactors, targetType) {
  // De-dup by name, latest emoji wins, preserving first-seen order.
  const order = [];
  const byName = new Map();
  for (const r of reactors) {
    if (!byName.has(r.name)) order.push(r.name);
    byName.set(r.name, r.emoji);
  }
  const names = order;
  const first = names[0];
  if (names.length === 1) return `${first} reacted ${byName.get(first)} to your ${targetType}`;
  return `${first} + ${names.length - 1} others reacted to your ${targetType}`;
}

class ReactionBuffer {
  constructor({ quietMs, capMs, now, onFlush }) {
    this.quietMs = quietMs; this.capMs = capMs; this.now = now; this.onFlush = onFlush;
    this.groups = new Map(); // key -> { items:[], firstAt, lastAt }
  }
  add(key, item) {
    const t = this.now();
    let g = this.groups.get(key);
    if (!g) { g = { items: [], firstAt: t, lastAt: t }; this.groups.set(key, g); }
    g.items.push(item); g.lastAt = t;
  }
  drop(key, name) {
    const g = this.groups.get(key);
    if (!g) return;
    g.items = g.items.filter(i => i.name !== name);
    if (!g.items.length) this.groups.delete(key);
  }
  tick() {
    const t = this.now();
    for (const [key, g] of [...this.groups]) {
      const quiet = (t - g.lastAt) >= this.quietMs;
      const capped = (t - g.firstAt) >= this.capMs;
      if (quiet || capped) {
        this.groups.delete(key);
        if (g.items.length) this.onFlush(g.items, key);
      }
    }
  }
}
module.exports = { summarizeReactors, ReactionBuffer };
```

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `feat(reactions): pure coalescing logic for reaction push`

---

### Task 3: Reaction push service (timers + web-push wiring)

**Files:**
- Create: `src/services/reactionPush.js`
- Modify: `src/services/push.js` (add `push_notify_reactions` to `PUSH_PREF_COLUMNS`)

- [ ] **Step 1:** Add `'push_notify_reactions'` to the `PUSH_PREF_COLUMNS` set in `src/services/push.js` (find the set near `sendPushToUser`).

- [ ] **Step 2: Implement `src/services/reactionPush.js`:**
```js
const { ReactionBuffer, summarizeReactors } = require('../utils/reactionCoalesce');
const { sendPushToUser } = require('./push');

const QUIET_MS = 30 * 1000;
const CAP_MS = 5 * 60 * 1000;

// key = recipientId|targetType|targetId. We stash link info on the group via the
// first item so the flush can build a URL.
const buffer = new ReactionBuffer({
  quietMs: QUIET_MS, capMs: CAP_MS, now: () => Date.now(),
  onFlush: (items, key) => {
    const recipientId = Number(key.split('|')[0]);
    const targetType = items[0].targetType;            // 'post' | 'comment'
    const url = items[0].url;
    const body = summarizeReactors(items, targetType);
    sendPushToUser(recipientId, { title: 'New reaction', body, url }, { checkColumn: 'push_notify_reactions' })
      .catch(e => console.error('reaction push error:', e.message));
  },
});
// Single interval drives all groups. Unref so it never holds the process open.
const _timer = setInterval(() => buffer.tick(), 5000);
if (_timer.unref) _timer.unref();

function queueReactionPush({ recipientId, actorName, emoji, targetType, postId, commentId }) {
  const targetId = targetType === 'comment' ? commentId : postId;
  const key = `${recipientId}|${targetType}|${targetId}`;
  const url = targetType === 'comment' ? `/post/${postId}#comment-${commentId}` : `/post/${postId}`;
  buffer.add(key, { name: actorName, emoji, targetType, url });
}
function dropReactionPush({ recipientId, actorName, targetType, postId, commentId }) {
  const targetId = targetType === 'comment' ? commentId : postId;
  buffer.drop(`${recipientId}|${targetType}|${targetId}`, actorName);
}
module.exports = { queueReactionPush, dropReactionPush };
```
(Confirm the real `sendPushToUser` payload shape — title/body/url — against `push.js`; adjust keys to match what the service worker expects. Match the shape used by existing comment push calls.)

- [ ] **Step 3: Smoke** — `node -e "require('./src/services/reactionPush').queueReactionPush({recipientId:1,actorName:'X',emoji:'❤️',targetType:'comment',postId:1,commentId:1}); console.log('ok')"` → prints ok, no throw.

- [ ] **Step 4: Commit** — `feat(reactions): coalesced push service + push_notify_reactions pref`

---

### Task 4: Comment reaction API + in-app notification (with dedup)

**Files:**
- Create: `src/routes/commentReactions.js` (mirror `src/routes/reactions.js`)
- Modify: `src/app.js` (mount the router)

- [ ] **Step 1:** Create `src/routes/commentReactions.js`, mirroring `routes/reactions.js` but:
  - Use `isAllowedEmoji` from `../utils/reactionEmoji`.
  - `GET /comments/:id/reaction-names` → query `comment_reactions JOIN users` grouped by emoji.
  - `POST /comments/:id/react`:
    - Validate the comment exists and is not soft-deleted (`SELECT id, user_id, post_id FROM comments WHERE id = ? AND deleted_at IS NULL`).
    - Toggle the `(comment_id, user_id, emoji)` row exactly like the post route.
    - Return `{ emoji, count, userReacted }` (count = rows for that comment+emoji).
  - **On ADD** (fire-and-forget): if `comment.user_id !== userId`:
    - In-app dedup — one notification per (recipient, actor, comment):
```js
const [[existingNotif]] = await pool.query(
  "SELECT id FROM notifications WHERE user_id=? AND actor_id=? AND type='comment_reaction' AND comment_id=? AND read_at IS NULL",
  [comment.user_id, userId, commentId]
);
if (existingNotif) {
  await pool.query('UPDATE notifications SET meta=?, created_at=NOW() WHERE id=?', [emoji, existingNotif.id]);
} else {
  await pool.query(
    "INSERT INTO notifications (user_id, actor_id, type, post_id, comment_id, meta) VALUES (?,?, 'comment_reaction', ?, ?, ?)",
    [comment.user_id, userId, comment.post_id, commentId, emoji]
  );
}
queueReactionPush({ recipientId: comment.user_id, actorName: req.session.user.name, emoji, targetType: 'comment', postId: comment.post_id, commentId });
```
  - **On REMOVE**: if that was the user's LAST reaction to the comment (`SELECT COUNT(*) FROM comment_reactions WHERE comment_id=? AND user_id=?` === 0) and `comment.user_id !== userId`: delete the unread notification and drop the pending push:
```js
await pool.query("DELETE FROM notifications WHERE user_id=? AND actor_id=? AND type='comment_reaction' AND comment_id=? AND read_at IS NULL",
  [comment.user_id, userId, commentId]);
dropReactionPush({ recipientId: comment.user_id, actorName: req.session.user.name, targetType: 'comment', postId: comment.post_id, commentId });
```

- [ ] **Step 2:** Mount in `src/app.js` next to the reactions router: `app.use(require('./routes/commentReactions'))`.

- [ ] **Step 3: Manual verify** with the app running + a logged-in session (curl with session cookie, or via the UI after Task 7). Confirm toggle returns correct `{count,userReacted}` and a notification row appears for another user's comment but NOT your own.

- [ ] **Step 4: Commit** — `feat(comments): comment reaction API + deduped in-app notification + coalesced push`

---

### Task 5: Wire POST reactions into coalesced push

**Files:**
- Modify: `src/routes/reactions.js`

- [ ] **Step 1:** In the post `/react` ADD branch, right after inserting the post-reaction notification (inside the `post.user_id !== userId` guard), add:
```js
queueReactionPush({ recipientId: post.user_id, actorName: req.session.user.name, emoji, targetType: 'post', postId });
```
And in a REMOVE branch, if it was the user's last reaction to the post and not self, `dropReactionPush({ recipientId: post.user_id, actorName: req.session.user.name, targetType: 'post', postId })` and delete the unread `'reaction'` notification (mirror the comment dedup so re-reacting doesn't stack). Require `reactionPush` at top.
  *(Note: this adds dedup to post-reaction notifications too — intentional, keeps posts/comments consistent.)*

- [ ] **Step 2: Manual verify** a post reaction by another user queues a push (log/observe) and the notification dedups.
- [ ] **Step 3: Commit** — `feat(reactions): coalesced push + notification dedup for post reactions`

---

### Task 6: Load comment reactions for the post view

**Files:**
- Modify: `src/routes/posts.js` (the `/post/:id` handler, after comments are fetched/threaded ~line 249-255)

- [ ] **Step 1:** After comments (+replies) are assembled, gather all comment ids (parents + replies) and run:
```js
const ids = allCommentIds; // parents + replies
let reactionsByComment = {};
if (ids.length) {
  const [rows] = await pool.query(
    `SELECT comment_id, emoji, COUNT(*) AS count,
            SUM(user_id = ?) AS mine
     FROM comment_reactions WHERE comment_id IN (?) GROUP BY comment_id, emoji`,
    [req.session.user.id, ids]
  );
  rows.forEach(r => {
    (reactionsByComment[r.comment_id] ||= []).push({ emoji: r.emoji, count: r.count, mine: !!Number(r.mine) });
  });
}
```
  Attach `comment.reactions = reactionsByComment[comment.id] || []` to every parent and reply before rendering.

- [ ] **Step 2: Manual verify** the post view renders existing chips (after Task 7 markup).
- [ ] **Step 3: Commit** — `feat(posts): attach comment reactions to post view data`

---

### Task 7: Frontend — inline timestamps, reaction chips, generalized picker, long-press

**Files:**
- Modify: `src/views/post.ejs` (comment + reply markup ~174-237)
- Modify: `src/public/js/app.js` (generalize the reaction picker ~37-301; add comment triggers)
- Modify: `src/public/css/theme.css` (quick-bar + chip styles as needed)

- [ ] **Step 1 (Part 1 — inline timestamp):** In BOTH the parent-comment header (post.ejs:188-192) and reply header (225-229), wrap the author `<a>` and the `<time>` in one baseline-aligned flex row, remove `block` from the name link, and **remove the `<time>` from the meta row**. Example for the parent:
```html
<div class="bg-slate-50 dark:bg-slate-700/60 rounded-xl px-3 py-2.5" id="comment-<%= comment.id %>" data-comment-id="<%= comment.id %>">
  <div class="flex items-baseline gap-2 flex-wrap mb-0.5">
    <a href="/member/<%= comment.user_id %>" class="text-sm font-semibold text-slate-700 dark:text-slate-200 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"><%= comment.author_name %></a>
    <time data-ts="<%= new Date(comment.created_at).toISOString() %>" data-fmt="compact" class="text-xs text-slate-400 dark:text-slate-500"></time>
  </div>
  <p class="text-base text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words"><%- renderContent(comment.content) %></p>
</div>
```
  (Add the same `id="comment-<id>"` + `data-comment-id` anchor to replies. Keep the meta row for Reply/Delete, just without `<time>`.)

- [ ] **Step 2 (chips):** Under each comment bubble, render existing reactions + the react affordance:
```html
<div class="flex items-center gap-1 mt-1 flex-wrap fn-comment-reactions" data-comment-id="<%= comment.id %>">
  <% (comment.reactions || []).forEach(r => { %>
    <button class="fn-reaction-chip<%= r.mine ? ' fn-reaction-chip--mine' : '' %>" data-emoji="<%= r.emoji %>"><%= r.emoji %> <%= r.count %></button>
  <% }) %>
  <button class="fn-comment-react-btn" title="React" aria-label="React">🙂<span aria-hidden="true">＋</span></button>
</div>
```

- [ ] **Step 3 (JS generalize + triggers):** In `app.js`, refactor the post picker so it works for any target via `data-react-target` + `data-react-id` and posts to the right endpoint (`/posts/:id/react` or `/comments/:id/react`). Then wire comment triggers:
  - The `.fn-comment-react-btn` click → open the quick bar (QUICK_EMOJI + `＋` to expand to full 21) anchored to that comment.
  - `touchstart` on `[data-comment-id]` bubble → 450ms long-press timer; cancel on `touchmove`/`touchend`-before-fire; on fire `preventDefault()` + open quick bar.
  - `contextmenu` on the bubble (desktop) → `preventDefault()` + open quick bar.
  - On emoji tap → `fetch('/comments/<id>/react', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({emoji})})` → re-render that comment's chip row from the JSON.
  - Tapping an existing chip toggles that emoji (same endpoint).
  - **Do not regress post reactions** — verify the post picker still opens and toggles.
  - Mirror the QUICK_EMOJI list from `reactionEmoji.js` (hardcode the same 6 + full 21 in the client; add a comment noting they must match the server).

- [ ] **Step 4 (CSS):** Add `.fn-reaction-chip`, `.fn-reaction-chip--mine`, `.fn-comment-react-btn`, and the quick-bar popover styles in `theme.css` (reuse existing reaction/picker styles where present). Ensure dark-mode variants.

- [ ] **Step 5:** Confirm `<script src="/js/app.js?v=<%= assetVersion %>">` is already on post.ejs (it is for existing reactions). 

- [ ] **Step 6: Manual verify in browser** (use the mockup/live local): long-press on mobile viewport + hover/right-click on desktop open the bar; reacting updates chips; timestamps now inline; post reactions still work; dark mode OK.

- [ ] **Step 7: Commit** — `feat(comments): inline timestamps + iMessage-style emoji reactions UI`

---

### Task 8: Notification rendering + push preference toggle

**Files:**
- Modify: `src/views/notifications.ejs` (`describeNotification`)
- Modify: `src/routes/notifications.js` (query — ensure it returns `meta`, `post_id`, `comment_id`)
- Modify: `src/views/settings.ejs` (+ the settings-save route) — `push_notify_reactions` toggle

- [ ] **Step 1:** In `notifications.ejs` `describeNotification`, add:
```js
if (n.type === 'comment_reaction') return 'reacted ' + n.meta + ' to your comment';
```
  And make the comment_reaction (and post 'reaction') notification link to `/post/<post_id>#comment-<comment_id>` when `comment_id` is present, else `/post/<post_id>`.

- [ ] **Step 2:** Confirm `notifications.js` query selects `n.meta, n.post_id, n.comment_id` (add if missing).

- [ ] **Step 3:** In `settings.ejs`, add a "Reactions" push toggle bound to `push_notify_reactions` alongside the existing `push_notify_*` checkboxes; ensure the POST handler that saves notification prefs includes `push_notify_reactions` in its allowed columns (mirror how `push_notify_comments` is persisted).

- [ ] **Step 4: Manual verify** the notifications page shows "X reacted ❤️ to your comment" linking to the comment, and the settings toggle persists.

- [ ] **Step 5: Commit** — `feat(notifications): render comment_reaction + push_notify_reactions preference`

---

### Task 9: Full verification + What's New + deploy

- [ ] **Step 1:** Run `npm test` (`node --test src/utils/`) — all green (reactionEmoji + reactionCoalesce + existing utils).
- [ ] **Step 2:** Start the app locally; click through: react to a comment (own + other user), toggle off, long-press (mobile emulation), right-click (desktop), verify chips + notification + dedup. Verify post reactions unaffected.
- [ ] **Step 3:** Push to `main` (Actions builds arm64 → Pi runner auto-deploys). Wait for the specific commit's build to deploy; curl `/health`.
- [ ] **Step 4 (What's New — members see this):** from `/home/jmull/projects/family-news`:
  `node scripts/add-changelog.js --title "React to comments" --body "You can now react to comments with emojis — just press and hold a comment (or right-click on a computer) and pick a reaction, like in Messages. You'll get a notification when someone reacts to yours."`
  Then `git add src/data/changelog-meta.json && git commit -m "chore: update changelog sidecar (comment reactions)" && git push`.
- [ ] **Step 5:** Confirm the changelog dot appears for members.

---

## Self-Review notes
- **Spec coverage:** inline timestamps (T7.1), comment_reactions table (T1), API + dedup notif (T4), coalesced push generic for both (T2/T3/T4/T5), push pref (T1/T3/T8), in-app render (T8), picker/long-press/chips (T7), What's New (T9). All covered.
- **Type consistency:** `queueReactionPush`/`dropReactionPush` signatures identical across T3/T4/T5; `summarizeReactors`/`ReactionBuffer` match T2 tests; `ALLOWED_EMOJI`/`QUICK_EMOJI`/`isAllowedEmoji` consistent T1↔T4↔T7.
- **Caveat:** in-memory coalescing buffer is best-effort across restarts (deploy mid-window drops a pending push; in-app row persists). Documented in spec.
