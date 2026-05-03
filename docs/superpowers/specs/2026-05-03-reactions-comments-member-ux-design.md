# Design: Reactions Visibility, Comments Prominence, Member Profile

**Date:** 2026-05-03  
**Status:** Approved  
**Scope:** Mobile UX improvements to reactions and comments on the feed; new per-member post history page.

---

## 1. Reaction Names — Visibility on Mobile

### Problem
Reactor names are only exposed via a desktop hover tooltip (`mouseenter`). On mobile, there is no way to see who reacted to a post.

### Design

**Server-side name inclusion**  
Extend the feed query (`GET /`) to fetch all reaction names per post in a single additional query — a `GROUP_CONCAT` or a separate join returning `(post_id, emoji, user name)` rows. Aggregate into a `reactionNames` object shaped `{ [postId]: { [emoji]: string[] } }` and pass to the view alongside the existing `reactionsByPost`. No client-side fetch requests on page load.

The post detail page (`GET /post/:id`) already has a `reaction-names` endpoint; extend it the same way by including names in the initial server render.

**Summary line**  
Below the emoji button row, render a single line of text summarising all reactions with names:
- Format: `❤️ Sarah, Mom · 👍 Dad and 1 other`
- Show first 2 names per emoji, then "+ N others" if more
- Hidden if the post has zero reactions
- Rendered server-side from `reactionNames` — no JS needed for initial render

**Long-press bottom sheet (mobile)**  
In `app.js`, attach a `touchstart` listener to each `.reaction-btn`. After 500ms without a `touchmove` (>10px) or `touchend`, show a bottom sheet:
- Fixed to bottom of screen, slides up with a CSS transition
- Lists all reactors grouped by emoji (e.g. "❤️ — Sarah, Mom, Grandpa")
- Tap anywhere outside (or a close button) dismisses it
- Populated from the server-rendered `reactionNames` data attribute on each post article (no extra fetch required)

**Desktop unchanged**  
Existing `mouseenter`/`mouseleave` tooltip on `.reaction-btn` remains as-is.

### Files changed
- `src/routes/posts.js` — extend feed and post-detail queries to include reaction names
- `src/views/partials/post-card.ejs` — add summary line; embed `reactionNames` as `data-reaction-names` on the article element
- `src/views/post.ejs` — same summary line; embed names on article element
- `src/public/js/app.js` — long-press logic + bottom sheet show/hide

---

## 2. Comments — Prominence on the Feed Card

### Problem
The "X comments →" link is small, gray, and easy to miss. Existing conversations are invisible on the feed, so users don't know there's something to engage with.

### Design

**Comment count pill**  
Replace the current inline text link with a styled outlined pill button:  
`💬 3 comments` — uses the brand color, clearly tappable, still navigates to `/post/:id`.  
Zero-comment state: `💬 Add a comment` to make it an explicit invitation.

**Latest comment preview**  
If a post has ≥ 1 comment, show the most recent comment inline on the card:
- Avatar/initial + commenter name (linked to their member page) + comment text
- Text truncated to 2 lines (`line-clamp-2`)
- Rendered server-side — feed query extended to fetch `(post_id, latest comment content, author name, author avatar)` via a subquery or `LEFT JOIN ... ORDER BY created_at DESC LIMIT 1 per post`

**Inline comment form**  
Below the latest comment preview (or below reactions if no comments), render a compact form:
- Single-line text input (`placeholder="Add a comment..."`) + Send button
- `POST /posts/:id/comments` — existing endpoint, no backend changes
- On submit, redirects back to feed (`/`); the feed now shows the newly added comment inline
- No JS required for submit — standard form POST

### Files changed
- `src/routes/posts.js` — extend feed query to fetch latest comment per post
- `src/views/partials/post-card.ejs` — comment pill, latest comment preview, inline form

---

## 3. Member Profile Page

### Problem
There is no way to browse a single member's posts. Users want to see one person's contributions in isolation.

### Design

**Route:** `GET /member/:id`  
Handler in `src/routes/posts.js` (or a new `src/routes/members.js`):
- Validates `:id` is a known user; 404 if not
- Queries all posts by that user (same columns as feed, including photos, reactions, latest comment)
- Passes `profileUser` (id, name, avatar_url, created_at) and `posts` array to the view
- Requires auth (`requireAuth` middleware)

**View:** `src/views/member.ejs`  
- Header: avatar (or initial), display name, "Member since [month year]"
- Posts rendered using `<%- include('partials/post-card.ejs') %>` — identical to feed, reactions and inline comments work the same way
- Empty state: "No posts yet."
- Back link: `← Feed` linking to `/`

**Navigation to member pages**  
Every author name and avatar that appears on the site becomes a link to `/member/:id`:
- Post card header (feed + post detail)
- Comment author name (post detail page)

No separate members directory — member pages are discovered organically by tapping names.

### Files changed
- `src/routes/posts.js` (or new `src/routes/members.js`) — new `GET /member/:id` handler
- `src/app.js` — register new route
- `src/views/member.ejs` — new view
- `src/views/partials/post-card.ejs` — author name/avatar become links
- `src/views/post.ejs` — author name/avatar + comment author names become links

---

## Out of Scope
- Member directory / listing page
- Comment counts or reaction stats on the member profile
- Ability to send direct messages or follow members
- Any changes to the post detail comment thread
