# What's New Page Design

## Goal

A `/whats-new` page showing site updates and new features, accessible to all logged-in members. Entries are drafted and published by Claude after each development session. A nav dot alerts members when new entries have appeared since their last visit.

## Architecture

**Storage:** New `changelog` DB table. "Seen" state tracked via `whats_new_seen_at` column on the `users` table — server-side, so it works across devices.

**Nav dot:** `app.locals.latestChangelogAt` is set at startup by reading `src/data/changelog-meta.json` (a tiny JSON sidecar file). No per-request DB query. The sidecar is rewritten whenever an entry is added or deleted. Nav partial receives a `showChangelogDot` boolean from each route.

**Authoring:** A standalone script `scripts/add-changelog.js` — loads `.env`, inserts a row, rewrites the sidecar. Claude runs this from the project directory after each dev session. No HTTP session or admin UI needed to publish.

**Admin management:** Changelog entries listed in the Overview tab of the admin panel (below the Events widget). Delete button only — Claude is the sole author.

---

## DB Schema

```sql
CREATE TABLE changelog (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  published_at DATETIME NOT NULL DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN whats_new_seen_at DATETIME NULL;
```

---

## Routes

| Method | Path | Action |
|--------|------|--------|
| GET | `/whats-new` | Render page; set `whats_new_seen_at = NOW()` for current user |
| POST | `/admin/changelog/:id/delete` | Delete entry; rewrite sidecar |

---

## Sidecar File

`src/data/changelog-meta.json` — read at app startup into `app.locals.latestChangelogAt`:

```json
{ "latestAt": "2026-05-07T02:00:00.000Z" }
```

If the file is missing or empty, `app.locals.latestChangelogAt` is `null` (dot never shown).

---

## Nav Dot

Each route that renders a view passes `showChangelogDot` to the template:

```js
const showChangelogDot = user && (
  !user.whats_new_seen_at ||
  (app.locals.latestChangelogAt && new Date(app.locals.latestChangelogAt) > new Date(user.whats_new_seen_at))
);
```

In `nav.ejs`, the What's New link:

```ejs
<a href="/whats-new" class="fn-nav-link">
  What's New<% if (showChangelogDot) { %><span class="inline-block w-1.5 h-1.5 rounded-full bg-brand-600 ml-1 mb-1 align-middle"></span><% } %>
</a>
```

Same dot in the mobile drawer.

---

## `/whats-new` Page

Newest entries first. Each entry rendered as a card:

```
May 7, 2026
Expanded Admin Panel
We added a tabbed admin panel with analytics, read receipts, push
subscriber management, and more...
```

- Date: small muted text (`text-xs text-slate-400`)
- Title: `font-semibold text-slate-800 dark:text-slate-100`
- Body: `text-sm text-slate-600 dark:text-slate-300`
- Card: `bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-5`
- No pagination — changelogs stay short

On load: `UPDATE users SET whats_new_seen_at = NOW() WHERE id = ?`, then update `req.session.user.whats_new_seen_at` in-place so the dot clears immediately without a session reload.

Empty state: "Nothing here yet — check back after the next update."

---

## Admin Panel (Overview Tab)

Below the Events widget, a new "Site Changelog" card:

- Lists all entries: date, title, delete button
- Delete: POST to `/admin/changelog/:id/delete` → removes row → fetches new `MAX(published_at)` → rewrites sidecar
- No create form — Claude publishes via script

---

## `scripts/add-changelog.js`

```
Usage: node scripts/add-changelog.js --title "..." --body "..."
```

Steps:
1. Load `/home/jmull/docker/.env` via `dotenv` (app gets env from Docker at runtime; script runs directly on Pi so needs explicit path)
2. Parse `--title` and `--body` from `process.argv`
3. `INSERT INTO changelog (title, body) VALUES (?, ?)`
4. Fetch `MAX(published_at)` from changelog
5. Write `src/data/changelog-meta.json` with new `latestAt`
6. Log "✓ Entry published" and exit

---

## CLAUDE.md Instruction

Added to the family-news environment section:

> **After completing any family-news feature session:** draft and publish a What's New entry using `node scripts/add-changelog.js --title "..." --body "..."` from `/home/jmull/projects/family-news`. Write the body in plain language for family members (not developers) — 2–3 sentences describing what's new and why it's useful. Run this after pushing, before ending the session.

---

## `showChangelogDot` propagation

Every route that calls `res.render` for a member-visible view needs to pass `showChangelogDot`. The cleanest approach: a shared helper in `src/utils/changelogDot.js` that computes the boolean from `app.locals.latestChangelogAt` and `req.session.user.whats_new_seen_at`, imported by each route. Routes affected: `posts.js` (feed), `members.js`, `photos.js`, `profile.js`, `feedback.js`, `push.js` (if it renders views), and the new `whats-new.js` route itself.

---

## Style

- Follows existing `fn-*` / Tailwind pattern throughout
- Dark mode via `.dark` class prefix
- Card style matches the rest of the site (`rounded-2xl`, `shadow-sm`, serif fonts for title optional)
