# Photo Library Design

## Overview

A dedicated `/photos` page showing all family photos in a scrollable square grid, filterable by family member. Photos are sourced from the existing `post_photos` table — no new storage or upload flow needed.

---

## Decisions

| Question | Decision |
|---|---|
| Layout | Uniform square grid, 3 cols mobile / 4 cols desktop, `object-fit: cover` |
| Filter UI | Scrollable avatar chip row at top (profile photo or initials fallback) |
| Click behavior | Opens existing `_openLightbox()` with full page photo set (swipeable) |
| Pagination | 48 photos/page (divisible by 3 and 4), prev/next controls |
| "View post" link | Out of scope — lightbox is photo-only |
| New DB tables | None |
| Access | Members only (same as all routes) |

---

## Architecture

### Route: `src/routes/photos.js` (new file)

`GET /photos` — optional query params: `member` (user ID) and `page` (1-based, default 1).

**Two queries per request:**

**1. Members with photos** (for filter chips):
```sql
SELECT DISTINCT u.id, u.name, u.avatar_url
FROM users u
JOIN posts p ON p.user_id = u.id
JOIN post_photos pp ON pp.post_id = p.id
WHERE p.deleted_at IS NULL
  AND (p.publish_at IS NULL OR p.publish_at <= NOW())
  AND u.active = 1
ORDER BY u.name ASC
```

**2. Photos (paginated)**:
```sql
SELECT pp.photo_url, pp.post_id, p.created_at, p.user_id AS author_id
FROM post_photos pp
JOIN posts p ON pp.post_id = p.id
WHERE p.deleted_at IS NULL
  AND (p.publish_at IS NULL OR p.publish_at <= NOW())
  [AND p.user_id = ?  -- when member filter is active]
ORDER BY p.created_at DESC, pp.sort_order ASC
LIMIT 48 OFFSET ?
```

**3. Total count** (same WHERE clause, no ORDER/LIMIT) — for pagination controls.

Route renders `photos.ejs` with: `{ photos, members, currentMember, page, totalPages, user }`.

### View: `src/views/photos.ejs` (new file)

Uses the standard layout (`head.ejs` + `nav.ejs`).

**Structure:**
```
[nav]
<main>
  <h1>Photos</h1>
  [avatar chip row]
  [photo grid]
  [pagination controls]
</main>
```

**Avatar chip row:**
- Horizontally scrollable (`overflow-x: auto`, `-webkit-overflow-scrolling: touch`, no scrollbar)
- First chip: "All" — always present, active when no member filter
- One chip per member: their `avatar_url` as a circle image (or first-initial fallback div if no avatar), name below in small text
- Each chip is an `<a>` link: `href="/photos"` for All, `href="/photos?member=<id>"` for members
- Active chip gets a colored ring (brand color border)

**Photo grid:**
- CSS grid, 3 columns on mobile, 4 on ≥640px
- Each cell: `<img>` with `aspect-ratio: 1`, `object-fit: cover`, `width: 100%`, cursor pointer
- `data-photo-url` and `data-index` attributes on each image for lightbox wiring
- `onclick` calls `_openLightbox(allPhotoUrls, index)` — photo URLs array is JSON-encoded into a `<script>` block as a JS variable

**Lightbox wiring:**
```html
<script>
  const _galleryPhotos = <%- JSON.stringify(photos.map(p => p.photo_url)) %>;
</script>
```
Each `<img>` onclick: `_openLightbox(_galleryPhotos, <%= index %>)`.

The existing lightbox (`_lightbox`, `_openLightbox`) in `app.js` is used as-is — no modifications needed.

**Pagination controls:**
- Shown only when `totalPages > 1`
- Previous / Next links, current page indicator ("Page 2 of 5")
- Preserve `member` param in pagination links

**Empty state:**
- No member filter active + no photos: "No photos yet." 
- Member filter active + no results: "No photos from [name] yet."

### Nav: `src/views/partials/nav.ejs` (modify)

Add before the Profile link:
```ejs
<a href="/photos" class="fn-nav-link">Photos</a>
<div class="fn-nav-sep"></div>
```

### Registration: `src/app.js` (modify)

```js
const photosRouter = require('./routes/photos');
app.use('/photos', photosRouter);
```

---

## CSS

New rules appended to `src/public/css/theme.css`:

```css
/* ── Photo library ───────────────────────────────────────────────────────────── */
.photo-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 3px;
}
@media (min-width: 640px) {
  .photo-grid { grid-template-columns: repeat(4, 1fr); }
}
.photo-grid img {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  cursor: pointer;
  display: block;
}
.photo-chip-row {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding: 12px 0 8px;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
.photo-chip-row::-webkit-scrollbar { display: none; }
.photo-chip {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  text-decoration: none;
}
.photo-chip img, .photo-chip .photo-chip-initial {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid transparent;
}
.photo-chip-initial {
  display: flex;
  align-items: center;
  justify-content: center;
  background: #94a3b8;
  color: white;
  font-weight: 600;
  font-size: 1rem;
}
.photo-chip.active img, .photo-chip.active .photo-chip-initial {
  border-color: #8b5e3c;
}
.photo-chip span {
  font-size: 0.7rem;
  color: #64748b;
  max-width: 52px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dark .photo-chip span { color: #9a7e5a; }
```

---

## Files

| File | Change |
|---|---|
| `src/routes/photos.js` | **Create** — photos route |
| `src/views/photos.ejs` | **Create** — photos page template |
| `src/app.js` | Modify — mount `/photos` router |
| `src/views/partials/nav.ejs` | Modify — add Photos nav link |
| `src/public/css/theme.css` | Modify — append photo library CSS |

---

## Edge Cases

- **Member with no avatar:** Renders a circle div with their first initial, same size/shape as an avatar image.
- **Zero photos total:** Page renders with empty state message, chip row shows only "All" (no member chips since no members have photos).
- **Single photo post:** Works the same — `post_photos` always has the row.
- **Deleted posts:** `WHERE p.deleted_at IS NULL` excludes them; their photos disappear from the library automatically.
- **Scheduled posts not yet published:** `publish_at <= NOW()` excludes them, same as feed behavior.
- **Page out of range:** If `page` exceeds `totalPages`, redirect to page 1 (or clamp silently).
- **Member param with no photos:** The chip row query only includes members who have at least one photo, so this state is unreachable via the UI. If someone crafts a direct `?member=<id>` URL for a member with no photos, render the empty state without erroring.

---

## Out of Scope

- Upload from photos page (use post compose)
- Delete photos from library (use post edit)
- Download button
- Date grouping headers
- Infinite scroll (pagination is sufficient)
- Photo count badges on chips
