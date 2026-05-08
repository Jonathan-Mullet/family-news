# Settings Redesign — Design Spec

**Date:** 2026-05-08

---

## Overview

Consolidate the hamburger drawer and profile/settings experience into a single, clean `/settings` page. The current `/profile` page has 8 stacked cards with inconsistent visual weight. The drawer lists "Profile" and "Feedback" as separate items alongside primary navigation. This redesign:

1. Replaces `/profile` with `/settings` (all existing functionality, reorganised)
2. Collapses "Profile" + "Feedback" drawer entries into a single "Settings" link
3. Redesigns the drawer with two-tier link hierarchy (primary / secondary) and section labels

---

## Scope

- **In scope:** Drawer restructure, new settings page layout, inline edit UX, notification toggle UX, feedback link relocation
- **Out of scope:** Any changes to authentication flows, push subscription logic, admin/mod pages, or notification delivery

---

## Drawer Changes

File: `src/views/partials/nav.ejs`

### Primary links (larger, with icons)
Feed · Search · Photos · Notifications

### Secondary links — "Account" section label
Settings · What's New

### Secondary links — "Admin" section label (admin/mod only)
Admin (admin only) · Mod · Guide

### Footer
Sign out button (bordered, full-width)

**Removed:** standalone "Profile" and "Feedback" drawer links — both are now reachable from Settings.

---

## Route Changes

### New: `src/routes/settings.js`
Mount at `/settings` in `src/app.js`. Contains all handlers moved from `src/routes/profile.js`:

| Method | Path | Action |
|--------|------|--------|
| GET | `/settings` | Render settings page |
| POST | `/settings/name` | Update display name |
| POST | `/settings/birthday` | Update birthday |
| POST | `/settings/email` | Update email (requires current password) |
| POST | `/settings/password` | Change password |
| POST | `/settings/avatar` | Upload avatar image |
| POST | `/settings/avatar/remove` | Remove avatar |
| POST | `/settings/notifications` | Update email notification prefs |
| POST | `/settings/push-prefs` | Update push notification prefs |

### Modified: `src/routes/profile.js`
Replace all handlers with a single redirect:
```js
router.get('/', (req, res) => res.redirect(301, '/settings'));
```
Old bookmarks and any hardcoded `/profile` links continue to work.

### Modified: `src/app.js`
Add `/settings` route registration after the existing `/profile` line:
```js
app.use('/settings', require('./routes/settings'));
// /profile already registered — now just redirects to /settings
```

---

## Settings Page Layout

File: `src/views/settings.ejs`

Page title: **Settings** (Playfair Display italic, same style as other page titles)

Three card sections, each with a small uppercase section label and icon in the header.

### Section 1 — Profile
- Avatar row: 48px circle + "Change photo" label + sub-label "JPG or PNG, up to 5 MB". Clicking anywhere in the row opens the file picker (hidden `<input type="file">`). When `user.avatar_url` is set, a small "Remove" link appears beneath the avatar initials/image (submits to `POST /settings/avatar/remove`).
- Display name row: label + current value + "Edit" button → inline form
- Birthday row: label + formatted date (e.g. "March 14, 1985") + "Edit" button → inline form. If `user.birthday` is null, show "Not set" and an "Add" button instead of "Edit". Inline form uses three `<select>` elements (Month / Day / Year), same as the current profile page.

### Section 2 — Account
- Email row: label + masked email + "Change" button → inline form (requires current password)
- Password row: label + "••••••••" + "Change" button → inline form
- Role row: label + role value (read-only, no edit button)

