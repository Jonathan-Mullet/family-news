# Android Push Notification Banner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a slim top banner on every page prompting Android users to enable push notifications, with a denied-state variant showing re-enable instructions.

**Architecture:** Banner HTML lives in `partials/nav.ejs` (hidden by default via inline style). On page load, `app.js` runs an async check and either shows the enable variant, the denied-instructions variant, or nothing. The core push-subscribe logic is extracted from the profile-page-only `_enablePush()` into a shared `_subscribeToPush()` helper so both the banner and the profile page call the same code.

**Tech Stack:** EJS (banner HTML), vanilla JS (banner logic in existing `app.js`), Web Push API, existing `/push/vapid-public-key` and `/push/subscribe` endpoints.

---

### Task 1: Add banner HTML to nav partial

**Files:**
- Modify: `src/views/partials/nav.ejs` — add banner element after `</nav>`

- [ ] **Step 1: Add the banner HTML after the closing `</nav>` tag**

  Open `src/views/partials/nav.ejs`. The file ends with `</nav>` on the last line. Insert this immediately after it:

  ```html
  <div id="android-push-banner" style="display:none;background:#fdf6f0;border-bottom:1px solid #e5c9b0;">
    <div style="max-width:42rem;margin:0 auto;padding:8px 1rem;display:flex;align-items:center;gap:10px;">
      <span style="font-size:1rem;flex-shrink:0;">🔔</span>
      <p id="android-push-banner-msg" style="flex:1;font-size:0.8rem;color:#5c3d2e;margin:0;line-height:1.4;"></p>
      <button id="android-push-enable" style="background:#8b5e3c;color:white;border:none;border-radius:6px;padding:4px 10px;font-size:0.75rem;cursor:pointer;white-space:nowrap;flex-shrink:0;">Enable</button>
      <button id="android-push-dismiss" style="background:none;border:none;color:#a08060;font-size:1rem;cursor:pointer;padding:4px;flex-shrink:0;line-height:1;" title="Dismiss">✕</button>
    </div>
  </div>
  ```

  The `id="android-push-enable"` button is hidden in the denied state — JS handles that by setting `style.display`.

- [ ] **Step 2: Verify the banner element is present but invisible on page load**

  Start the app locally (or check the running Docker container) and open any page. The banner should not be visible. Open DevTools → Elements and confirm `#android-push-banner` exists with `display:none`.

- [ ] **Step 3: Commit**

  ```bash
  cd ~/projects/family-news
  git add src/views/partials/nav.ejs
  git commit -m "feat: add android push banner HTML to nav partial"
  ```

---

### Task 2: Extract shared subscribe helper and wire up banner logic

**Files:**
- Modify: `src/public/js/app.js` — extract `_subscribeToPush()`, update `_enablePush()`, add `_initAndroidPushBanner()`

- [ ] **Step 1: Extract `_subscribeToPush()` above the profile-page guard**

  In `src/public/js/app.js`, find the service worker registration block (the `── Service worker ──` section). Add the new shared helper immediately after `urlBase64ToUint8Array` and before the `── iOS Add to Home Screen banner ──` section:

  ```js
  // ── Shared push subscribe helper ──────────────────────────────────────────────
  // Called by both the profile page enable button and the android push banner.
  // Requests permission, subscribes to push manager, and POSTs the subscription
  // to the server. Returns true on success, false if denied or errored.
  async function _subscribeToPush() {
    try {
      const sw = await navigator.serviceWorker.ready;
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return false;
      const { publicKey } = await fetch('/push/vapid-public-key').then(r => r.json());
      if (!publicKey) throw new Error('Missing VAPID key');
      const sub = await sw.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      const body = JSON.stringify({
        endpoint: sub.endpoint,
        p256dh: btoa(String.fromCharCode(...new Uint8Array(sub.getKey('p256dh')))),
        auth: btoa(String.fromCharCode(...new Uint8Array(sub.getKey('auth')))),
      });
      const resp = await fetch('/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      if (!resp.ok) throw new Error(`Subscribe failed: ${resp.status}`);
      return { data: await resp.json() };
    } catch { return false; }
  }
  ```

- [ ] **Step 2: Update `_enablePush()` on the profile page to use `_subscribeToPush()`**

  Inside the `if (_pushSection)` block, replace the existing `_enablePush` function body with a call to the shared helper:

  ```js
  async function _enablePush() {
    const result = await _subscribeToPush();
    if (!result) { _showPushState('push-state-denied'); return; }
    if (result.data?.emailsOptedOut) {
      document.getElementById('push-email-notice')?.classList.remove('hidden');
    }
    _showPushState('push-state-enabled');
    _populatePushCheckboxes();
  }
  ```

  The original `_enablePush` body (permission request, VAPID fetch, subscribe, POST) is now fully inside `_subscribeToPush()` — remove all of that original code from `_enablePush`.

