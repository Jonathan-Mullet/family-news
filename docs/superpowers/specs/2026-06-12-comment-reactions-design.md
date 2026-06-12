# Comment timestamps inline + comment emoji reactions — design

**Date:** 2026-06-12
**Status:** Approved (Jonathan, brainstorming; "act autonomously")

## Overview

Two changes to family-news:

1. **Inline comment timestamps** — move each comment's timestamp into the bubble
   header next to the author name so comments take up less vertical space.
2. **Comment emoji reactions** — iMessage-style: long-press (mobile) / hover or
   right-click (desktop) a comment to open a quick emoji bar, tap to react.
   Reuses the existing post-reaction system. Includes in-app + coalesced push
   notifications, and the same coalesced push is added to **post** reactions too.

The app already has a complete post-reaction system (`reactions` table,
`/posts/:id/react`, an emoji picker + chips in `public/js/app.js`, and a
`'reaction'` notification type). This feature mirrors and generalizes it.

---

## Part 1 — Inline timestamps

**Current (`src/views/post.ejs`):** a comment renders as an avatar + a bubble
(`<a>author</a>` + `<p>body</p>`), then a **separate meta row below** containing
`<time>`, Reply, and (for the author) Delete.

**Change:** move the `<time>` element into the bubble header, immediately after
the author name, styled small + muted (e.g. `text-xs text-slate-400 ml-2`,
keeping the existing `data-ts` / `data-fmt="compact"` so client-side relative
formatting still works). The meta row below keeps Reply/Delete. Apply to both
parent comments and replies. Pure EJS/CSS; no data changes.

---

## Part 2 — Comment reactions

### Data
New table, mirroring `reactions` exactly but keyed on `comment_id`:

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

Added via db.js's idempotent migration/`CREATE TABLE IF NOT EXISTS` pattern.

### API (mirror `src/routes/reactions.js`)
- `POST /comments/:id/react` — body `{emoji}`. `requireAuth`. Validates `emoji`
  against the shared 21-emoji allowlist. Toggles the current user's row for
  `(comment_id, emoji)`. Returns `{emoji, count, userReacted}`.
- `GET /comments/:id/reaction-names` — `{emoji: [names]}` for chip tooltips.

The allowed-emoji list (currently hardcoded in reactions.js) is extracted to a
shared module so both post and comment routes use one source of truth.

### Data loading (`src/routes/posts.js`, post view)
After loading the post's comments, fetch all their reactions in one aggregate
query (`... WHERE comment_id IN (?) GROUP BY comment_id, emoji`) plus the set of
emojis the current user has used per comment, and attach to each comment object
so chips render server-side on first paint.

### Frontend (`src/public/js/app.js`)
**Generalize** the existing post-reaction picker (≈ lines 37–301) to drive both
targets via `data-react-target="post|comment"` + `data-react-id` and an endpoint
derived from those, rather than duplicating ~260 lines. Post-reaction behavior
must not regress (verify the post path still works).

- **Quick bar:** floating pill with 6 curated emojis **❤️ 👍 😂 😮 😢 🙏** plus a
  `＋` that expands to the full 21-emoji grid (the existing picker).
- **Mobile trigger:** `touchstart` on a comment bubble starts a ~450 ms timer;
  movement (scroll) cancels it; on fire, show the quick bar anchored to the
  comment. Suppress text-selection/context-menu during the press.
- **Desktop trigger:** a subtle `🙂＋` affordance on bubble hover, and
  `contextmenu` (right-click) also opens the quick bar.
- Tap emoji → `POST /comments/:id/react` → update chips. Tap-away dismisses.
- **Chips:** emoji + count below the bubble, highlighted when the current user
  reacted; tapping a chip toggles that reaction. Same styling as post chips.

---

## Part 3 — Notifications

### In-app (persists)
- Extend the `notifications.type` ENUM with `'comment_reaction'`.
- On a comment reaction, insert a notification for the comment author
  (`user_id` = comment author, `actor_id` = reactor, `type='comment_reaction'`,
  `comment_id`, `meta` = emoji). **Self-guard:** skip when reactor == author.
- **Per-person dedup:** at most one notification per `(recipient, actor,
  comment)`. Re-reacting or changing emoji refreshes the existing unread row
  (update `meta` + `created_at`) instead of inserting another. Removing one's
  last reaction to a comment deletes the matching **unread** row (leave already-
  read rows as historical). This bounds list spam (post reactions don't dedup,
  but threads can get busy).
- `describeNotification` (notifications.ejs) gains:
  `if (n.type === 'comment_reaction') return 'reacted ' + n.meta + ' to your comment';`
- Notification links to the post, anchored to the comment (`#comment-<id>`) if a
  comment anchor exists; otherwise links to the post (matching post-reaction
  behavior). Add the `id="comment-<id>"` anchor to comment markup if absent.

### Push (coalesced) — generic, used by BOTH post and comment reactions
A small coalescing layer (`src/services/reactionPush.js`, in-memory):

- Keyed by `(recipientId, targetType, targetId)`. Each reaction records the
  actor + emoji and starts/extends a **~30 s quiet timer**; a hard **5-min cap**
  forces a flush if a thread stays hot.
- On flush, send **one** Web Push (via existing `sendPushToUser`, gated by a new
  `users.push_notify_reactions` preference) summarizing reactors accumulated
  since the last flush:
  - 1 → `"<Name> reacted <emoji> to your <post|comment>"`
  - N>1 → `"<Name> + <N-1> others reacted to your <post|comment>"`
- Self-guard (never notify your own reaction). Removing a reaction before flush
  drops that actor from the pending buffer.
- **Post reactions** are wired into this same layer — they gain coalesced push
  (they have none today). This is a behavior change to existing post reactions,
  approved.

**Caveat:** the debounce buffer is in-memory; a deploy/restart mid-window drops a
pending coalesced push. The in-app notification row persists, so nothing durable
is lost — only the (best-effort) push for that window. Documented, acceptable.

### Preferences
- Add `users.push_notify_reactions` (BOOL, default 1) via migration.
- Surface it on the notification-settings UI alongside the existing
  `push_notify_*` toggles.

---

## Testing
- API: `POST /comments/:id/react` toggle semantics (add, idempotent re-add is a
  remove, count + userReacted correctness), emoji-allowlist rejection, auth.
- Notification dedup: re-react refreshes (one row), un-react clears unread row,
  self-guard.
- Coalescing layer: unit-test the buffer/flush logic (accumulate N actors → one
  summary; quiet-timer + cap behavior) with injected timers, in isolation from
  Express.
- Follow the project's existing test setup/conventions (match how current
  routes/db are tested; if none, add focused unit tests for the pure logic and
  verify the routes manually).

## Rollout
- Ship behind no flag (small family app). After deploy:
  - Publish a **What's New** entry (members see this) via
    `node scripts/add-changelog.js`, then commit the changelog sidecar.
  - Deploy is the standard family-news pipeline (push → Actions → Pi runner
    auto-deploy).

## Risks / non-goals
- Generalizing the picker JS risks regressing post reactions — explicit
  verification required.
- In-memory push coalescing is best-effort across restarts (documented).
- Not doing: reaction analytics, animated reaction effects, reacting to replies
  differently from top-level comments (replies are comments — same behavior).
