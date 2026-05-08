# Nav Cleanup, Feedback Page Redesign & Notification AJAX Design

## Overview

Four focused improvements to the family-news site:

1. **Feedback link in drawer** — restore the Feedback nav link in the hamburger drawer
2. **Notification AJAX** — prevent scroll-to-top when notification toggles are saved
3. **Feedback page redesign** — ask "bug or feedback?" first, then reveal the appropriate form
4. **Desktop nav cleanup** — replace cluttered text links with icon shortcuts

---

## Change 1: Feedback Link in Drawer

**Goal:** Restore the Feedback link in the hamburger drawer so members can find it.

**Files:**
- Modify: `src/views/partials/nav.ejs`

**Design:**
- Add a `Feedback` link in the drawer nav immediately after the existing `What's New` link
- Same `<a>` styling as all other drawer nav links
- href: `/feedback`
- No route or CSS changes required

---

## Change 2: Notification Saves via AJAX

**Goal:** Toggling an email or push notification preference no longer scrolls the page to the top.

**Files:**
- Modify: `src/views/settings.ejs`
- Modify: `src/routes/settings.js`

**Design:**

### Client-side (`settings.ejs`)

Replace the existing `this.form.submit()` calls on all notification toggles with a `saveToggle(form)` helper function.

`saveToggle(form)`:
1. Collects `new FormData(form)`
2. `fetch(form.action, { method: 'POST', body, headers: { 'X-Requested-With': 'XMLHttpRequest' } })`
3. On success: no visible change (toggle already reflects state)
4. On error: revert the checkbox to its previous state; briefly add an error class to the toggle row for visual feedback

All toggle `change` event listeners call `saveToggle(this.closest('form'))` instead of `this.form.submit()`.

This applies to:
- Email notification toggles (posts to `/settings/notifications`)
- Push prefs toggles (posts to `/settings/push-prefs`)

### Server-side (`settings.js`)

Both `/settings/notifications` POST and `/settings/push-prefs` POST handlers check for AJAX:

```js
const isAjax = req.headers['x-requested-with'] === 'XMLHttpRequest';
// ... existing save logic ...
if (isAjax) return res.json({ ok: true });
res.redirect('/settings');
```

Non-AJAX requests (direct form submit or graceful fallback) continue to redirect as before.

---

## Change 3: Feedback Page Redesign

**Goal:** Instead of immediately showing a form, the feedback page first asks "What's on your mind?" and reveals the appropriate form after the user picks bug or feedback.

**Files:**
- Modify: `src/views/feedback.ejs`
- Modify: `src/routes/feedback.js` (add optional `type` field handling)

**Design:**

### Page structure

```
"What's on your mind?"   ← heading

[🐛 Report a bug]  [💡 Share feedback]   ← pill buttons, horizontally centered

─── form appears here after pill selection ───
```

### Pill behavior

- Both pills unselected on page load; no form visible
- Clicking a pill: highlights it (filled/active style), smoothly reveals the corresponding form with a CSS height transition
- Clicking the other pill: swaps highlight and swaps form (no page reload)
- Clicking an already-active pill: no change (idempotent)

### Bug form fields

| Field | Type | Required |
|-------|------|----------|
| Subject | text input | yes |
| Description | textarea | yes |
| Steps to reproduce | textarea | no |
| `<input type="hidden" name="type" value="bug">` | hidden | — |

### Feedback form fields

| Field | Type | Required |
|-------|------|----------|
| Subject | text input | yes |
| Message | textarea | yes |
| `<input type="hidden" name="type" value="feedback">` | hidden | — |

### Route changes (`feedback.js`)

- POST handler reads `req.body.type` (`bug` or `feedback`) — store alongside the submission or use for email subject labeling
- If the field is absent (old form submissions), default to `feedback`
- Success/error handling unchanged from current behavior

### CSS

- `.fn-feedback-pills` — flex row, centered, gap between pills
- `.fn-feedback-pill` — outlined pill button; `.fn-feedback-pill--active` — filled state matching site accent
- `.fn-feedback-form-wrap` — `overflow: hidden; max-height: 0` initially; `max-height: 800px` when active; `transition: max-height 0.3s ease`

---

## Change 4: Desktop Nav Cleanup

**Goal:** The desktop navbar is cluttered with text links. Replace them with four icon shortcuts.

**Files:**
- Modify: `src/views/partials/nav.ejs`
- Modify: `src/public/css/theme.css`

**Design:**

### Desktop nav right side — after cleanup

| Element | Action |
|---------|--------|
| Search icon button | Navigate to `/search` |
| Notifications bell (with unread dot if applicable) | Navigate to `/notifications` |
| Dark-mode toggle | Toggle dark mode (existing behavior) |
| Hamburger button | Open drawer (existing behavior) |

All existing text links (`Feed`, `Photos`, and any others) are removed from the desktop nav bar. They remain in the drawer, which the hamburger opens on both mobile and desktop.

### CSS changes

- Remove or hide `.fn-nav__links a` text-link items on desktop (or restructure the element)
- `.fn-nav-icon-btn` — icon button base style: no background, border-radius, padding for hit area, hover state with subtle background fill matching the existing toggle hover
- `.fn-nav-icon-btn svg` — consistent icon sizing (20px)
- The notifications dot already exists on the bell in the drawer; replicate it on the desktop nav bell using the same `<% if (unreadCount > 0) %>` conditional

### Behavior notes

- The hamburger is already present on desktop (it opens the drawer). No JS changes needed — just CSS restructuring to remove the text links from the bar.
- The search icon is a plain `<a href="/search">` wrapped in the icon button style, not a drawer-inline search (full drawer search is a mobile-first pattern).
- The unread dot on the desktop notifications icon uses the same `locals.unreadCount` already available to the nav partial.

---

## What Is Not Changing

- Drawer contents and structure (already has all nav links)
- Mobile nav layout
- The feedback route's email delivery logic
- Any settings page sections other than the notification toggle submit behavior
