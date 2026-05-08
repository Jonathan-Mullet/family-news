# Codebase Cleanup: family-news + notes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add thorough comments, eliminate code duplication, and fix targeted security issues across family-news and notes — with zero behavior changes to any user-facing feature.

**Architecture:** Work in small, safe increments: documentation-only passes first (zero risk of breakage), then a single DRY refactor, then security hardening. Every change is verified before the next one begins. No new dependencies introduced.

**Tech Stack:** Node.js, Express, EJS, MySQL2, Multer/Sharp, web-push, nodemailer, node-cron

---

## Key findings from codebase audit

### family-news issues
| # | Location | Issue | Risk |
|---|----------|-------|------|
| 1 | `src/push.js` | `checkColumn` interpolated directly into SQL (no whitelist) | SQL injection if callers ever pass user data |
| 2 | `src/email.js` | User names/titles inserted into HTML without escaping | HTML in a family member's name renders in email clients |
| 3 | `src/routes/comments.js` | No character limit on comment content | Unlimited-size inserts, inconsistent with posts (2 000 char limit) |
| 4 | `src/app.js` | No startup validation for critical env vars | Silent failures if SESSION_SECRET etc. are missing |
| 5 | `src/routes/posts.js` + `src/routes/members.js` | ~50 identical lines for loading reactions, photos, and latest comments | DRY violation — divergence risk as features evolve |

### notes issues
| # | Location | Issue | Risk |
|---|----------|-------|------|
| 6 | `src/app.js` | Session secret defaults to hardcoded `'notes-secret'` | Predictable secret if env var is accidentally missing |
| 7 | `src/app.js` | No note content length limit | Unlimited-size inserts |

---

## Deploy procedure (used in verification steps)

```bash
# After every server-side commit:
git push origin main
# Wait ~3 min for GitHub Actions arm64 build, then on Pi:
cd /home/jmull/docker
sudo docker compose pull <service>   # family-news or notes
sudo docker compose up -d <service>
```

---

## Task 1 — Annotate family-news core modules

**Files to modify:**
- `src/middleware/auth.js`
- `src/db.js`
- `src/email.js`
- `src/push.js`
- `src/cron.js`
- `src/utils/ogFetch.js`

**Annotation standard** — apply consistently to all files:
1. JSDoc `/** ... */` before every exported function (params, return, purpose)
2. Inline `// why` comments for non-obvious logic (silent catch blocks, migrations, etc.)
3. Section separator comments for grouped blocks: `// ── Section name ───────`

**Reference: `src/middleware/auth.js` — before and after**

Before:
```javascript
function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin')
    return res.status(403).render('error', { message: 'Access denied.' });
  next();
}

module.exports = { requireAuth, requireAdmin };
```

After:
```javascript
/**
 * Express middleware: requires an active session with a logged-in user.
 * Redirects to /login for unauthenticated requests.
 * Attach to any route that must not be accessible to guests.
 */
function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

/**
 * Express middleware: requires role='admin' on the session user.
 * Returns HTTP 403 and renders the error view for non-admins.
 * Can stand alone (also checks for a user), but typically follows requireAuth.
 */
function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin')
    return res.status(403).render('error', { message: 'Access denied.' });
  next();
}

module.exports = { requireAuth, requireAdmin };
```

**Steps:**

- [ ] **Step 1: Annotate `src/middleware/auth.js`** (example shown above — 2 JSDoc blocks)

- [ ] **Step 2: Annotate `src/db.js`**

  Key annotations to add:
  - Module-level comment: "MySQL connection pool + schema init/migration. Safe to call initDb() on every startup — all statements use IF NOT EXISTS or try/catch."
  - Before `initDb()`: JSDoc listing purpose, side effects (creates tables, runs migrations)
  - Inline comment on the migrations array: explain *why* each migration is wrapped in try/catch (column may already exist in production DB)
  - Inline on the `INSERT IGNORE INTO post_photos` migration: explain this backfills pre-multi-photo posts

  Example (migrations section comment):
  ```javascript
  // Migrations are safe to re-run: each ALTER TABLE fails silently if the column
  // already exists. This lets us evolve the schema without separate migration files.
  const migrations = [ ... ];
  for (const q of migrations) {
    try { await pool.query(q); } catch { /* column/index already exists — intentional */ }
  }
  ```

