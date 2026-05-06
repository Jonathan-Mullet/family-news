# Android Push Notification Banner

**Date:** 2026-05-05

## Goal

Prompt Android users to enable push notifications when they visit any page, without requiring them to find the profile page. Users who have denied notifications get instructions on how to re-enable manually.

## Banner States

### Enable state
Shown to users who haven't subscribed and haven't denied the permission prompt yet.

```
🔔  Get notified when family posts  [Enable]  [✕]
```

Clicking **Enable** triggers the full push subscribe flow (request permission → subscribe to push manager → POST to `/push/subscribe`). On success, the banner hides. If the user denies the browser permission prompt, the banner switches to the Denied state.

### Denied state
Shown to users whose `Notification.permission === 'denied'`.

```
🔔  To re-enable: tap the lock icon in the address bar and allow notifications.  [✕]
```

Exact text matches the profile page denied state for non-iOS users.

## Show / Hide Logic

Runs on page load in `app.js`. The banner is hidden by default in HTML (no flash).

**Skip entirely (show nothing) if:**
- iOS device — they have the separate "Add to Home Screen" banner
- `Notification` API not supported in browser
- `localStorage.getItem('push-banner-dismissed')` is set

**Show denied state if:**
- `Notification.permission === 'denied'`

**Show enable state if:**
- `Notification.permission !== 'denied'`
- `await pushManager.getSubscription()` returns null

**Hide and set dismissed if:**
- User clicks ✕ on either state
- User successfully subscribes (enable state only)

The dismissed localStorage key (`push-banner-dismissed`) is shared with the existing iOS "Add to Home Screen" banner — dismissing either one suppresses both.

## Visual Design

Slim horizontal bar, same style as the existing `ios-pwa-banner` in `feed.ejs`. Sits immediately below the nav bar. Brand-colored background (`bg-brand-50`) with a left bell icon, message text, action button, and ✕ dismiss button. Uses inline styles for any dynamically shown/hidden classes to work around the Tailwind CDN limitation.

## Code Changes

### `src/views/partials/nav.ejs`
Add the banner HTML directly after the `<nav>` element, hidden by default. Gives it id `android-push-banner`.

### `src/public/js/app.js`
- Extract the push subscribe logic from the profile page section into a shared `_subscribeToPush()` helper that both the profile page and the banner can call.
- Add `_initAndroidPushBanner()` function that runs the show/hide logic on page load.
- Banner enable button calls `_subscribeToPush()`, then hides the banner on success.
- Banner ✕ button sets `push-banner-dismissed` and hides the banner.

The profile page `_enablePush()` function is updated to call `_subscribeToPush()` internally — no behavior change, just code reuse.
