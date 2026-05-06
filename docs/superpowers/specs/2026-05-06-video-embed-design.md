# Video Link Embed Design

## Overview

When a post contains a YouTube or Vimeo URL, render an inline 16:9 iframe player instead of (or in addition to) the existing link card. No video is stored on the Pi — links only.

---

## Decisions

| Question | Decision |
|---|---|
| Platforms | YouTube and Vimeo only |
| Feed cards | Full 16:9 embed (same as post detail) |
| Photos + video | Show both — photos first, embed below |
| Link card when video detected | Suppressed (video replaces it) |
| Detection timing | Render time (scan `post.content` directly) |
| DB changes | None |

---

## Architecture

### `src/utils/videoEmbed.js` (new file)

Single exported function:

**`extractVideoEmbed(content)`**
- Scans the raw post content string for the first YouTube or Vimeo URL
- Returns the iframe `src` URL string, or `null` if no video link is found
- Pure function — no DB, no network, no side effects

**Supported URL patterns → embed URL:**

| Input pattern | Embed URL |
|---|---|
| `youtube.com/watch?v=VIDEO_ID` | `https://www.youtube.com/embed/VIDEO_ID` |
| `youtu.be/VIDEO_ID` | `https://www.youtube.com/embed/VIDEO_ID` |
| `youtube.com/shorts/VIDEO_ID` | `https://www.youtube.com/embed/VIDEO_ID` |
| `m.youtube.com/watch?v=VIDEO_ID` | `https://www.youtube.com/embed/VIDEO_ID` |
| `vimeo.com/VIDEO_ID` | `https://player.vimeo.com/video/VIDEO_ID` |

YouTube video IDs are exactly 11 characters (`[A-Za-z0-9_-]{11}`). Vimeo IDs are numeric (`\d+`).

**Implementation sketch:**
```js
function extractVideoEmbed(content) {
  if (!content) return null;
  const yt = content.match(
    /(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:[^&\s]*&)*v=|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
  );
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  const vi = content.match(/(?:https?:\/\/)?(?:www\.)?vimeo\.com\/(\d+)/);
  if (vi) return `https://player.vimeo.com/video/${vi[1]}`;
  return null;
}
module.exports = { extractVideoEmbed };
```

### Registration in `src/app.js`

```js
const { extractVideoEmbed } = require('./utils/videoEmbed');
app.locals.extractVideoEmbed = extractVideoEmbed;
```

Added alongside the existing `app.locals.renderContent` registration.

### Template Logic

Both `src/views/post.ejs` and `src/views/partials/post-card.ejs` follow the same pattern:

```
[text content — unchanged]
[photos section — unchanged, renders if post.photos.length > 0]
[video embed — renders if extractVideoEmbed(post.content) returns a URL]
[link card — renders only if: no video embed detected AND no photos AND preview_url exists]
```

EJS snippet:
```ejs
<% const embedUrl = extractVideoEmbed(post.content); %>

<% if (embedUrl) { %>
  <div class="video-wrapper mt-3">
    <iframe src="<%= embedUrl %>" allowfullscreen loading="lazy"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture">
    </iframe>
  </div>
<% } else if (post.preview_url && (!post.photos || !post.photos.length)) { %>
  <%-- existing link card markup — unchanged --%>
<% } %>
```

The `const embedUrl` declaration goes at the top of the post body section, before the photos block.

### CSS (`src/public/css/theme.css`)

Appended to end of file:

```css
/* ── Video embed ─────────────────────────────────────────────────────────────── */
.video-wrapper {
  position: relative;
  padding-bottom: 56.25%; /* 16:9 */
  height: 0;
  overflow: hidden;
  border-radius: 12px;
}
.video-wrapper iframe {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border: 0;
}
```

---

## Files

| File | Change |
|---|---|
| `src/utils/videoEmbed.js` | **Create** — `extractVideoEmbed` function |
| `src/utils/videoEmbed.test.js` | **Create** — unit tests using `node:test` |
| `src/app.js` | Modify — register `app.locals.extractVideoEmbed` |
| `src/public/css/theme.css` | Modify — append `.video-wrapper` styles |
| `src/views/post.ejs` | Modify — add embed block, update link card condition |
| `src/views/partials/post-card.ejs` | Modify — same |

---

## Tests (`src/utils/videoEmbed.test.js`)

Using `node:test`. Cases to cover:

- `null` / empty string → returns `null`
- `youtube.com/watch?v=dQw4w9WgXcQ` → correct embed URL
- `youtu.be/dQw4w9WgXcQ` → correct embed URL
- `youtube.com/shorts/dQw4w9WgXcQ` → correct embed URL
- `m.youtube.com/watch?v=dQw4w9WgXcQ` → correct embed URL
- `vimeo.com/123456789` → correct embed URL
- Plain text with no URL → `null`
- URL that is not YouTube/Vimeo (e.g. `example.com`) → `null`
- Content with YouTube URL embedded mid-sentence → detects correctly
- Content with both YouTube and Vimeo → returns YouTube (first match wins)

---

## Edge Cases

- **Playlists** (`youtube.com/watch?v=ID&list=...`): the regex extracts the `v=` param ID and embeds just that video. Playlist context is lost — acceptable.
- **Private/deleted videos**: the iframe will show YouTube/Vimeo's own error state. No special handling needed.
- **Edited posts**: detection runs at render time from `post.content`, so editing a post to add or remove a video URL takes effect immediately on next page load.
- **OG fetch and video URL coexist**: the OG fetch still runs at save time (unchanged). If the URL is a YouTube link, `link_previews` may be populated with YouTube OG data — but the link card is suppressed whenever an embed is detected, so both won't show simultaneously.
- **No autoplay**: iframes use default YouTube/Vimeo behavior — no `autoplay` param in the embed URL.

---

## Out of Scope

- YouTube Shorts display differences (treated identically to regular videos)
- Vimeo private/password-protected videos
- TikTok, Twitter/X video, or other platforms
- Video title/description display below the embed (OG data already shown via link card — suppressed when embed shows)
- Lazy-loading iframes beyond `loading="lazy"` attribute