- [ ] **Step 3: Annotate `src/email.js`**

  Key annotations:
  - Module-level: "Nodemailer wrapper for Family News. All send functions are fire-and-forget — errors are logged but never thrown to callers."
  - Before `getTransporter()`: note lazy init pattern
  - Before `sendMail()`: JSDoc (to, subject, html params)
  - Before each `send*` function: single-line purpose comment

- [ ] **Step 4: Annotate `src/push.js`**

  Key annotations:
  - Module-level: "Web Push (VAPID) notification helpers. All functions are no-ops when VAPID_PUBLIC_KEY is not set."
  - Before `_sendToSubscription()`: note that 410/404 responses mean the subscription has expired and is auto-deleted
  - Before `sendPushToUser()`: JSDoc with checkColumn explanation
  - Before `sendPushToAllUsers()`: JSDoc, note that checkColumn must be one of the push_notify_* column names

- [ ] **Step 5: Annotate `src/cron.js`**

  Key annotations:
  - Module-level: "Scheduled tasks (node-cron). Runs at 8am server time (America/Chicago) every day."
  - Inline note explaining why admin user is used as the post author for automated birthday posts
  - Inline note distinguishing user birthday column from manual `events` table

- [ ] **Step 6: Annotate `src/utils/ogFetch.js`**

  Key annotations:
  - Module-level: "Fetches Open Graph metadata from URLs found in post content."
  - Before `fetchOgPreview()`: JSDoc explaining the 100KB read limit and 5s timeout
  - Inline on the streaming read: explain why we stream and abort (avoid downloading full large pages)

- [ ] **Step 7: Verify no code was changed**
  ```bash
  cd /home/jmull/projects/family-news
  git diff --stat
  # Should show only .js files, no package.json, no views
  # Then spot-check one file to confirm only comments changed:
  git diff src/middleware/auth.js
  ```

- [ ] **Step 8: Commit**
  ```bash
  cd /home/jmull/projects/family-news
  git add src/middleware/auth.js src/db.js src/email.js src/push.js src/cron.js src/utils/ogFetch.js
  git commit -m "docs: add JSDoc and inline comments to core modules"
  ```

---

## Task 2 — Annotate family-news route files

**Files to modify:**
- `src/routes/auth.js`
- `src/routes/posts.js`
- `src/routes/admin.js`
- `src/routes/comments.js`
- `src/routes/reactions.js`
- `src/routes/profile.js`
- `src/routes/members.js`
- `src/routes/push.js`
- `src/routes/upload.js`

Each route file should follow this pattern:
- One-line module-level comment: what routes this file owns
- Before each `router.get/post/delete`: a comment stating the route's purpose (one sentence)
- Inline why-comments for non-obvious logic (e.g., the `ON DUPLICATE KEY UPDATE` in push subscribe, the rolling cookie on remember-me login)

**Key annotations per file:**

`routes/auth.js`:
- Module: "Authentication routes: login, logout, registration (invite-required), birthday setup, password reset."
- Before login POST: note that it checks `active = 1` to block disabled accounts
- Before register POST: explain multi-use invite logic (use_count < max_uses)

`routes/posts.js`:
- Module: "Post CRUD, feed/detail views, feed-state polling, pin/big-news/delete actions."
- Before GET `/`: note the three-way sort (big news active, big news archived, regular with pin priority)
- Before POST `/posts`: note that link preview fetch is fire-and-forget (async IIFE, never blocks response)
- On `BIG_NEWS_DAYS`: explain the 14-day threshold for active vs archived big news display

`routes/admin.js`:
- Module: "Admin-only routes (protected by requireAdmin middleware on router): user management, invite links, birthday/anniversary events."
- Before invites POST: note open (50 uses, 2-day) vs single-use (7-day) invite types

