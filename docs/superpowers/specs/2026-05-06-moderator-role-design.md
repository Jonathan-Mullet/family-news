# Moderator Role Design

**Date:** 2026-05-06

## Goal

Add a `moderator` role between `member` and `admin` that gives trusted family members tools to keep the site organized — pinning posts, removing content, creating invites, and restoring deleted items — without access to user management or site settings.

## Roles Summary

| Capability | Member | Moderator | Admin |
|---|---|---|---|
| Post, comment, react | ✓ | ✓ | ✓ |
| Edit/delete own posts & comments | ✓ | ✓ | ✓ |
| Toggle Big News on own posts | ✓ | ✓ | ✓ |
| Pin/unpin any post | | ✓ | ✓ |
| Delete any post or comment | | ✓ | ✓ |
| Toggle Big News on any post | | ✓ | ✓ |
| Create invite links | | ✓ | ✓ |
| Access mod panel (/mod) | | ✓ | ✓ |
| Access role guide (/guide) | | ✓ | ✓ |
| Manage users & roles | | | ✓ |
| Birthday/anniversary event config | | | ✓ |
| Full analytics & read receipts | | | ✓ |

---

## Architecture

### DB Changes

Two migrations, added to `src/db.js` startup block:

```sql
ALTER TABLE users MODIFY COLUMN role ENUM('admin','moderator','member') DEFAULT 'member';
ALTER TABLE posts ADD COLUMN IF NOT EXISTS deleted_at DATETIME DEFAULT NULL;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS deleted_at DATETIME DEFAULT NULL;
```

### Auth Middleware

Add `requireMod` to `src/middleware/auth.js` alongside the existing `requireAdmin`:

```js
function requireMod(req, res, next) {
  if (!req.session.user || (req.session.user.role !== 'admin' && req.session.user.role !== 'moderator'))
    return res.status(403).render('error', { message: 'Access denied.' });
  next();
}
```

### Soft Delete

When a post or comment is deleted, set `deleted_at = NOW()` instead of removing the row. Photo files stay on disk until purge.

All queries that fetch posts or comments for display must filter `AND deleted_at IS NULL`.

Affected queries:
- Feed (posts.js): main feed, member page, post detail page (`/post/:id`) — soft-deleted posts must 404
- Comments (comments.js): all comment fetches
- Latest comment preview (feedData.js enrichPosts)

### Route Permission Changes

**`src/routes/posts.js`:**

- **Edit post:** `role !== 'admin'` → `role !== 'admin' && role !== 'moderator'`
- **Pin post:** `role !== 'admin'` → `role !== 'admin' && role !== 'moderator'`
- **Toggle Big News:** `role !== 'admin'` → `role !== 'admin' && role !== 'moderator'`; also fire email blast on toggle-to-Big-News (currently only push fires; new posts already send both)
- **Delete post:** `role !== 'admin'` → `role !== 'admin' && role !== 'moderator'`; change from hard-delete to soft-delete (set `deleted_at`); do NOT delete photo files on soft delete

**`src/routes/comments.js`:**

- **Delete comment:** `role !== 'admin'` → `role !== 'admin' && role !== 'moderator'`; change from hard-delete to soft-delete

### Template Changes

**`src/views/partials/post-card.ejs`** and **`src/views/post.ejs`:**

All action button visibility conditions that currently check `user.role === 'admin'` must also allow `user.role === 'moderator'`. Affected buttons: pin, toggle-big-news, delete post, delete comment.

---

## Admin Panel — Role Management

Replace the binary `toggle-role` endpoint (member ↔ admin) with a `set-role` endpoint that accepts `role` in the form body.

**`POST /admin/users/:id/set-role`** body: `{ role: 'member' | 'moderator' | 'admin' }`

Guards:
- Cannot change your own role
- Target role must be one of the three valid values

Triggers **promotion notification** if the new role is higher than the current role (member→moderator, member→admin, moderator→admin).

**Admin panel UI (`src/views/admin.ejs`):** Replace the toggle button per user row with a `<select>` showing the three roles, inside a small form that POSTs to `set-role`. Current role is pre-selected.

---

## Promotion Notification

Sent when an admin promotes a user (role upgrade only — no notification for demotions).

**Push:** `sendPushToUser(userId, { title: 'You\'ve been made a [Role] on Family News 🎉', body: 'Tap to see your new guide.', url: '/guide' })`

**Email:** New `sendPromotionNotification(email, name, role)` function in `src/email.js`. Short email: "Hi [Name], you've been made a [Moderator/Admin] on Family News." with a link to `/guide`.

---

## Mod Panel (`/mod`)

New route file: `src/routes/mod.js` (protected by `requireMod`)
New view: `src/views/mod.ejs`

Two sections:

### Invites

Same create/revoke functionality as the admin panel. Forms POST to `/mod/invites` (create) and `/mod/invites/:id/revoke`. All active (non-expired, not fully used) invites are shown regardless of who created them — mods need full visibility to avoid creating duplicates.

### Trash

Lists soft-deleted posts and comments where `deleted_at > DATE_SUB(NOW(), INTERVAL 14 DAY)`, newest first. Each item shows: content preview, author, deleted-at timestamp, and two buttons:
- **Restore** → `POST /mod/posts/:id/restore` or `POST /mod/comments/:id/restore` — sets `deleted_at = NULL`
- **Delete Now** → `POST /mod/posts/:id/purge` or `POST /mod/comments/:id/purge` — hard-deletes (with photo file cleanup for posts)

Deleted posts and their comments are shown as a group. Standalone deleted comments (parent post still alive) are shown separately.

---

## Role Guide (`/guide`)

New route on `src/routes/mod.js` (same file, protected by `requireMod`):
`GET /guide`

View: `src/views/guide.ejs`

Help-article layout (Layout C). Content tailored by role:
- **Moderator:** sections for pinning, Big News, removing content, invite links, trash & restore. Gray "Admin-only" box at bottom listing user management, events config, analytics.
- **Admin:** all sections unlocked, no gray box. Header says "Admin Guide."

---

## Purge Cron Job

New `cron.schedule` call in `src/cron.js`, running daily at 3am alongside the birthday job.

```
0 3 * * *
```

Steps:
1. Find posts where `deleted_at < DATE_SUB(NOW(), INTERVAL 14 DAY)`
2. For each: fetch `post_photos`, delete files from disk, then hard-delete the post row (CASCADE handles comments, reactions, post_reads, post_photos)
3. Find remaining comments where `deleted_at < DATE_SUB(NOW(), INTERVAL 14 DAY)` (parent post still alive) and hard-delete them

---

## Nav Links

In `src/views/partials/nav.ejs`, add for `user.role === 'moderator' || user.role === 'admin'`:
- **Mod** → `/mod`
- **Guide** → `/guide`

Admins keep their existing **Admin** → `/admin` link.

---

## Out of Scope

- "Basic activity visibility" dashboard — deferred to Tier 2 expanded admin panel
- Invite history for mods (they see only their own active invites, not full history)
- Permanent trash disable / per-item retention control
