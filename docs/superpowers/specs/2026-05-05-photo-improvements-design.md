# Photo Improvements Design

**Date:** 2026-05-05

## Goal

Fix the two core photo pain points: non-square images getting cropped, and no way to post multiple photos in a gallery. Add a lightbox for full-size viewing.

## Current State

- **Backend:** Fully supports up to 5 photos per post (`post_photos` table, `handleMultiUpload` middleware, Sharp processing to 1200px wide at natural aspect ratio). No changes needed here.
- **Upload UI:** `<input type="file" name="photos">` exists with thumbnail preview JS, but is missing the `multiple` attribute — so users can only select one file at a time.
- **Multi-photo display:** Horizontal scroll of fixed 176×176px squares with `object-cover` — all photos cropped to squares.
- **Single photo display:** `w-full object-cover max-h-80` (max 320px tall) — portrait images get clipped at 320px.
- **Lightbox:** None. No tap-to-expand.

## Design Decisions

### Multi-photo: Focused Carousel

When a post has 2–5 photos, photos display as a horizontal focused carousel:

- **Active photo:** Displayed at its natural aspect ratio (no cropping). Full width of the card content area.
- **Inactive photos:** Compact squares (~52×52px) peeking in from the sides of the carousel.
- **Navigation:**
  - **Touch (primary):** Swipe left/right on the carousel to advance.
  - **Desktop:** Hover over the carousel to reveal small ‹ › arrow buttons overlaid on the left and right edges. Arrows are hidden on touch devices.
- **Position indicator:** Row of dot indicators below the carousel. Active dot is wider (pill shape) and brand-colored; inactive dots are small circles in slate.
- **Lightbox:** Tapping the active photo opens the full-size lightbox.

### Single Photo

When a post has exactly 1 photo:

- Displayed full-width at its natural aspect ratio (no forced cropping).
- Capped at 500px tall — extremely tall portrait shots don't dominate the feed. Content below the cap is visible in the lightbox.
- Tapping the photo opens the lightbox.

### Lightbox

- Full-screen dark overlay (`rgba(0,0,0,0.92)`).
- Current photo displayed centered, scaled to fit the screen.
- For multi-photo posts: swipeable left/right between all photos. Desktop arrow buttons on sides.
- ✕ button top-right to close. Tapping the dark backdrop also closes.
- Prevents scroll on the body while open.

### Upload Fix

Add `multiple` attribute to the existing `<input type="file" name="photos">` in `feed.ejs`. The backend already accepts up to 5 files via `upload.array('photos', 5)`.

## Files to Modify

| File | Change |
|---|---|
| `src/views/feed.ejs` | Add `multiple` to photo file input |
| `src/views/partials/post-card.ejs` | Replace photo display section with carousel + single-photo markup |
| `src/public/js/app.js` | Add carousel logic, swipe handling, desktop arrows, lightbox |
| `src/views/post.ejs` | Same photo display improvements as post-card (single post detail view) |

## Behavior Notes

- The Sharp upload pipeline already stores photos at natural aspect ratio — the squareness was only in the display CSS. No re-processing of existing photos needed.
- Tailwind CDN limitation: carousel and lightbox elements that are shown/hidden via JS must use inline styles, not Tailwind utility classes.
- Lightbox and carousel JS lives in `app.js` alongside the existing emoji picker and reaction logic.
- The existing `photo-rm-btn` thumbnail preview in the post-creation form is unaffected — that's the upload UI, not the display.