`routes/comments.js`:
- Module: "Comment creation and deletion. Fires email + push notifications to the post author on new comments."
- Before referer check: explain why — stay on the page the user submitted from (feed or member page)

`routes/reactions.js`:
- Module: "Emoji reaction toggle (add/remove) and reaction names lookup for tooltips."
- On ALLOWED array: note this is the server-side whitelist — the frontend picker mirrors it

`routes/profile.js`:
- Module: "Profile settings: display name, email, password, birthday, avatar upload/remove, notification prefs."
- On avatar upload: note that the old avatar file is deleted from disk before saving the new path

`routes/members.js`:
- Module: "Member profile page: shows all posts by a specific user with reactions and latest comments."

`routes/push.js`:
- Module: "Push notification subscription management: subscribe/unsubscribe endpoints, VAPID public key endpoint."
- On subscribe: note the auto-opt-out of email notifications when push is enabled (intentional UX choice)

`routes/upload.js`:
- Module: "Multer + Sharp image processing middleware. Handles single-photo (post), multi-photo (post gallery), and avatar uploads."
- On UPLOADS_DIR: note this is a Docker volume mount (`/app/uploads` maps to host)
- On processAndSave: explain sharp's `.rotate()` call (auto-rotate from EXIF data, fixes sideways phone photos)

- [ ] **Step 1: Add comments to all route files (one by one)**
  Follow the per-file guidance above.

- [ ] **Step 2: Verify no code was changed**
  ```bash
  cd /home/jmull/projects/family-news
  git diff --stat
  # Only .js files under src/routes/
  ```

- [ ] **Step 3: Commit**
  ```bash
  git add src/routes/
  git commit -m "docs: add route-level comments to all route handlers"
  ```

---

## Task 3 — Annotate app.js and frontend JS

**Files to modify:**
- `src/app.js`
- `src/public/js/app.js`

**`src/app.js` — add section separators and key why-comments:**

```javascript
// ── Express setup ────────────────────────────────────────────────────────────
// trust proxy: 1 — required for secure cookies behind Nginx reverse proxy
app.set('trust proxy', 1);
// ...

// ── Static files ─────────────────────────────────────────────────────────────
// no-cache on .js/.css so iOS PWA always gets fresh assets after a deploy
app.use(express.static(path.join(__dirname, 'public'), { ... }));
// Uploaded photos are stored at /app/uploads (Docker volume) and served here
app.use('/uploads', express.static('/app/uploads'));

// ── Session ───────────────────────────────────────────────────────────────────
// Sessions are stored in MySQL so they survive container restarts.
// rolling: true resets the cookie expiry on every request (keeps active users logged in).
// ...

// ── Request locals ────────────────────────────────────────────────────────────
// Make user + flash messages available in every EJS template without explicit passing.
// ...

// ── Birthday redirect ─────────────────────────────────────────────────────────
// New users who registered before the birthday field was added may not have one set.
// This middleware catches them on their first request and sends them to /birthday-setup.
// The birthday + avatar_url sync block handles sessions created before these columns existed.
// ...

// ── Routes ────────────────────────────────────────────────────────────────────
// ...

// ── Server startup ────────────────────────────────────────────────────────────
// Retries DB connection up to 10 times (3s apart) — gives MySQL time to boot in Docker.
// Creates the initial admin account if the users table is empty and ADMIN_* vars are set.
// ...
```

**`src/public/js/app.js` — add section banners and clarify non-obvious code:**

