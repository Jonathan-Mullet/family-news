# Expanded Admin Panel Design

## Goal

Replace the current single-scroll admin page with a tabbed interface and add five new capabilities: site analytics, per-post read receipts (admin panel + feed inline), push subscriber management, enhanced invite management, and scheduled post management.

## Architecture

**Approach:** Client-side tabs, single `/admin` route. All tab content rendered server-side into the page; JS toggles `display` to switch between tabs. Active tab persists in `localStorage`. No new routes for tabs themselves — only new action routes for mutations.

**Tab structure:**

| Tab | Contents |
|-----|----------|
| Overview | Analytics (activity summary + engagement) + events widget |
| Content | Scheduled posts management + per-post read receipts |
| Users | Existing user management + push subscriber management |
| Invites | Enhanced invite management (multi-use, revoke, status) |
| Feedback | Existing feedback section (unchanged) |

---

## Tab 1: Overview

### Activity summary

Two pre-fetched datasets (7-day and 30-day), toggled by JS — no extra requests on switch.

Metrics displayed as styled count cards:
- Posts published
- Comments posted
- Reactions given
- New members joined

### Engagement panel

All-time stats, displayed as simple ranked lists:
- Top 5 posts by read count
- Top 5 posts by reaction count
- Top 5 posts by comment count
- Most active members (posts + comments combined)

### Events widget

Upcoming birthdays and anniversaries in the next 30 days. Relocated from its own section — same data, smaller footprint.

---

## Tab 2: Content

### Scheduled posts

Lists all posts with `publish_at > NOW()` across all users, ordered by scheduled time ascending.

Columns: author, title/excerpt, scheduled time, actions.

**Cancel:** POST `/admin/posts/:id/cancel-scheduled` — sets `deleted_at = NOW()`, nulls `publish_at`. Post disappears from feed and scheduled list.

**Reschedule:** Inline `datetime-local` input revealed on click. POST `/admin/posts/:id/reschedule` with new datetime — updates `publish_at`. Validates that new time is in the future server-side.

### Per-post read receipts

Table of the 30 most recent posts. Columns: title, author, date published, read count ("X of Y members").

Each row is expandable (click to toggle): reveals a member list with ✓ (read) or ✗ (not read) per member. Read data from `post_reads` left-joined against all active members.

**Inline feed badge** (separate from admin panel): admins and moderators see a small "Read by N of M" badge on each post in the feed. Rendered server-side in the post partial, conditional on role. Clicking opens a popover listing reader names.

---

## Tab 3: Users

### User management

Existing section — no changes. Name, email, role, active toggle.

### Push subscriber management

Lists all push subscriptions grouped by user.

Columns per subscription row: user name, subscription date, actions.

**Remove:** DELETE `/admin/push/:id` — removes row from `push_subscriptions`. No confirmation modal needed (easily re-subscribed).

**Send test push:** POST `/admin/push/:id/test` — sends a "Family News test notification" to that specific endpoint. Response delivered inline via `fetch` (no page reload) — shows success or error message next to the button. Uses the existing `webpush.sendNotification()` path.

Stale subscription detection: show subscription age. No last-push-status tracking — admin removes stale ones manually.

---

## Tab 4: Invites

Replaces existing invite section. Same create-invite form with one addition: **Max uses** field (number input, default 1, min 1, max 20). Maps to existing `max_uses` column — no schema change needed.

### Invite list

Each row shows: token (truncated to 8 chars), created by, created date, expiry, use count / max uses, status badge, actions.

**Status badge logic:**
- **Pending** — `expires_at > NOW()` and `use_count < max_uses`
- **Used** — `use_count >= max_uses` (shows who used it if single-use, or just count if multi)
- **Expired** — `expires_at <= NOW()` and `use_count < max_uses`

**Revoke** (Pending only): POST `/admin/invites/:id/revoke` — sets `expires_at = NOW()`. No new column. Pending invite immediately becomes Expired.

Existing create-invite and delete logic preserved.

---

## Tab 5: Feedback

Existing feedback section, moved into this tab unchanged. No modifications.

---

## New Routes

| Method | Path | Action |
|--------|------|--------|
| POST | `/admin/posts/:id/cancel-scheduled` | Null `publish_at`, set `deleted_at = NOW()` |
| POST | `/admin/posts/:id/reschedule` | Update `publish_at` to new datetime |
| DELETE | `/admin/push/:id` | Remove push subscription |
| POST | `/admin/push/:id/test` | Send test push notification |
| POST | `/admin/invites/:id/revoke` | Set `expires_at = NOW()` |

---

## DB Changes

No new tables or columns. All required columns already exist:
- `post_reads` — already tracks reads
- `push_subscriptions` — already tracks subscriptions
- `publish_at` on posts — already supports scheduled posts
- `max_uses`, `use_count` on invites — already exist from prior migration

---

## Inline Feed Changes

- Post partial gains a read-receipt badge visible to admin/moderator roles only
- Badge shows "Read by N of M" with a JS popover listing reader names
- Data fetched server-side and embedded in the post render (no extra client request)

---

## Style

- Tabs use the existing `fn-*` CSS class pattern
- Tab bar: horizontal pill/underline style consistent with the site's serif aesthetic
- Each tab panel: same card/section styling already in `admin.ejs`
- Dark mode: follows existing `.dark` class pattern
