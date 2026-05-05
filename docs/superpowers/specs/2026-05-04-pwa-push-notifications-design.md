# Design: PWA Push Notifications

**Date:** 2026-05-04
**Status:** Approved
**Scope:** Add Web Push notifications to the existing Family News PWA for iOS and Android. No APK. Covers service worker, VAPID key management, subscription storage, server-side push sending, client-side subscription flow, iOS Add to Home Screen nudge, and profile settings.

---

## Background

The PWA shell (manifest.json, icons, apple-touch-icon, and all meta tags) is already in place. The email notification system (`src/email.js`) already sends for new posts, comments on your post, and Big News. This feature adds parallel push notification delivery using the same triggers.

---

## 1. Database Schema

### New table: `push_subscriptions`

```sql
CREATE TABLE push_subscriptions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  endpoint VARCHAR(2048) NOT NULL UNIQUE,
  p256dh VARCHAR(512) NOT NULL,
  auth VARCHAR(256) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
)
```

One row per browser/device per user. A user can have multiple active subscriptions (phone + tablet + desktop). Expired subscriptions (410 Gone from push service) are deleted on first failed send.

### New columns on `users`

```sql
ALTER TABLE users ADD COLUMN push_notify_posts TINYINT(1) DEFAULT 1;
ALTER TABLE users ADD COLUMN push_notify_comments TINYINT(1) DEFAULT 1;
ALTER TABLE users ADD COLUMN push_notify_big_news TINYINT(1) DEFAULT 1;
```

All default to 1. These only have effect if the user has at least one row in `push_subscriptions`. They are independent of the email `notify_posts` / `notify_comments` columns.

### Email auto-opt-out on push subscribe

When a user subscribes to push for the first time on a device:
- If `notify_posts = 1` → set to 0
- If `notify_comments = 1` → set to 0
- `notify_big_news` email is never auto-disabled (Big News emails always go out regardless of push)
- The API response includes `{ emailsOptedOut: true }` so the client can show a one-time notice

Rationale: avoid double-notifying users who set up push. Users who have no push subscription keep their email settings unchanged.

---

## 2. VAPID Keys

Generate once and store in `/home/jmull/docker/.env`:

```
VAPID_PUBLIC_KEY=<base64url>
VAPID_PRIVATE_KEY=<base64url>
VAPID_SUBJECT=mailto:jmullet12100@icloud.com
```

Generated with:
```bash
node -e "const wp=require('web-push'); const k=wp.generateVAPIDKeys(); console.log('PUBLIC:', k.publicKey); console.log('PRIVATE:', k.privateKey);"
```

These are permanent — changing them invalidates all existing subscriptions.

---

## 3. Service Worker (`src/public/sw.js`)

Minimal — push handling only. No offline caching (a real-time feed has no useful offline state).

```js
self.addEventListener('push', event => {
  const data = event.data?.json() ?? {};
  event.waitUntil(
    self.registration.showNotification(data.title || 'Family News', {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url || '/' }
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.includes(self.location.origin) && 'focus' in c);
      if (existing) return existing.navigate(event.notification.data.url).then(c => c.focus());
      return clients.openWindow(event.notification.data.url);
    })
  );
});
```

Registered in `src/public/js/app.js` on every page load:

```js
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
```

---

## 4. Server-Side Push Module (`src/push.js`)

Parallel to `src/email.js`. Initialises `web-push` with VAPID keys. Exports two functions:

### `sendPushToUser(userId, payload, { checkColumn } = {})`

Sends to all subscriptions belonging to one user. Used for comment notifications (post author only).

```
payload = { title, body, url }
checkColumn (optional): 'push_notify_comments' — if provided, queries users.{checkColumn} and skips if 0
```

- If `checkColumn` provided: queries `users.{checkColumn}` for the user first; returns early if 0
- Queries `push_subscriptions WHERE user_id = ?`
- Calls `webpush.sendNotification(subscription, JSON.stringify(payload))` for each
- On error: if status 410 or 404 → delete that subscription row (expired)

Note: `checkColumn` is always a hardcoded string from the server, never from user input — no SQL injection risk.

### `sendPushToAllUsers(payload, { excludeUserId, checkColumn })`