The file has several independent features. Add section banners:
```javascript
// ── Timestamp localization ────────────────────────────────────────────────────
// Server renders timestamps in its timezone; we rewrite them to the viewer's local TZ.
// ...

// ── Dark mode ────────────────────────────────────────────────────────────────
// ...

// ── Reaction names bottom sheet ───────────────────────────────────────────────
// Mobile: tapping the reaction summary line opens a sheet listing who reacted with what.
// ...

// ── Tooltip (desktop) ────────────────────────────────────────────────────────
// ...

// ── Reaction chips + state ────────────────────────────────────────────────────
// reactionState is seeded from data-reactions attributes set by the server.
// Client updates it optimistically after each toggle so the UI is instant.
// ...

// ── Emoji picker bottom sheet ─────────────────────────────────────────────────
// Built with inline styles instead of Tailwind classes: Tailwind CDN only scans
// real DOM nodes at load time, so it won't generate classes for JS-created elements.
// ...

// ── Feed auto-refresh ─────────────────────────────────────────────────────────
// Polls /api/feed-state every 25s and shows a toast when new posts appear.
// ...

// ── Pull-to-refresh (standalone PWA only) ─────────────────────────────────────
// Skipped in browser to avoid conflicting with Safari's native overscroll gesture.
// ...

// ── Service worker ────────────────────────────────────────────────────────────
// Required for push notifications on all platforms.
// ...

// ── VAPID key helper ──────────────────────────────────────────────────────────
// ...

// ── iOS Add to Home Screen banner ─────────────────────────────────────────────
// ...

// ── Push notification UI (profile page only) ──────────────────────────────────
// ...
```

- [ ] **Step 1: Add section comments and why-comments to `src/app.js`**

- [ ] **Step 2: Add section banners and key inline comments to `src/public/js/app.js`**

- [ ] **Step 3: Verify no code was changed**
  ```bash
  git diff src/app.js src/public/js/app.js
  # No changed lines, only added comment lines
  ```

- [ ] **Step 4: Commit**
  ```bash
  git add src/app.js src/public/js/app.js
  git commit -m "docs: add section comments and why-comments to app.js and frontend JS"
  ```

---

## Task 4 — Extract shared feed data loader (DRY fix)

**Problem:** `src/routes/posts.js` (lines 51–102) and `src/routes/members.js` (lines 33–75) contain ~50 nearly-identical lines that load reactions, photos, reaction names, and the latest comment for an array of posts. Any future change to this logic requires two edits.

**Solution:** Extract to `src/utils/feedData.js` and import in both routes.

**Files:**
- Create: `src/utils/feedData.js`
- Modify: `src/routes/posts.js`
- Modify: `src/routes/members.js`

- [ ] **Step 1: Create `src/utils/feedData.js`**

