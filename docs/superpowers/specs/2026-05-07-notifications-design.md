# Notifications System Design

**Date:** 2026-05-07

## Goal

Add a personal in-app notifications system so family members know when someone commented on their post, replied to their comment, mentioned them, or reacted to their post. A unified notification dot in the nav (blue, slow pulse) covers both personal notifications and unread What's New entries — replacing the separate What's New dot.

## Architecture

A `notifications` table records each notification event. Notifications are marked read when the user visits the relevant post (from anywhere — feed, direct URL, etc.) or when they visit the `/notifications` page. The nav dot is computed per-request in the existing app.js middleware, combining unread personal notifications with the existing changelog-seen logic.

## Data Model

New table added to `db.js` `initDb()`:

```sql
CREATE TABLE IF NOT EXISTS notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  actor_id INT NOT NULL,
  type ENUM('comment', 'reply', 'mention', 'reaction') NOT NULL,
  post_id INT NOT NULL,
  comment_id INT DEFAULT NULL,
  meta VARCHAR(20) DEFAULT NULL,
  read_at DATETIME DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (actor_id) REFERENCES users(id),
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
)
```

`meta` stores auxiliary data per type: for `reaction`, it holds the emoji character. Null for all other types.

Index: `(user_id, read_at)` for fast unread count queries.

## Notification Generation

Notifications are inserted fire-and-forget (inside existing try/catch blocks) in the following routes. Self-notifications are always skipped (`actor_id != user_id`).

| Route | Event | Type | Recipient |
|-------|-------|------|-----------|
| `POST /posts/:id/comments` | New comment on a post | `comment` | Post owner |
| `POST /posts/:id/comments` | Reply to a comment | `reply` | Parent comment owner |
| `POST /posts/:id/comments` | @mention in a comment | `mention` | Each mentioned user |
| `POST /posts` | @mention in a new post | `mention` | Each mentioned user |
| `POST /reactions/toggle` (or equivalent) | Reaction added (not removed) | `reaction` | Post owner |

For reply notifications: query `SELECT user_id FROM comments WHERE id = ?` using `parent_id` to find the comment owner.

For reaction notifications: only insert when the reaction is being **added** (not toggled off).

## Read Tracking

**Per-post read:** In the `GET /post/:id` handler, after the post is fetched, run fire-and-forget:
```sql
UPDATE notifications SET read_at = NOW()
WHERE user_id = ? AND post_id = ? AND read_at IS NULL
```
This clears the dot even if the user navigated to the post from the feed, not from the notifications page.

**Bulk read:** When the user visits `GET /notifications`, mark all their unread notifications as read before rendering (so the dot is gone on their next page load):
```sql
UPDATE notifications SET read_at = NOW()
WHERE user_id = ? AND read_at IS NULL
```

## Nav Dot

The app.js request-locals middleware already computes `showChangelogDot`. Extend it to also compute `showNotificationDot`:

```js
// existing changelog dot logic stays
const showChangelogDot = !!(latestAt && (!seenAt || new Date(latestAt) > new Date(seenAt)));

// new: unread personal notifications
const [[{ unread }]] = await pool.query(
  'SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND read_at IS NULL',
  [req.session.user.id]
);
res.locals.showNotificationDot = showChangelogDot || unread > 0;
res.locals.showChangelogDot = showChangelogDot; // still needed for notifications page changelog card
```

The What's New link in `nav.ejs` has its dot **removed** — `showChangelogDot` is no longer rendered in the nav. `showNotificationDot` drives the single dot on the new Notifications link.

## Nav Changes (`nav.ejs`)

- Add "Notifications" link in the desktop `fn-nav-links` section and the mobile drawer, positioned between Feedback and What's New.
- Remove the `showChangelogDot` dot span from the What's New link (the link itself stays).
- The Notifications link renders a blue pulsing dot when `showNotificationDot` is true.

Dot HTML:
```html
<% if (showNotificationDot) { %>
<span class="notif-dot" aria-hidden="true"></span>
<% } %>
```

Dot CSS (in nav.ejs `<style>` block):
```css
.notif-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #3b82f6; /* blue-500 */
  margin-left: 4px;
  margin-bottom: 2px;
  vertical-align: middle;
  animation: notif-pulse 1.8s ease-in-out infinite;
}

@keyframes notif-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.75); }
}
```

## Notifications Page

**Route:** `GET /notifications` in a new `src/routes/notifications.js`, protected by `requireAuth`.

**Logic:**
1. Query all notifications for the user (newest first, limit 50) including their current `read_at` value — rows where `read_at IS NULL` were unread at page-load time and get highlighted in the view.
2. Mark all unread as read (`UPDATE … WHERE user_id = ? AND read_at IS NULL`).
3. Check `showChangelogDot` (already in `res.locals`) to decide whether to show the What's New card.
4. Render `notifications.ejs`.

**Query:**
```sql
SELECT n.id, n.type, n.post_id, n.comment_id, n.read_at, n.created_at,
       u.name AS actor_name, u.avatar_url AS actor_avatar,
       p.title AS post_title
FROM notifications n
JOIN users u ON n.actor_id = u.id
JOIN posts p ON n.post_id = p.id
WHERE n.user_id = ?
ORDER BY n.created_at DESC
LIMIT 50
```

**Notification text by type:**
- `comment`: "{name} commented on your post"
- `reply`: "{name} replied to your comment"
- `mention`: "{name} mentioned you"
- `reaction`: "{name} reacted {emoji} to your post"

For `reaction` notifications, the emoji is passed as `meta` at insert time and rendered directly. `comment_id` is null for reaction rows.

**Notification text for reaction:** `{name} reacted {meta} to your post`

**Page layout:**

- If `showChangelogDot`: show a card at the top: "Family News has been updated — [See What's New →]" linking to `/whats-new`. Styled differently (brand color left border) to distinguish from personal notifications.
- Each notification row: actor avatar/initials circle + name, description text, post title (subdued), time ago. Entire row is a link to `/post/:id`. Unread notifications (those with `read_at` was null before this page load) get a subtle blue-50 background or left border highlight.
- Empty state (no notifications and no changelog card): "Nothing yet — you'll see comments, mentions, and reactions here."

**New file:** `src/views/notifications.ejs` — must include `<script src="/js/app.js"></script>` before `</body></html>`.

## Files to Create

- `src/routes/notifications.js` — GET /notifications route
- `src/views/notifications.ejs` — page view

## Files to Modify

- `src/db.js` — add `notifications` table + `meta` column to `initDb()`
- `src/app.js` — add `showNotificationDot` to middleware; register notifications router
- `src/views/partials/nav.ejs` — add Notifications link + dot; remove What's New dot
- `src/routes/comments.js` — insert `comment`, `reply`, `mention` notifications
- `src/routes/posts.js` — insert `mention` notifications for post @mentions
- `src/routes/posts.js` — add fire-and-forget read-mark on `GET /post/:id`
- `src/routes/reactions.js` (or wherever reaction toggle lives) — insert `reaction` notifications

## Non-Goals

- No notification preferences UI (all notification types are always on)
- No pagination on the notifications page (limit 50 is sufficient for a family site)
- No real-time badge updates (dot updates on next page navigation)
- No email/push for in-app notification events (push/email already handled separately)