### Section 3 — Notifications
- "New posts" toggle: email notification for new posts (auto-saves on toggle)
- "Comments on my posts" toggle: email notification for comments (auto-saves on toggle)
- "Push notifications" toggle row: wraps the existing push subscription state machine. The `app.js` push JS already manages four state divs by ID. The settings.ejs must preserve those IDs exactly:
  - `#push-section` on the containing element (with the same `data-notify-*` attributes)
  - `#push-state-default` — shown when not subscribed; contains the push enable button
  - `#push-state-enabled` — shown when subscribed; contains the push prefs form and disable button
  - `#push-state-denied` — shown when browser blocked
  - `#push-ios-notice` — shown on iOS before PWA install
  
  The toggle switch UI is layered on top: the push row toggle is checked when `push-state-enabled` is visible. Clicking the toggle when unchecked triggers the existing `#push-enable-btn` click programmatically; clicking when checked triggers `#push-disable-btn`. The underlying state div structure is hidden (CSS `display:none`) in the new layout — the toggle is the only visible control. Push prefs (posts/comments/big-news checkboxes) are moved into a sub-row that appears beneath the push toggle row when enabled, using the same `POST /settings/push-prefs` form.

### Feedback link
Below the last section, a quiet text link: "Send feedback to the admin" → `/feedback`. Uses the same style as a secondary nav link, not a full card.

---

## Inline Edit UX

Each editable row has two states:

**Viewing state** (default):
```
| Display name     Jonathan          [Edit] |
```

**Editing state** (after clicking Edit):
```
| Display name     Jonathan          [Edit] |  ← row fades slightly
| ┌─────────────────────────────────────┐   |
| │ [input: Jonathan              ] [Save] │   |
| │                              [Cancel] │   |
| └─────────────────────────────────────┘   |
```

Implementation:
- Each row has a hidden `.fn-row-form` div below it (`display:none`)
- Clicking "Edit"/"Change" adds `.fn-row--editing` to the row, shows the form via `display:block`
- Only one row can be open at a time — opening a row closes any other open row
- "Cancel" restores the row state in JS (no page reload)
- "Save" submits the form normally (POST → redirect with flash message)
- Form inputs pre-filled with current values

---

## Notification Toggle UX

Toggles are `<input type="checkbox">` styled as pill switches (CSS only). Auto-save on change:

```js
toggle.addEventListener('change', () => toggle.closest('form').submit());
```

Each toggle is its own `<form>` with a hidden input for the preference key. This avoids a single large form where checking one toggle requires re-submitting all values.

The push notification toggle is a special case — it does not use a form submit. Clicking it:
- If push not subscribed → calls the existing push enable flow (`app.js` push logic)
- If push subscribed → calls push unsubscribe
- The toggle's checked state reflects actual subscription status, not a DB preference

---

## Flash Messages

Success and error flash messages appear at the top of the settings page (same `.fn-flash-success` / `.fn-flash-error` classes used on the current profile page).

---

## CSS

All new CSS goes in `src/public/css/theme.css` under a `/* Settings page */` comment block. Reuse existing classes where possible (`.fn-settings-page`, `.fn-settings-card-title`, `.fn-btn`, `.fn-input`, `.fn-label`, `.fn-field`, `.fn-checkbox`, `.fn-checkbox-label`).

New classes needed:
- `.fn-settings-section` — outer card shell. Reuses the same visual style as `.fn-settings-card` (white bg, border, border-radius, shadow). Use `.fn-settings-card` as the outer shell in `settings.ejs` to avoid duplicating CSS; `.fn-settings-section` is an alias added to the same element for specificity if needed.
- `.fn-settings-section-header` — icon + uppercase label row at top of each section
- `.fn-settings-row` — horizontal row with label, value, and optional action button
- `.fn-settings-row--editing` — state modifier
- `.fn-row-form` — hidden inline form container
- `.fn-toggle` — pill toggle CSS (checkbox styled as switch)
- `.fn-settings-feedback-link` — quiet footer link style

---

## What's Not In Scope

- Changing how push subscriptions are stored or managed
- Adding new notification types
- Tabbed navigation within the settings page
- Any admin-facing settings (those remain on `/admin`)
- Account deletion
