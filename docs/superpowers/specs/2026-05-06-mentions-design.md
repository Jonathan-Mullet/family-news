# @Mentions Design

## Overview

Allow family members to @mention each other in posts and comments. Mentions notify the mentioned person (push + email) and render as clickable links to their member profile.

---

## Decisions

| Question | Decision |
|---|---|
| Purpose | Notify + link to profile |
| Autocomplete | Dropdown appears immediately on `@` |
| Rendered style | Purple bold text, clickable link |
| Unmatched @names | Render as plain text, silently ignored |
| Inserted name format | First name if unique, full name if ambiguous |
| Storage approach | Server resolves on save → `@[Name](id)` tokens |

---

## Storage Format

Mentions are stored in post/comment `content` as `@[Alice](42)` where `42` is the user's ID. Raw `@Name` text typed in the textarea is resolved server-side at save time.

**Example stored content:**
```
Great seeing everyone! @[Alice](42) your potato salad was amazing 😄
```

---

## Architecture

### `src/utils/mentions.js` (new file)

Two exported functions:

**`resolveMentions(content, pool)`** — called on post/comment create and edit.
1. Scan content for `@(\w+(?:\s+\w+)?)` patterns (greedy — try two-word match first, fall back to one word)
2. Load all active users from DB once
3. For each `@Token`:
   - Try exact full-name match (case-insensitive)
   - If no match, try first-name match
   - If matched, replace `@Token` with `@[Name](id)` in content
   - Add user ID to mentions set (for notification)
   - If no match, leave as plain text
4. Return `{ content: transformedContent, mentionedUserIds: [...] }`

**`renderContent(content)`** — called in EJS views before rendering.
1. HTML-escape the full content string
2. Replace `@\[([^\]]+)\]\((\d+)\)` tokens with `<a href="/members/$2" class="mention">@$1</a>`
3. Return safe HTML string

### Autocomplete (client-side, `public/js/app.js`)

A `window.FAMILY_MEMBERS` array is injected into every authenticated page (in `partials/head.ejs` or a shared layout partial) containing `{id, name, firstName}` for all active users. The `firstName` field is precomputed: first word of `name`, falling back to `name` if only one word.

Uniqueness at insertion: before inserting, check if any other member shares the same `firstName`. If yes, insert full `name`; if no, insert `firstName`.

**Autocomplete flow:**
1. Listen for `input` events on all textareas with class `mention-input` (post body, comment box)
2. On `@` detected, show floating dropdown `<div id="mention-dropdown">` positioned below the caret
3. Filter `FAMILY_MEMBERS` by the substring following `@` (case-insensitive, matches name or firstName)
4. Clicking/Enter on a result:
   - Determines insert name (first vs full based on uniqueness)
   - Replaces `@<partial>` in textarea with `@Name ` (trailing space)
   - Closes dropdown
5. Arrow keys navigate the list; Escape closes it
6. Clicking outside closes it

**Dropdown styling:** matches the site's serif aesthetic. Purple highlight on selected item (`#ede9fe` background, `#5b21b6` text). Max 6 items shown, scrollable if more.

### Mention Resolution in Routes

**`src/routes/posts.js`** — on POST /posts (create) and POST /posts/:id/edit:
```js
const { resolveMentions } = require('../utils/mentions');
const { content: resolvedContent, mentionedUserIds } = await resolveMentions(content, pool);
// use resolvedContent for INSERT/UPDATE
// fire notifications for mentionedUserIds (skip if author === mentioned)
```

**`src/routes/comments.js`** — same pattern on POST /posts/:id/comments.

### Notifications

For each mentioned user ID (excluding post/comment author):
- `sendPushToUser(userId, { title: "${authorName} mentioned you", body: excerpt(resolvedContent, 80), url: "/posts/${postId}" })`
- `sendMentionNotification(mentionedEmail, mentionedName, authorName, excerpt, postUrl)` (new function in `email.js`)

Excerpt: strip any `@[Name](id)` tokens back to `@Name` for display, then take first 80 chars.

### Rendering in Views

`renderContent` is a server-side utility (not EJS helper). Call it before passing content to templates:

```js
const { renderContent } = require('../utils/mentions');
res.render('post', { ..., content: renderContent(post.content) });
```

In EJS, use `<%-` (unescaped) for pre-rendered content: `<%- content %>`.

Views to update:
- `src/views/post.ejs` — post body, each comment body
- `src/views/partials/post-card.ejs` — post body in feed cards

### CSS

Add to shared stylesheet (or `partials/head.ejs`):

```css
.mention {
  color: #7c3aed;
  font-weight: 600;
  text-decoration: none;
}
.mention:hover { text-decoration: underline; }
.dark .mention { color: #a78bfa; }

#mention-dropdown {
  position: absolute;
  z-index: 100;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.08);
  min-width: 180px;
  max-height: 220px;
  overflow-y: auto;
}
.dark #mention-dropdown { background: #1e293b; border-color: #334155; }

.mention-option {
  padding: 8px 12px;
  cursor: pointer;
  font-size: 0.875rem;
  color: #374151;
}
.mention-option:hover,
.mention-option.active { background: #ede9fe; color: #5b21b6; }
.dark .mention-option { color: #cbd5e1; }
.dark .mention-option:hover,
.dark .mention-option.active { background: #3b1f6e; color: #c4b5fd; }
```

---

## Files

| File | Change |
|---|---|
| `src/utils/mentions.js` | **Create** — `resolveMentions` + `renderContent` |
| `src/routes/posts.js` | Modify — call `resolveMentions` on create + edit; fire notifications |
| `src/routes/comments.js` | Modify — call `resolveMentions` on create; fire notifications |
| `src/email.js` | Modify — add `sendMentionNotification` |
| `src/views/partials/head.ejs` | Modify — inject `FAMILY_MEMBERS` JSON for authenticated users |
| `public/js/app.js` | Modify — autocomplete handler |
| `src/views/post.ejs` | Modify — use `renderContent()` for post body + comment bodies |
| `src/views/partials/post-card.ejs` | Modify — use `renderContent()` for post body |

---

## Edge Cases

- **Self-mention**: resolve and store the token, but skip the notification (author === mentioned)
- **Duplicate mentions**: mention the same person twice in one post — notify once, store both tokens
- **Name changes**: stored `@[Alice](42)` uses ID, so if "Alice" becomes "Alicia" the link still works; display name updates on re-render from `users.name` — actually, stored name in token is static. Document: name changes do not retroactively update mention display text (acceptable tradeoff).
- **Deleted/deactivated users**: `renderContent` renders the link regardless; `/members/:id` can handle the 404 gracefully
- **Editing a post**: `resolveMentions` runs again — re-notify all mentioned users (simple v1 approach; acceptable since edits are infrequent).
- **XSS**: `renderContent` HTML-escapes the full string before injecting link HTML; user-controlled names from DB are escaped via `escapeHtml` when building the `<a>` tag

---

## Out of Scope

- Mention notifications aggregated into a "notifications" feed/page
- @-mentioning non-account people (events table entries)
- Smarter edit re-notification (only notify newly added mentions — v1 re-notifies all, revisit if it becomes annoying)
