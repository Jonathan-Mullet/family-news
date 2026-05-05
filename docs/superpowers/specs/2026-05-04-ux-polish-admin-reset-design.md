# Design: UX Polish, Reaction Names Tap, Admin Reset

**Date:** 2026-05-04
**Status:** Approved
**Scope:** Remove comment pill, fix reaction names interaction on mobile, add admin password/email reset.

---

## 1. Remove Comment Pill

### Problem
The `💬 N comments` pill link duplicates navigation that the inline comment form and latest-comment preview already provide. It adds visual clutter with no unique value.

### Design
Delete the `<a href="/post/<%= post.id %>">💬 ...</a>` element from `src/views/partials/post-card.ejs`. The inline comment bar and latest-comment preview remain unchanged.

### Files changed
- `src/views/partials/post-card.ejs` — remove pill element

---

## 2. Reaction Names — Tappable Summary Line

### Problem
The long-press (500ms `touchstart`) pattern for showing the reactor bottom sheet conflicts with the browser's native text-selection gesture on mobile, making it unreliable and frustrating.

### Design

**Summary line becomes a button**
In `post-card.ejs` and `post.ejs`, change the summary `<p>` element to a `<button>` with class `reaction-summary`. Style identically to the current `<p>` (same text size, color, spacing). When there are no reactions, the element is not rendered, so the button only appears when it has content to show.

**Click handler**
In `app.js`, replace the long-press block entirely with a single delegated click listener on `.reaction-summary`. On click, read `data-reaction-names` from the nearest parent `article[data-post-id]` and call `_showReactionSheet(names)`.

**Remove long-press code**
Remove all `touchstart`, `touchmove`, `touchend` handlers from the reaction button forEach. Remove the `_longPressActive` flag and the `if (_longPressActive)` guard in the click handler. The click handler on `.reaction-btn` reverts to calling `handleReactionClick` unconditionally.

**Bottom sheet unchanged**
`_showReactionSheet`, `_hideReactionSheet`, and the sheet DOM element remain as-is.

### Files changed
- `src/views/partials/post-card.ejs` — summary `<p>` → `<button class="reaction-summary ...">` 
- `src/views/post.ejs` — same change to summary line
- `src/public/js/app.js` — remove long-press handlers, add `.reaction-summary` click listener

---

## 3. Admin — Password Reset Email & Email Change

### Problem
Admins have no way to help a family member who is locked out or needs their login email updated. They can only enable/disable accounts.

### Design

**UI — inline expand panel**
Each user row in the Members table gets a `⚙` button (shown only for users other than the logged-in admin). Clicking it toggles an inline panel directly below that user's row. The panel contains two independent sections:

- **Update email**: text input pre-filled with the user's current email, a Save button. Submits to `POST /admin/users/:id/update-email`.
- **Send password reset**: a single button labelled "Send password reset email". Submits to `POST /admin/users/:id/send-reset`. No input fields required.

Both sections are clearly separated. Clicking ⚙ again collapses the panel.

**Route: `POST /admin/users/:id/update-email`**
- Validates `email` field is present and well-formed
- Checks uniqueness: rejects if another active user already has that email
- `UPDATE users SET email = ? WHERE id = ?`
- Redirects to `/admin` with flash success "Email updated for [name]." or flash error on failure

**Route: `POST /admin/users/:id/send-reset`**
- Looks up the user by `:id`; 404 if not found
- Generates a 32-byte hex token via `crypto.randomBytes`
- Inserts into `password_reset_tokens (user_id, token, expires_at)` with 1-hour expiry (same as the self-serve forgot-password flow)
- Calls existing `sendPasswordReset(user.email, token)` helper
- Redirects to `/admin` with flash success "Password reset email sent to [name]."

Both routes are inside `src/routes/admin.js` which already has `requireAdmin` applied to all routes.

**Toggle behaviour (JS)**
A small inline `<script>` block in `admin.ejs` (or added to the existing script block) handles the ⚙ button toggle — adds/removes a `hidden` class on the panel div. No new JS file needed.

### Files changed
- `src/routes/admin.js` — two new POST routes
- `src/views/admin.ejs` — ⚙ button + collapsible panel per user row, toggle JS

---

## Out of Scope
- Admin ability to set a password directly (send-email flow is sufficient)
- Admin ability to change a user's display name
- Replacing native `confirm()` dialogs with custom modals
- Any changes to delete confirmation behaviour (already fully implemented)