```javascript
/**
 * Shared feed data loader.
 *
 * Enriches an array of post objects (already loaded from DB) with the
 * additional data needed to render feed cards: reactions, photos, reaction
 * name lists, and the most recent comment for each post.
 *
 * Posts are mutated in-place: a .photos array is added to each post.
 * The three lookup maps are returned for use in template rendering.
 */

const { pool } = require('../db');

/**
 * Loads reactions, photos, reaction names, and latest comments for a set of posts.
 *
 * @param {Array<{id: number}>} posts     - Post objects (must have .id)
 * @param {number}              viewerUserId - Session user's ID (used for userReacted flags)
 * @returns {Promise<{
 *   reactionsByPost:     Object<postId, Object<emoji, {count, userReacted}>>,
 *   reactionNames:       Object<postId, Object<emoji, string[]>>,
 *   latestCommentByPost: Object<postId, {content, author_name, author_avatar, author_id}>
 * }>}
 */
async function enrichPosts(posts, viewerUserId) {
  // Initialize photos array on each post (required by templates even when empty)
  posts.forEach(p => { p.photos = []; });

  const reactionsByPost = {};
  const reactionNames = {};
  const latestCommentByPost = {};

  // Nothing to load if there are no posts
  if (!posts.length) return { reactionsByPost, reactionNames, latestCommentByPost };

  const ids = posts.map(p => p.id);

  // ── Reactions ──────────────────────────────────────────────────────────────
  // Load per-emoji counts and whether the viewing user has reacted
  const [reactions] = await pool.query(`
    SELECT post_id, emoji, COUNT(*) AS count,
      MAX(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS user_reacted
    FROM reactions WHERE post_id IN (?)
    GROUP BY post_id, emoji
  `, [viewerUserId, ids]);
  reactions.forEach(r => {
    if (!reactionsByPost[r.post_id]) reactionsByPost[r.post_id] = {};
    reactionsByPost[r.post_id][r.emoji] = { count: r.count, userReacted: r.user_reacted === 1 };
  });

  // ── Photos ─────────────────────────────────────────────────────────────────
  // Load in sort_order so multi-photo posts display in the correct sequence
  const [photoRows] = await pool.query(
    'SELECT post_id, photo_url FROM post_photos WHERE post_id IN (?) ORDER BY sort_order',
    [ids]
  );
  photoRows.forEach(ph => {
    const post = posts.find(p => p.id === ph.post_id);
    if (post) post.photos.push(ph.photo_url);
  });

  // ── Reaction names ─────────────────────────────────────────────────────────
  // Used by the desktop tooltip and mobile bottom sheet to list who reacted
  const [nameRows] = await pool.query(`
    SELECT r.post_id, r.emoji, u.name
    FROM reactions r JOIN users u ON r.user_id = u.id
    WHERE r.post_id IN (?)
    ORDER BY r.post_id, r.emoji, u.name
  `, [ids]);
  nameRows.forEach(r => {
    if (!reactionNames[r.post_id]) reactionNames[r.post_id] = {};
    if (!reactionNames[r.post_id][r.emoji]) reactionNames[r.post_id][r.emoji] = [];
    reactionNames[r.post_id][r.emoji].push(r.name);
  });

  // ── Latest comment ─────────────────────────────────────────────────────────
  // Inline preview on feed cards shows only the most recent comment per post
  const [latestCommentRows] = await pool.query(`
    SELECT c.post_id, c.content, u.name AS author_name, u.avatar_url AS author_avatar, u.id AS author_id
    FROM comments c JOIN users u ON c.user_id = u.id
    WHERE c.id IN (SELECT MAX(id) FROM comments WHERE post_id IN (?) GROUP BY post_id)
  `, [ids]);
  latestCommentRows.forEach(c => { latestCommentByPost[c.post_id] = c; });

  return { reactionsByPost, reactionNames, latestCommentByPost };
}

module.exports = { enrichPosts };
```

- [ ] **Step 2: Update `src/routes/posts.js` to use `enrichPosts`**

  Add import at top (after existing requires):
  ```javascript
  const { enrichPosts } = require('../utils/feedData');
  ```

  In the `GET /` handler, replace this block (approximately lines 50–102):
  ```javascript
  allPosts.forEach(p => { p.photos = []; });
  let reactionsByPost = {};
  let reactionNames = {};
  let latestCommentByPost = {};
  if (allPosts.length) {
    const ids = allPosts.map(p => p.id);
    const [reactions] = await pool.query(`...`, [userId, ids]);
    reactions.forEach(r => { ... });

    const [readRows] = await pool.query(...);
    const readMap = {};
    readRows.forEach(r => { readMap[r.post_id] = r.read_count; });
    allPosts.forEach(p => { p.read_count = readMap[p.id] || 0; });

    const [photoRows] = await pool.query(...);
    photoRows.forEach(ph => { ... });

    const [nameRows] = await pool.query(`...`, [ids]);
    nameRows.forEach(r => { ... });

    const [latestCommentRows] = await pool.query(`...`, [ids]);
    latestCommentRows.forEach(c => { latestCommentByPost[c.post_id] = c; });
  }
  ```

  With this replacement:
  ```javascript
  const { reactionsByPost, reactionNames, latestCommentByPost } = await enrichPosts(allPosts, userId);

  // Feed also shows how many members have read each post (not needed on member pages)
  if (allPosts.length) {
    const ids = allPosts.map(p => p.id);
    const [readRows] = await pool.query(
      'SELECT post_id, COUNT(*) AS read_count FROM post_reads WHERE post_id IN (?) GROUP BY post_id',
      [ids]
    );
    const readMap = {};
    readRows.forEach(r => { readMap[r.post_id] = r.read_count; });
    allPosts.forEach(p => { p.read_count = readMap[p.id] || 0; });
  }
  ```

- [ ] **Step 3: Update `src/routes/members.js` to use `enrichPosts`**

  Add import at top:
  ```javascript
  const { enrichPosts } = require('../utils/feedData');
  ```

  Replace this block (approximately lines 28–75):
  ```javascript
  posts.forEach(p => { p.photos = []; });
  let reactionsByPost = {};
  let reactionNames = {};
  let latestCommentByPost = {};

  if (posts.length) {
    const ids = posts.map(p => p.id);
    const userId = req.session.user.id;
    // ... ~45 lines of identical queries ...
  }
  ```

  With:
  ```javascript
  const { reactionsByPost, reactionNames, latestCommentByPost } = await enrichPosts(posts, req.session.user.id);
  ```

- [ ] **Step 4: Deploy and manually verify**
  ```bash
  git push origin main
  # Wait ~3 min for GitHub Actions build
  cd /home/jmull/docker
  sudo docker compose pull family-news && sudo docker compose up -d family-news
  ```

  Verify:
  - Load the main feed at https://news.jonathan-mullet.com — posts, reactions, photos, comments all visible
  - Click a member's name → their profile page loads with reactions and latest comments
  - React to a post → chip appears with correct count
  - Check a post that has photos → photos still show

- [ ] **Step 5: Commit**
  ```bash
  git add src/utils/feedData.js src/routes/posts.js src/routes/members.js
  git commit -m "refactor: extract enrichPosts helper to eliminate duplicated feed data loading"
  ```

---

## Task 5 — Security hardening: family-news

Four targeted fixes. Each is minimal and non-breaking.

**Files:**
- Modify: `src/push.js`
- Modify: `src/email.js`
- Modify: `src/routes/comments.js`
- Modify: `src/app.js`

- [ ] **Step 1: Whitelist `checkColumn` in `src/push.js`**

  The `checkColumn` string is interpolated directly into SQL. It's always hardcoded at call sites today, but whitelisting defends against any future mistake.

  Add near the top of the file, after the requires:
  ```javascript
  // Whitelist of valid column names that can be used as push notification preference checks.
  // These are the only columns ever passed as checkColumn — this prevents SQL injection
  // if a call site ever passes user-controlled data by mistake.
  const PUSH_PREF_COLUMNS = new Set(['push_notify_posts', 'push_notify_comments', 'push_notify_big_news']);
  ```

  In `sendPushToUser`, add at the start of the `if (checkColumn)` block:
  ```javascript
  if (checkColumn) {
    if (!PUSH_PREF_COLUMNS.has(checkColumn)) {
      console.error('sendPushToUser: unexpected checkColumn value:', checkColumn);
      return;
    }
    const [[user]] = await pool.query(`SELECT \`${checkColumn}\` AS pref FROM users WHERE id = ?`, [userId]);
    if (!user || !user.pref) return;
  }
  ```

  In `sendPushToAllUsers`, add at the top:
  ```javascript
  async function sendPushToAllUsers(payload, { excludeUserId = 0, checkColumn }) {
    if (!process.env.VAPID_PUBLIC_KEY) return;
    if (!checkColumn) return;
    if (!PUSH_PREF_COLUMNS.has(checkColumn)) {
      console.error('sendPushToAllUsers: unexpected checkColumn value:', checkColumn);
      return;
    }
    // ... rest unchanged ...
  }
  ```

- [ ] **Step 2: HTML-escape user content in email templates in `src/email.js`**

  A family member's display name or post content containing `<script>` or `<b>` tags would render as HTML in email clients. This fix escapes all user-supplied strings before inserting them into HTML.

  Add this helper near the top of `src/email.js`, before `getTransporter`:
  ```javascript
  /**
   * Escapes special HTML characters in a string.
   * Used to sanitize user-generated content before inserting it into email HTML bodies.
   *
   * @param {string} str
   * @returns {string}
   */
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  ```

  Then update every template literal in the four send functions to wrap user values:

  In `sendNewPostNotification`:
  ```javascript
  // Before: ${poster.name}, ${post.title}, ${post.content.substring(0, 300)}
  // After:
  `<strong style="color:#1e293b">${escapeHtml(poster.name)}</strong>`
  `<h3 style="color:#1e293b;margin:8px 0">${escapeHtml(post.title)}</h3>`
  `${escapeHtml(post.content.substring(0, 300))}${post.content.length > 300 ? '…' : ''}`
  ```

  In `sendBigNewsNotification`:
  ```javascript
  `<strong style="color:#1e293b">${escapeHtml(poster.name)}</strong>`
  `<h3 style="color:#1e293b;margin:0 0 8px">${escapeHtml(post.title)}</h3>`
  `${escapeHtml(post.content.substring(0, 300))}${post.content.length > 300 ? '…' : ''}`
  // Also update the email subject line (nodemailer encodes subjects automatically, no change needed there)
  ```

  In `sendCommentNotification`:
  ```javascript
  `<strong style="color:#1e293b">${escapeHtml(fromUser.name)}</strong>`
  // post.title in the subject sentence:
  `${post.title ? ` "<em>${escapeHtml(post.title)}</em>"` : ''}`
  ```

  The password reset email uses only a URL (no user content) — no change needed there.

- [ ] **Step 3: Add comment length limit in `src/routes/comments.js`**

  Posts are capped at `MAX_CONTENT = 2000` characters. Comments have no limit. Add parity:

  ```javascript
  // At the top of the file, after requires:
  const MAX_COMMENT = 2000;

  // In the POST /posts/:id/comments handler, after the empty-content check:
  router.post('/posts/:id/comments', requireAuth, async (req, res) => {
    const { content, parent_id } = req.body;
    if (!content?.trim()) return res.redirect(`/post/${req.params.id}`);
    if (content.trim().length > MAX_COMMENT) {
      req.flash('error', `Comments cannot exceed ${MAX_COMMENT} characters.`);
      return res.redirect(`/post/${req.params.id}`);
    }
    // ... rest unchanged ...
  });
  ```

- [ ] **Step 4: Add startup env validation in `src/app.js`**

  Add at the very top of the `start()` function, before the DB retry loop:

  ```javascript
  async function start() {
    // Fail fast at startup if critical env vars are missing rather than
    // silently running in a broken state.
    const REQUIRED_ENV = ['SESSION_SECRET', 'DB_USER', 'DB_PASSWORD'];
    const missing = REQUIRED_ENV.filter(k => !process.env[k]);
    if (missing.length) {
      console.error('ERROR: Missing required environment variables:', missing.join(', '));
      process.exit(1);
    }

    for (let i = 0; i < 10; i++) {
      // ... DB retry loop unchanged ...
    }
    // ... rest unchanged ...
  }
  ```

- [ ] **Step 5: Deploy and verify**
  ```bash
  git push origin main
  # Wait for build, then:
  cd /home/jmull/docker
  sudo docker compose pull family-news && sudo docker compose up -d family-news
  ```

  Verify:
  - App starts and loads feed (env validation didn't false-alarm)
  - Post a comment → works normally
  - Post a reaction → works
  - Send a test push notification → still works (push whitelist didn't break anything)
  - Check docker logs for any startup errors: `sudo docker logs family-news --tail=20`

- [ ] **Step 6: Commit**
  ```bash
  git add src/push.js src/email.js src/routes/comments.js src/app.js
  git commit -m "security: whitelist checkColumn, HTML-escape emails, add comment length limit, validate env at startup"
  ```

---

## Task 6 — Annotate and harden notes/src/app.js

The notes app is a personal single-user app (~258 lines, everything in one file). Given its small size, modularization would be over-engineering. The goal here is comments and security only.

**File:** `notes/src/app.js`

**Comments to add:**

Module-level (top of file):
```javascript
/**
 * Notes app — single-file Express server.
 *
 * Single-password authentication (stored in NOTES_PASSWORD env var).
 * Notes are stored in MySQL with optional tags and full-text search.
 * All routes require the session to be authenticated (requireAuth middleware).
 */
