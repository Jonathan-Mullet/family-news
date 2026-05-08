# Search — Design Spec

**Date:** 2026-05-08

---

## Overview

Add a `/search` page that lets family members find old posts by keyword. Results are ranked by MySQL FULLTEXT relevance, displayed as compact rows with a highlighted snippet showing where the term matched.

---

## Scope

- **Searches:** post `title` + `content` only
- **Excludes:** comments, member names, deleted posts, future scheduled posts (unless authored by the searcher — consistent with feed)
- **Max results:** 50 (no pagination; family dataset will never meaningfully exceed this)

---

## Data Layer

### Migration

At app startup, add a FULLTEXT index (try/catch, safe to run on every start):

```sql
ALTER TABLE posts ADD FULLTEXT INDEX ft_posts (title, content);
```

### Query

```sql
SELECT p.*, u.name AS author_name, u.avatar_url AS author_avatar,
       MATCH(p.title, p.content) AGAINST(? IN NATURAL LANGUAGE MODE) AS score
FROM posts p
JOIN users u ON p.user_id = u.id
WHERE p.deleted_at IS NULL
  AND (p.publish_at IS NULL OR p.publish_at <= NOW() OR p.user_id = ?)
  AND MATCH(p.title, p.content) AGAINST(? IN NATURAL LANGUAGE MODE)
ORDER BY score DESC
LIMIT 50
```

Parameters: `[query, userId, query]`

---

## Route

**File:** `src/routes/search.js`

**`GET /search`**
- If no `?q=` param (or fewer than 2 chars): render empty state (search box only)
- If `?q=` present and ≥ 2 chars: run query, render results
- No POST, no separate API — server-renders everything

**Registration in `app.js`:**
```js
app.use('/search', require('./routes/search'));
```

---

## Snippet Generation

Server-side, after fetching results:

1. Find the first occurrence of the query term in `content` (case-insensitive)
2. Extract ~150 chars centered on the match (with word-boundary trimming)
3. Wrap the matching term(s) in `<mark>` tags
4. Fall back to first 150 chars of content if no positional match found
5. Escape HTML before inserting — never render raw user content

---

## View

**File:** `src/views/search.ejs`

### Layout

```
[ Search input field              ] [Search]

X results for "birthday"          ← shown when results exist

┌──────────────────────────────────────────┐
│ [avatar] Alice Mullet          Jan 3     │
│ **Grammy's Birthday Party**              │
│ ...we celebrated Grammy's **birthday**   │
│ at the lake house this summer...         │
└──────────────────────────────────────────┘
┌──────────────────────────────────────────┐
│ [avatar] Bob Mullet            Dec 12    │
│ ...don't forget Grammy's **birthday**    │
│ is coming up next week!                  │
└──────────────────────────────────────────┘
```

### States

| State | Display |
|-------|---------|
| No query | Search box + "Search posts by keyword" prompt |
| Query < 2 chars | Search box only (no error, just empty) |
| Results found | Count line + compact result rows |
| No results | "No posts found for 'term'. Try a different word." |

### Result Row

- Author avatar (initials fallback, same component pattern as feed)
- Author name + relative/formatted date (right-aligned)
- Post title in bold — if no title, use first line of content
- Snippet with `<mark>` highlight
- Entire row links to `/post/:id`

### Highlight Styling

`<mark>` styled with amber background (warm palette, consistent with site):
```css
mark { background: #fbbf24; color: inherit; border-radius: 2px; padding: 0 2px; }
.dark mark { background: #92400e; color: #fef3c7; }
```

---

## Navigation

- Add "Search" link to **desktop nav** (alongside Feed, Photos, Notifications)
- Add "Search" link to **mobile hamburger drawer** (same position)
- No dot/badge indicator needed

---

## Error Handling

- Query with no results → friendly no-results message (not an error)
- MySQL error during search → log server-side, render "Search is temporarily unavailable" message
- Very short query (< 2 chars) → empty state, no DB call made

---

## What's Not In Scope

- Searching comments
- Searching member names
- Pagination (50-result cap is sufficient)
- Search history / recent searches
- Filtering by date range, author, or post type
- Any client-side / JS-powered live search
