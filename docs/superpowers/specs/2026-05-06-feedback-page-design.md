# Feedback Page Design

**Date:** 2026-05-06

## Goal

Give family members a simple, in-app way to report bugs and request features, with admin tracking and a courtesy email when items are resolved.

## Architecture

A single `/feedback` page with two stacked forms (bug report and feature request), backed by a `feedback` DB table. The admin panel gains a Feedback tab for reviewing and resolving submissions. Resolving an item optionally sends a personalized email to the submitter.

**New files:**
- `src/routes/feedback.js` — GET /feedback, POST /feedback/bug, POST /feedback/feature, POST /feedback/:id/resolve
- `src/views/feedback.ejs` — the feedback page (two forms, success states)
- `src/views/admin-feedback.ejs` — admin feedback tab content (item list, resolve inline form)

**Modified files:**
- `src/routes/admin.js` — add feedback tab route + resolve action
- `src/email.js` — add `sendFeedbackNotification` (to admin on submit) and `sendFeedbackResolved` (to submitter on resolve)
- `src/views/partials/nav.ejs` — add Feedback link (desktop + drawer)
- `src/views/admin.ejs` — add Feedback tab

---

## Data Layer

### `feedback` table

```sql
CREATE TABLE feedback (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NOT NULL,
  type        ENUM('bug', 'feature') NOT NULL,
  title       VARCHAR(150) NOT NULL,
  description TEXT NOT NULL,
  severity    ENUM('low', 'medium', 'high') DEFAULT NULL,
  status      ENUM('open', 'resolved') NOT NULL DEFAULT 'open',
  admin_note  TEXT DEFAULT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME DEFAULT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

- `severity` is set for bugs; NULL for feature requests.
- `admin_note` stores the optional message the admin writes when resolving. If left blank, a default message is used in the email.
- `resolved_at` is set to `NOW()` when status changes to `resolved`.

---

## `/feedback` Page

**Route:** `GET /feedback` — requires login (same `requireAuth` middleware used everywhere)

**Layout:** Two sections stacked vertically, styled consistently with the rest of the site (EJS + Tailwind CDN).

### Report a Bug

Fields:
- **Title** (text input, required, maxlength 150) — label: "Bug title"
- **Severity** (radio group, required, default Low) — options: Low / Medium / High
- **Description** (textarea, required) — placeholder: "What happened? What did you expect to happen?"
- Submit: `POST /feedback/bug`

### Request a Feature

Fields:
- **Title** (text input, required, maxlength 150) — label: "What would you like?"
- **Description** (textarea, required) — placeholder: "Describe the change or addition you'd like to see."
- Submit: `POST /feedback/feature`

### Submission behavior

- Both forms POST to their respective routes and redirect back to `/feedback?submitted=bug` or `/feedback?submitted=feature`.
- On redirect, the page shows a success banner ("Thanks! Your bug report has been sent." / "Thanks! Your request has been submitted.") above the relevant form.
- On submission: insert row into `feedback` table + fire `sendFeedbackNotification` email to admin (non-blocking, fire-and-forget).
- Server-side validation: title and description required; if missing, redirect back with `?error=1` and show an error message.

---

## Nav

The "Feedback" link is added in two places in `src/views/partials/nav.ejs`:

1. **Desktop nav** — inserted between "Photos" and "Profile" links (same `fn-nav-link` style, visible to all logged-in members)
2. **Mobile hamburger drawer** — inserted between "Photos" and "Profile" links in the drawer nav

---

## Admin Panel — Feedback Tab

**Route:** `GET /admin` with a new `?tab=feedback` query param (follows existing tab pattern in admin.ejs).

### List view

Displayed newest first. A toggle filter at the top switches between **Open** and **Resolved** (default: Open). Each item shows:

- Type badge: `Bug` (red tint) or `Feature` (blue tint)
- Severity badge for bugs: `Low` / `Medium` / `High`
- Title, submitter name, submitted date
- Description — collapsed by default, expandable with a "Show more" toggle
- Status indicator:
  - Open: "Mark Resolved" button
  - Resolved: resolved date + admin note (if any)

### Resolve flow

Clicking "Mark Resolved" on an open item expands an inline form directly below it:

- Textarea: "Optional message to [Name]" — pre-filled with: `"Thanks for the report — this has been addressed!"`
- "Confirm & Notify" button → `POST /feedback/:id/resolve`

On confirm:
1. Set `status = 'resolved'`, `resolved_at = NOW()`, `admin_note = <message or default>`
2. Fire `sendFeedbackResolved` email to the submitter (non-blocking)
3. Redirect back to `/admin?tab=feedback`

---

## Emails

### `sendFeedbackNotification(adminEmail, submitter, feedbackItem)`

Sent to the admin when a new submission arrives.

- **Subject:** `[Family News] New feedback: <title>`
- **Body:** Type, severity (if bug), submitter name, title, description.

### `sendFeedbackResolved(userEmail, userName, feedbackItem, adminNote)`

Sent to the submitter when the admin marks an item resolved.

- **Subject:** `Re: your feedback — <title>`
- **Body:** Warm opener ("Hi [Name], just wanted to let you know..."), the admin note (or default if blank), closing.

Both functions follow the same `sendMail` pattern used by existing email functions (HTML template with inline styles, `escapeHtml` on all user content).

---

## Roadmap Update

Add to `docs/superpowers/specs/2026-05-05-feature-roadmap.md` under Tier 2:

```
### Feedback page
- Single `/feedback` page accessible from the nav for all members
- Two sections: "Report a Bug" (title + severity + description) and "Request a Feature" (title + description)
- Submissions stored in DB + email notification to admin
- Admin panel Feedback tab: review open/resolved items, mark resolved with optional personal message
- Courtesy email sent to submitter when item is resolved
```