```

Section separators:
```javascript
// ── Database pool ─────────────────────────────────────────────────────────────
// ── Database init ─────────────────────────────────────────────────────────────
// ── Tag helpers ───────────────────────────────────────────────────────────────
// ── Auth middleware ───────────────────────────────────────────────────────────
// ── Auth routes ───────────────────────────────────────────────────────────────
// ── Page routes ───────────────────────────────────────────────────────────────
// ── API routes ────────────────────────────────────────────────────────────────
// ── Server startup ────────────────────────────────────────────────────────────
```

JSDoc for `parseTags` and `saveTags`:
```javascript
/**
 * Parses a comma-separated tags string into a clean, deduplicated array.
 * Tags are lowercased, trimmed, capped at 20 chars each, and limited to 10 total.
 *
 * @param {string} tagsStr - Comma-separated raw tags from form input
 * @returns {string[]}
 */
function parseTags(tagsStr) { ... }

/**
 * Replaces all tags for a note in a single transaction-safe operation.
 * Deletes existing tags first, then inserts the new set.
 *
 * @param {import('mysql2/promise').PoolConnection} conn - Active DB connection
 * @param {number} noteId
 * @param {string} tagsStr - Comma-separated raw tags
 */
async function saveTags(conn, noteId, tagsStr) { ... }
```

Inline comment on the query routing note:
```javascript
// API — /api/notes/list must be registered BEFORE /api/notes/:id
// otherwise the literal string "list" is treated as an :id parameter.
app.get('/api/notes/list', ...);
```

**Security fixes:**

- [ ] **Step 1: Fail loud if SESSION_SECRET is missing**

  In `notes/src/app.js`, change:
  ```javascript
  // Before:
  app.use(session({
    secret: process.env.SESSION_SECRET || 'notes-secret',
  ```
  To:
  ```javascript
  // Fail at startup rather than use a predictable fallback secret.
  if (!process.env.SESSION_SECRET) {
    console.error('ERROR: SESSION_SECRET environment variable is required');
    process.exit(1);
  }
  app.use(session({
    secret: process.env.SESSION_SECRET,
  ```

- [ ] **Step 2: Add note content length limit**

  Add constant near the top of the file:
  ```javascript
  const MAX_NOTE_BYTES = 500_000; // 500KB — enough for any reasonable note
  ```

  In the `POST /api/notes` and `PUT /api/notes/:id` handlers, the existing check is:
  ```javascript
  if (!title?.trim() || !content?.trim()) return res.status(400).json({ error: 'Title and content required.' });
  ```

  Extend it:
  ```javascript
  if (!title?.trim() || !content?.trim()) return res.status(400).json({ error: 'Title and content required.' });
  if (content.length > MAX_NOTE_BYTES) return res.status(400).json({ error: 'Note content is too large.' });
  ```

- [ ] **Step 3: Deploy and verify**
  ```bash
  cd /home/jmull/projects/notes
  git push origin main
  # Wait for build, then:
  cd /home/jmull/docker
  sudo docker compose pull notes && sudo docker compose up -d notes
  ```

  Verify:
  - https://notes.jonathan-mullet.com loads and requires login
  - Create a new note → works
  - Search/filter notes → works
  - `sudo docker logs notes --tail=20` — no startup errors

- [ ] **Step 4: Commit**
  ```bash
  cd /home/jmull/projects/notes
  git add src/app.js
  git commit -m "docs+security: add comments, fail-loud session secret, note content length limit"
  git push origin main
  ```

---

## Scope check

| Requirement | Covered by |
|-------------|-----------|
| Plenty of comments | Tasks 1, 2, 3, 6 |
| Modular | Task 4 (enrichPosts helper) |
| Simple | Existing code is already simple; Task 4 removes duplication |
| Secure | Task 5 (SQL whitelist, HTML escaping, length limits, env validation), Task 6 (session secret) |
| No broken features | Deploy-and-verify step after every behavioral change; annotation tasks are zero-behavior-change |

**Total commits: 7** (3 docs-only, 1 refactor, 1 security family-news, 1 docs+security notes, notes git push)