Sends to all users with at least one push subscription, filtered by a preference column.

```
checkColumn: 'push_notify_posts' | 'push_notify_comments' | 'push_notify_big_news'
```

Query:
```sql
SELECT ps.user_id, ps.endpoint, ps.p256dh, ps.auth
FROM push_subscriptions ps
JOIN users u ON ps.user_id = u.id
WHERE u.active = 1
  AND u.{checkColumn} = 1
  AND ps.user_id != ?
```

---

## 5. Push Notification Triggers

Integrated into existing route handlers. Push is fire-and-forget (no `await` at the call site, errors logged internally).

### New post (`src/routes/posts.js`)

After the existing `sendNewPostNotification(users, poster, post)` call:

```js
sendPushToAllUsers(
  { title: `${poster.name} posted`, body: post.content.substring(0, 100), url: '/' },
  { excludeUserId: poster.id, checkColumn: 'push_notify_posts' }
);
```

### New comment (`src/routes/comments.js`)

After the existing `sendCommentNotification(toUser, fromUser, post)` call:

```js
if (post.user_id !== req.session.user.id) {
  sendPushToUser(post.user_id, {
    title: `${req.session.user.name} commented on your post`,
    body: content.substring(0, 100),
    url: `/post/${post.id}`
  });
}
```

Check `push_notify_comments` is handled inside `sendPushToUser` by querying `users.push_notify_comments` before sending.

Actually, to keep it consistent: `sendPushToUser` accepts an optional `checkColumn` param. If provided, it queries the user's preference before sending.

Updated signature:
```js
sendPushToUser(userId, payload, { checkColumn } = {})
```

### Big News toggle (`src/routes/posts.js`)

After the existing `sendBigNewsNotification(users, poster, post)` call (which fires when `big_news` is toggled on):

```js
sendPushToAllUsers(
  { title: `📣 Big News from ${poster.name}`, body: (post.title || post.content).substring(0, 100), url: `/post/${post.id}` },
  { excludeUserId: poster.id, checkColumn: 'push_notify_big_news' }
);
```

---

## 6. API Routes (`src/routes/push.js`, mounted at `/push`)

All routes require `requireAuth`.

### `GET /push/vapid-public-key`

Returns `{ publicKey: process.env.VAPID_PUBLIC_KEY }`. Called by client before subscribing.

### `POST /push/subscribe`

