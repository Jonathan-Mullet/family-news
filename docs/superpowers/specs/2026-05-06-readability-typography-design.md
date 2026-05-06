# Readability & Typography Overhaul — Design Spec

## Goal

Improve text legibility across the whole site for older family members. Raise body copy and metadata from the current 12–14px range to a "meaningful" scale (16px body, 14px metadata) with an 18px post body on the post detail page where sustained reading happens.

---

## Approach

Surgical Tailwind class replacements in EJS templates. No root font-size change, no CSS overrides — every change is a deliberate class swap. This keeps spacing/padding unaffected and every diff reviewable.

**Size scale (Tailwind → px):**
- `text-xs` = 12px (current metadata)
- `text-sm` = 14px (current body; becomes new metadata target)
- `text-base` = 16px (new body target for feed + comments)
- `text-lg` = 18px (new post body target on post detail — "touch of bold")

---

## Section 1 — Feed card (`src/views/partials/post-card.ejs`)

### Post header
| Element | Current | New |
|---------|---------|-----|
| Author name | `text-sm` | keep (`text-sm` = 14px, already good) |
| Timestamp / location line | `text-xs` | `text-sm` |

### Post body
| Element | Current | New |
|---------|---------|-----|
| Post content `<p>` | `text-sm leading-relaxed` | `text-base leading-relaxed` |

### Inline edit form (edit mode)
| Element | Current | New |
|---------|---------|-----|
| Title input | `text-sm` | keep |
| Content textarea | `text-sm` | keep |
| Cancel button | `text-xs` | `text-sm` |
| Save button | `text-xs` | `text-sm` |

### Link preview
| Element | Current | New |
|---------|---------|-----|
| OG description | `text-xs` | `text-sm` |

### Reactions
| Element | Current | New |
|---------|---------|-----|
| Reaction count badge | `text-xs` | `text-sm` |
| Emoji picker toggle ("＋") | `text-xs` | `text-sm` |
| Reaction summary line | `text-xs` | `text-sm` |

### Comment section — State A (no comments, pill input)
| Element | Current | New |
|---------|---------|-----|
| Pill input | `text-xs` | `text-sm` |
| Send button | `text-xs` | `text-sm` |

### Comment section — State B (toggle + expanded block)
| Element | Current | New |
|---------|---------|-----|
| Toggle label ("💬 N comments…") | `text-xs` | `text-sm` |
| Comment author name | `text-xs` | `text-sm` |
| Comment content | `text-sm` | `text-base` |
| Comment timestamp / Reply link | `text-xs` | `text-sm` |
| Reply author name | `text-xs` | `text-sm` |
| Reply content | `text-sm` | `text-base` |
| Reply timestamp | `text-xs` | `text-sm` |
| Expanded comment form input | `text-xs` | `text-sm` |
| Expanded comment form send button | `text-xs` | `text-sm` |

---

## Section 2 — Post detail (`src/views/post.ejs`)

### Post header
| Element | Current | New |
|---------|---------|-----|
| Author name (already `text-xs`) | `text-xs` | `text-sm` |
| Timestamp | `text-xs` | `text-sm` |

### Post body
| Element | Current | New |
|---------|---------|-----|
| Post content `<p>` | `text-sm` | `text-lg` — 18px, "touch of bold" |
| Edit title input | `text-sm` | keep |
| Edit textarea | `text-sm` | keep |
| Edit cancel button | `text-xs` | `text-sm` |
| Edit save button | `text-xs` | `text-sm` |

### Link preview
| Element | Current | New |
|---------|---------|-----|
| OG description | `text-xs` | `text-sm` |

### Reactions
| Element | Current | New |
|---------|---------|-----|
| Reaction count badge | `text-xs` | `text-sm` |
| Reaction summary line | `text-xs` | `text-sm` |

### Comments
| Element | Current | New |
|---------|---------|-----|
| "No comments yet" | `text-sm` | keep |
| Comment author name | `text-xs` | `text-sm` |
| Comment content `<p>` | `text-sm` | `text-base` |
| Comment timestamp | `text-xs` | `text-sm` |
| Reply button | `text-xs` | `text-sm` |
| Delete button | `text-xs` | `text-sm` |
| Reply author name | `text-xs` | `text-sm` |
| Reply content `<p>` | `text-sm` | `text-base` |
| Reply timestamp | `text-xs` | `text-sm` |
| Reply delete button | `text-xs` | `text-sm` |
| Overflow reply block (same structure) | same | same as above |
| "Show N more replies" toggle button | (inherits `fn-reply-toggle`) | update `fn-reply-toggle` font-size in theme.css: `0.75rem` → `0.875rem` |
| New comment input | `text-sm` | keep |
| Post Comment button | `text-sm` | keep |

---

## Section 3 — Other templates

These templates use `text-sm` for most body text already (good) and `text-xs` sparingly. Apply the same `text-xs` → `text-sm` rule to any user-facing reading content in:

### `src/views/member.ejs`
The member profile page shows a post list using `post-card.ejs` (already handled above) and a profile header. Any `text-xs` labels in the profile header → `text-sm`.

### `src/views/profile.ejs`
Push notification notice text already uses `text-sm`. The amber warning banner uses `text-xs` — bump to `text-sm`.

### `src/views/guide.ejs`
If any `text-xs` body copy exists → `text-sm`. Section headings stay as-is.

### `src/views/partials/nav.ejs`
Nav links are `text-sm` already. The hamburger drawer secondary text (`text-xs` role/name badges) → `text-sm`.

### Login / register / reset / forgot-password
These are mostly `text-sm` already. Any `text-xs` error messages or helper text → `text-sm`.

---

## Section 4 — CSS change in `theme.css`

The `.fn-reply-toggle` pill button currently sets `font-size: 0.75rem` (12px). Update to `0.875rem` (14px) to match the rest of the metadata scale.

No other theme.css changes needed — spacing, padding, border-radius, and color are unchanged.

---

## What stays the same

- All `min-h-[*]` touch targets — already sized for touch, don't need to change
- Edit/compose form inputs — `text-sm` is fine for composition
- Admin/mod pages — these are functional UIs, not reading contexts
- `text-lg`, `text-xl`, `text-2xl` headings — already large enough
- Avatar sizes, icon sizes, spacing/padding — untouched

---

## Files changed

| File | Change |
|------|--------|
| `src/views/partials/post-card.ejs` | Many `text-xs` → `text-sm`; post body `text-sm` → `text-base`; comment content `text-sm` → `text-base` |
| `src/views/post.ejs` | Post body `text-sm` → `text-lg`; comment/reply content `text-sm` → `text-base`; metadata `text-xs` → `text-sm` throughout |
| `src/public/css/theme.css` | `.fn-reply-toggle` font-size `0.75rem` → `0.875rem` |
| `src/views/partials/nav.ejs` | Drawer secondary text `text-xs` → `text-sm` |
| `src/views/profile.ejs` | Amber banner `text-xs` → `text-sm` |
| `src/views/member.ejs` | Profile header `text-xs` labels → `text-sm` |
| `src/views/guide.ejs` | Body copy `text-xs` → `text-sm` if present |
| `src/views/login.ejs` / `register.ejs` / `forgot-password.ejs` / `reset-password.ejs` | Helper/error text `text-xs` → `text-sm` if present |

No new routes, no DB changes, no JS changes.