- [ ] **Step 3: Verify the profile page push flow still works**

  Open `/profile` in the browser. The Enable Notifications button should still trigger the permission prompt and subscribe successfully. Check the browser console for errors.

- [ ] **Step 4: Add `_initAndroidPushBanner()` after the iOS banner section**

  After the `── iOS Add to Home Screen banner ──` block (which ends with the closing `}`), add:

  ```js
  // ── Android push notification banner ──────────────────────────────────────────
  // Shows a slim top banner on every page for Android users who have not yet
  // subscribed to push notifications and have not dismissed the prompt.
  // Skips iOS (they have the Add-to-Home-Screen flow), browsers without Push API,
  // and users who previously dismissed via either this banner or the iOS banner.
  (async function _initAndroidPushBanner() {
    const banner = document.getElementById('android-push-banner');
    if (!banner) return;

    const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);
    if (isIOS) return;
    if (typeof Notification === 'undefined' || !('PushManager' in window)) return;
    if (localStorage.getItem('pwa-banner-dismissed')) return;

    const msgEl = document.getElementById('android-push-banner-msg');
    const enableBtn = document.getElementById('android-push-enable');
    const dismissBtn = document.getElementById('android-push-dismiss');

    dismissBtn.addEventListener('click', () => {
      localStorage.setItem('pwa-banner-dismissed', '1');
      banner.style.display = 'none';
    });

    if (Notification.permission === 'denied') {
      msgEl.textContent = 'To re-enable: tap the lock icon in the address bar and allow notifications.';
      enableBtn.style.display = 'none';
      banner.style.display = 'block';
      return;
    }

    try {
      const sw = await navigator.serviceWorker.ready;
      const sub = await sw.pushManager.getSubscription();
      if (sub) return; // already subscribed
    } catch { return; }

    msgEl.textContent = 'Get notified when family posts.';
    banner.style.display = 'block';

    enableBtn.addEventListener('click', async () => {
      enableBtn.disabled = true;
      enableBtn.textContent = '…';
      const result = await _subscribeToPush();
      if (result) {
        banner.style.display = 'none';
      } else {
        // User denied — switch to instructions state
        msgEl.textContent = 'To re-enable: tap the lock icon in the address bar and allow notifications.';
        enableBtn.style.display = 'none';
        enableBtn.disabled = false;
      }
    });
  })();
  ```

- [ ] **Step 5: Test enable flow**

  Open any page in Chrome on Android (or Chrome desktop for quick testing — it supports Push API). The banner should appear. Click Enable, approve the permission prompt, and confirm the banner disappears. Check the database to verify a new subscription row was inserted:

  ```bash
  cd ~/docker && sudo docker compose exec mysql mysql -ufamilynews -pf32a85d6b04822d2c090ce1c1aeea698 family_news -e "SELECT id, user_id, created_at FROM push_subscriptions ORDER BY id DESC LIMIT 5;" 2>/dev/null
  ```

- [ ] **Step 6: Test denied flow**

  In Chrome DevTools → Application → Notifications, set permission to "Block" for localhost (or the site domain). Reload any page. The banner should appear with the re-enable instructions and no Enable button. The ✕ should dismiss and not reappear after reload.

- [ ] **Step 7: Test dismiss persistence**

  With the banner visible, click ✕. Reload the page. The banner should not reappear. Verify `localStorage.getItem('pwa-banner-dismissed')` is `'1'` in DevTools → Application → Local Storage.

- [ ] **Step 8: Test already-subscribed suppression**

  Subscribe on the profile page (or via the banner in Step 5). Navigate to another page. The banner should not appear.

- [ ] **Step 9: Confirm banner does not appear on iOS**

  Open the site in Safari on iOS (or use DevTools UA spoofing). The banner should not appear regardless of notification state.

- [ ] **Step 10: Commit**

  ```bash
  cd ~/projects/family-news
  git add src/public/js/app.js
  git commit -m "feat: android push notification banner on all pages"
  ```

---

### Task 3: Deploy

- [ ] **Step 1: Push to GitHub**

  ```bash
  cd ~/projects/family-news && git push origin main
  ```

- [ ] **Step 2: Wait for CI build**

  ```bash
  cd ~/projects/family-news && gh run watch --exit-status
  ```

  Expected: build completes successfully in ~35s.

- [ ] **Step 3: Pull and restart container**

  ```bash
  cd ~/docker && sudo docker compose pull family-news && sudo docker compose up -d family-news
  ```

- [ ] **Step 4: Smoke test on device**

  Open the live site on an Android device or Chrome desktop. Confirm the banner appears for a user without a push subscription and hides after enabling or dismissing.