Body: `{ endpoint, p256dh, auth }` (extracted from the browser's `PushSubscription` JSON).

- Upserts into `push_subscriptions` (INSERT ... ON DUPLICATE KEY UPDATE)
- After upsert: if `users.notify_posts = 1` OR `users.notify_comments = 1`:
  - Sets both to 0
  - Returns `{ ok: true, emailsOptedOut: true }`
- Returns `{ ok: true, emailsOptedOut: false }` if both were already 0

This means the email opt-out fires whenever a user subscribes on any device while email notifications are still on (e.g., they manually re-enabled email and then add a second device). The notice is shown each time so they're aware.

### `POST /push/unsubscribe`

Body: `{ endpoint }`.

Deletes the matching row from `push_subscriptions`. Returns `{ ok: true }`.

### `POST /profile/push-prefs` (in `src/routes/profile.js`)

Body: `push_notify_posts`, `push_notify_comments`, `push_notify_big_news` (checkbox values).

Updates all three columns on the user row. Redirects to `/profile` with flash success.

---

## 7. Client-Side Subscription Flow (`src/public/js/app.js`)

Service worker registration added unconditionally on page load (as above).

The subscription UI lives on the profile page. The following JS is added to `app.js` and only activates when the push settings section is present (`document.getElementById('push-section')`).

### State detection on page load

```
Notification.permission === 'denied'  → show "Blocked" state with re-enable instructions
Notification.permission === 'granted' → check pushManager.getSubscription()
  subscription exists → show "Enabled" state + Disable button + prefs checkboxes
  no subscription    → show "Not subscribed" state + Enable button
Notification.permission === 'default' → show "Enable" button
```

### Enable flow

```
1. sw = await navigator.serviceWorker.ready
2. perm = await Notification.requestPermission()
3. if perm !== 'granted' → show blocked message, return
4. vapidKey = await fetch('/push/vapid-public-key').then(r => r.json()).then(d => d.publicKey)
5. sub = await sw.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidKey) })
6. res = await fetch('/push/subscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint, p256dh: btoa(String.fromCharCode(...new Uint8Array(sub.getKey('p256dh')))), auth: btoa(String.fromCharCode(...new Uint8Array(sub.getKey('auth')))) }), headers: { 'Content-Type': 'application/json' } })
7. data = await res.json()
8. if data.emailsOptedOut → show notice: "Push is on. Email notifications for posts and comments have been turned off — you can re-enable them in the Email Notifications section below."
9. Update UI to "Enabled" state
```

### Disable flow

```
1. sw = await navigator.serviceWorker.ready
2. sub = await sw.pushManager.getSubscription()
3. if sub → sub.unsubscribe()
4. POST /push/unsubscribe with { endpoint: sub.endpoint }
5. Update UI to "Not subscribed" state
```

### Helper: `urlBase64ToUint8Array`

Standard VAPID key conversion utility, included in `app.js`:

```js
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return new Uint8Array([...raw].map(c => c.charCodeAt(0)));
}
```

---

## 8. iOS Add to Home Screen Banner (feed page)

Shown on `src/views/feed.ejs`, rendered only when the EJS condition `showIosBanner` is true.

Server sets `showIosBanner` to false (banner logic is client-side via JS after render). The banner element is always rendered but hidden; JS reveals it if conditions are met.

Conditions to show (evaluated in `app.js`):
```js
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);
const isStandalone = navigator.standalone === true;
const dismissed = localStorage.getItem('pwa-banner-dismissed');
// hasActiveSub is set by the push section init code
if (isIOS && !isStandalone && !dismissed && !hasActiveSub) {
  document.getElementById('ios-pwa-banner')?.classList.remove('hidden');
}
```

Banner markup in `feed.ejs` (above the post list, below the compose box):

```html
<div id="ios-pwa-banner" class="hidden mb-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-2xl p-4 flex items-start gap-3">
  <span class="text-2xl">📱</span>
  <div class="flex-1 min-w-0">
    <p class="text-sm font-semibold text-amber-800 dark:text-amber-300">Get notifications on iPhone</p>
    <p class="text-xs text-amber-700 dark:text-amber-400 mt-0.5">Tap the Share button (□↑) then "Add to Home Screen" to enable push notifications for Family News.</p>
  </div>
  <button id="ios-pwa-banner-dismiss" class="text-amber-500 dark:text-amber-400 text-xl leading-none min-h-[36px] min-w-[36px] flex items-center justify-center">✕</button>
</div>
```

Dismiss handler (in `app.js`):
```js
document.getElementById('ios-pwa-banner-dismiss')?.addEventListener('click', () => {
  localStorage.setItem('pwa-banner-dismissed', '1');
  document.getElementById('ios-pwa-banner').classList.add('hidden');
});
```

---

## 9. Profile Settings UI (`src/views/profile.ejs`)

New section inserted between "Email Notifications" and "Account info".

The section is always rendered server-side. JS populates the dynamic state (enabled/disabled, permission state) on load.

### Section structure

```html
<div class="fn-settings-card" id="push-section">
  <h2 class="fn-settings-card-title">Push Notifications</h2>

  <!-- Status + action button — JS sets visibility of each state div -->
  <div id="push-state-default" class="hidden">
    <p class="text-sm text-slate-500 dark:text-slate-400 mb-3">Get notified on this device even when the app is closed.</p>
    <button id="push-enable-btn" class="fn-btn">Enable push notifications</button>
  </div>

  <div id="push-state-enabled" class="hidden space-y-3">
    <p class="text-sm text-green-600 dark:text-green-400 font-medium">Push notifications are on</p>
    <!-- Per-event prefs form -->
    <form method="POST" action="/profile/push-prefs" class="space-y-2">
      <label class="fn-checkbox-label">
        <input class="fn-checkbox" type="checkbox" name="push_notify_posts" value="1">
        <span>Notify me when someone posts</span>
      </label>
      <label class="fn-checkbox-label">
        <input class="fn-checkbox" type="checkbox" name="push_notify_comments" value="1">
        <span>Notify me when someone comments on my post</span>
      </label>
      <label class="fn-checkbox-label">
        <input class="fn-checkbox" type="checkbox" name="push_notify_big_news" value="1">
        <span>Notify me for Big News</span>
      </label>
      <div class="pt-1">
        <button type="submit" class="fn-btn">Save Preferences</button>
      </div>
    </form>
    <button id="push-disable-btn" class="fn-btn-ghost text-sm">Turn off push notifications</button>
  </div>

  <div id="push-state-denied" class="hidden">
    <p class="text-sm text-slate-500 dark:text-slate-400 mb-2">Notifications are blocked in your browser.</p>
    <p class="text-sm text-slate-500 dark:text-slate-400" id="push-denied-instructions"></p>
    <!-- JS fills in device-specific instructions -->
  </div>

  <!-- iOS non-standalone notice (JS shows if needed) -->
  <div id="push-ios-notice" class="hidden">
    <p class="text-sm text-slate-500 dark:text-slate-400">To enable push notifications on iPhone, first add Family News to your Home Screen via the Share button (□↑).</p>
  </div>

  <!-- Email opt-out notice (shown once after enabling push) -->
  <div id="push-email-notice" class="hidden mt-3 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-3">
    Push is on. Email notifications for posts and comments have been turned off — you can re-enable them in the Email Notifications section below.
  </div>
</div>
```

### JS behaviour

On page load (when `#push-section` exists):
- Check `navigator.standalone` — if iOS and not standalone: show `#push-ios-notice`, hide all other states, return early
- Check `Notification.permission`:
  - `denied` → show `#push-state-denied`, fill in `#push-denied-instructions` with device-specific text
  - `granted` → `sw = await navigator.serviceWorker.ready`, then `sub = await sw.pushManager.getSubscription()`:
    - subscription found → show `#push-state-enabled`, populate checkboxes from `data-*` attrs on the section
    - no subscription → show `#push-state-default`
  - `default` → show `#push-state-default`
- `push-enable-btn` click → runs Enable flow (section 7)
- `push-disable-btn` click → runs Disable flow (section 7)

Checkbox values are pre-populated via server-rendered `data-*` attributes on `#push-section`:
```html
<div id="push-section"
  data-notify-posts="<%= user.push_notify_posts %>"
  data-notify-comments="<%= user.push_notify_comments %>"
  data-notify-big-news="<%= user.push_notify_big_news %>">
```

JS reads these and checks the boxes accordingly when showing `#push-state-enabled`.

Denied instructions (set by JS based on `navigator.userAgent`):
- iOS: "To re-enable: go to Settings → Safari → Notifications and allow Family News."
- Android/other: "To re-enable: tap the lock icon in the address bar and allow notifications."

---

## 10. Files Changed

| File | Change |
|------|--------|
| `src/public/sw.js` | Create — push and notificationclick handlers |
| `src/push.js` | Create — `sendPushToUser`, `sendPushToAllUsers` |
| `src/routes/push.js` | Create — `GET /push/vapid-public-key`, `POST /push/subscribe`, `POST /push/unsubscribe` |
| `src/routes/profile.js` | Add `POST /profile/push-prefs` |
| `src/db.js` | Add migrations: `push_subscriptions` table + 3 user columns |
| `src/app.js` | Mount `require('./routes/push')` at `/push` |
| `src/routes/posts.js` | Add `sendPushToAllUsers` calls after post create and Big News toggle |
| `src/routes/comments.js` | Add `sendPushToUser` call after comment create |
| `src/public/js/app.js` | Add SW registration, push subscription flow, iOS banner logic, profile push UI JS |
| `src/views/profile.ejs` | Add push notifications section |
| `src/views/feed.ejs` | Add iOS Add to Home Screen banner element |
| `package.json` | Add `web-push` dependency |
| `/home/jmull/docker/.env` | Add `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` |

---

## 11. Out of Scope

- Offline support / caching strategy (no meaningful offline state for a real-time feed)
- Reaction push notifications (too noisy)
- Reply push notifications (comments on comments — not yet implemented)
- Admin-targeted push blasts
- Push notification history / inbox
