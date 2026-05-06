# Navigation Redesign Design

## Problem

The top navigation bar overflows on mobile when a user has the admin or moderator role. An admin sees seven items — Admin, Mod, Guide, Photos, Profile, Sign out, dark toggle — which exceed the horizontal space available on small screens. The Photos link is pushed off-screen and unreachable without scrolling the nav, which the sticky positioning prevents.

## Goal

Fix the nav overflow for all roles while keeping the desktop experience unchanged. Mobile gets a hamburger drawer; desktop keeps the existing horizontal link row.

---

## Architecture

One file changes: `src/views/partials/nav.ejs`. No new routes, no DB changes.

**Mobile (viewport < 768px / Tailwind `md` breakpoint):**
- Existing link row is hidden (`hidden md:flex`).
- A hamburger button (☰) appears in the top bar, right of the dark toggle (`md:hidden`).
- Tapping the hamburger slides a drawer panel in from the right (fixed, full-height, ~70% width, z-index above nav).
- A semi-transparent dark overlay covers the rest of the screen; tapping it closes the drawer.
- An X button inside the drawer also closes it.

**Desktop (viewport ≥ 768px):**
- The existing `.fn-nav-links` row is visible and unchanged.
- The hamburger button is hidden.
- No drawer is rendered (it exists in the DOM but is off-screen and inert).

---

## Drawer Contents

The drawer renders for logged-in users only (same guard as existing nav). Layout top-to-bottom:

1. **Header strip** — user's name + role badge (e.g., "Jonathan · admin"). Styled subtly, not a primary action.
2. **Primary links** — Feed (`/`), Photos (`/photos`), Profile (`/profile`). Always shown when logged in.
3. **Separator** — visible only when user is admin or moderator.
4. **Role-gated links** — Admin (`/admin`) for admins; Mod (`/mod`) + Guide (`/guide`) for admins and moderators. Same `<% if %>` guards as current nav.
5. **Sign out** — at the bottom, styled in the danger color.

Active state: a thin left-border highlight on the link matching `window.location.pathname`. Implemented with inline JS that runs immediately on page load (no DOMContentLoaded needed since the script is inline after the nav HTML).

---

## CSS

Two new classes appended to `theme.css`:

**`.fn-drawer`** — fixed right panel. Starts off-screen (`transform: translateX(100%)`), slides in when `.fn-drawer--open` is added (`transform: translateX(0)`). Transition: `transform 0.25s ease`. Width: 70vw, max-width 280px. Full viewport height. Background white / dark background in dark mode. z-index 100.

**`.fn-drawer-overlay`** — fixed full-screen backdrop. `background: rgba(0,0,0,0.4)`. Hidden by default (`opacity: 0; pointer-events: none`), visible when `.fn-drawer--open` is present on the drawer (via adjacent CSS or a toggled class). z-index 99 (below drawer, above nav content).

Both classes use `transform`/`opacity` for show/hide — no Tailwind dynamic classes (respects the Tailwind CDN limitation).

---

## JavaScript

Inline `<script>` block at the bottom of `nav.ejs` (after the nav HTML). Three small functions:

- `_openDrawer()` — adds `.fn-drawer--open` to `#fn-drawer` and `#fn-drawer-overlay`, sets `document.body.style.overflow = 'hidden'`.
- `_closeDrawer()` — removes the class, restores body overflow.
- Active-link detection — loops over drawer `<a>` elements, sets left-border style on any whose `href` matches `window.location.pathname` (exact match for `/`, `startsWith` for others).

No external dependencies. The hamburger button calls `_openDrawer()`, the X button and overlay call `_closeDrawer()`.

---

## Dark Mode

Drawer background and text follow the existing dark-mode palette. New dark-mode rules appended to `theme.css` alongside the drawer styles:
- `.dark .fn-drawer` — `background: #221510; border-left-color: rgba(154,126,90,0.2);`
- `.dark .fn-drawer-overlay` — unchanged (dark overlay looks fine in both modes).
- Drawer link text follows `.dark .fn-nav-link` colors.

---

## Out of Scope

- Desktop nav is not touched (no rearrangement, no dropdowns).
- No animation on the overlay (opacity snap is fine; drawer slide is the primary visual cue).
- No swipe-to-close gesture (not worth the complexity for a family app).
- No persistent open/closed state (drawer always starts closed on page load).
