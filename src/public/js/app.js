// Convert all timestamps to the viewer's local timezone.
// EJS renders timestamps server-side (wrong TZ), so we emit bare <time data-ts="ISO">
// elements and fill them here. data-fmt="long" = weekday+long month, "compact" = no year.
document.querySelectorAll('time[data-ts]').forEach(el => {
  const fmt = el.dataset.fmt;
  const opts = fmt === 'long'
    ? { weekday:'long', month:'long', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit', timeZoneName:'short' }
    : fmt === 'compact'
    ? { month:'short', day:'numeric', hour:'numeric', minute:'2-digit', timeZoneName:'short' }
    : { month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit', timeZoneName:'short' };
  el.textContent = new Date(el.dataset.ts).toLocaleString('en-US', opts);
});

// Dark mode toggle
const darkToggle = document.getElementById('dark-toggle');
if (darkToggle) {
  darkToggle.addEventListener('click', () => {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.theme = isDark ? 'dark' : 'light';
  });
}

// Reaction names bottom sheet (mobile long-press)
const _reactionSheet = document.createElement('div');
_reactionSheet.id = 'reaction-sheet';
_reactionSheet.className = 'fixed inset-x-0 bottom-0 z-50 bg-white dark:bg-slate-800 rounded-t-2xl shadow-2xl border-t border-slate-200 dark:border-slate-700 p-5 translate-y-full transition-transform duration-300';
_reactionSheet.innerHTML = '<div class="flex items-center justify-between mb-4"><h3 class="font-semibold text-slate-700 dark:text-slate-200 text-sm">Reactions</h3><button id="reaction-sheet-close" class="text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 text-xl min-h-[36px] min-w-[36px] flex items-center justify-center">✕</button></div><div id="reaction-sheet-content" class="space-y-3 max-h-64 overflow-y-auto"></div>';
document.body.appendChild(_reactionSheet);

let _sheetOverlay = null;

function _showReactionSheet(names) {
  _hideReactionSheet();
  const content = document.getElementById('reaction-sheet-content');
  content.innerHTML = '';
  const order = ['❤️','👍','😂','😮','😢','🎉','🙏','🔥','💯','🫶','👏','🥳','😍','🤣','😭','💪','🎂','🌟','👀','🤔','💔'];
  order.filter(e => names[e]?.length).forEach(e => {
    const div = document.createElement('div');
    div.className = 'flex items-start gap-3';
    const emojiSpan = document.createElement('span');
    emojiSpan.className = 'text-xl leading-none';
    emojiSpan.textContent = e;
    const nameP = document.createElement('p');
    nameP.className = 'text-sm text-slate-700 dark:text-slate-200';
    nameP.textContent = names[e].join(', ');
    div.appendChild(emojiSpan);
    div.appendChild(nameP);
    content.appendChild(div);
  });
  _sheetOverlay = document.createElement('div');
  _sheetOverlay.className = 'fixed inset-0 z-40 bg-black/30';
  document.body.appendChild(_sheetOverlay);
  _sheetOverlay.addEventListener('click', _hideReactionSheet);
  requestAnimationFrame(() => _reactionSheet.classList.remove('translate-y-full'));
}

function _hideReactionSheet() {
  _reactionSheet.classList.add('translate-y-full');
  if (_sheetOverlay) { _sheetOverlay.remove(); _sheetOverlay = null; }
}

document.getElementById('reaction-sheet-close').addEventListener('click', _hideReactionSheet);

// Reaction tooltip
let tooltipEl = null;
const nameCache = {};

function showTooltip(text, anchor) {
  hideTooltip();
  tooltipEl = document.createElement('div');
  tooltipEl.className = 'fixed z-50 px-2.5 py-1.5 text-xs bg-slate-800 dark:bg-slate-600 text-white rounded-lg shadow-lg pointer-events-none max-w-[200px]';
  tooltipEl.textContent = text;
  document.body.appendChild(tooltipEl);
  const r = anchor.getBoundingClientRect();
  const left = Math.max(8, Math.min(r.left + r.width / 2 - tooltipEl.offsetWidth / 2, window.innerWidth - tooltipEl.offsetWidth - 8));
  tooltipEl.style.left = left + 'px';
  tooltipEl.style.top = (r.top - tooltipEl.offsetHeight - 8 + window.scrollY) + 'px';
}

function hideTooltip() {
  if (tooltipEl) { tooltipEl.remove(); tooltipEl = null; }
}

async function fetchReactionNames(postId) {
  if (nameCache[postId]) return nameCache[postId];
  try {
    const res = await fetch(`/posts/${postId}/reaction-names`);
    nameCache[postId] = await res.json();
  } catch { nameCache[postId] = {}; }
  return nameCache[postId];
}

// ── Reactions ─────────────────────────────────────────────────────────────────

const EMOJI_ORDER = ['❤️','👍','😂','😮','😢','🎉','🙏','🔥','💯','🫶','👏','🥳','😍','🤣','😭','💪','🎂','🌟','👀','🤔','💔'];

// Seed reaction state from server-rendered data attributes
const reactionState = {};
document.querySelectorAll('[id^="reaction-chips-"]').forEach(el => {
  const postId = el.id.replace('reaction-chips-', '');
  try { reactionState[postId] = JSON.parse(el.dataset.reactions || '{}'); }
  catch { reactionState[postId] = {}; }
});

function renderReactionChips(postId) {
  const chipsArea = document.getElementById(`reaction-chips-${postId}`);
  if (!chipsArea) return;
  const state = reactionState[postId] || {};
  const toggleBtn = chipsArea.querySelector('.emoji-picker-toggle');

  chipsArea.querySelectorAll('.reaction-chip').forEach(c => c.remove());

  EMOJI_ORDER.forEach(emoji => {
    const r = state[emoji];
    if (!r || r.count === 0) return;
    const chip = document.createElement('button');
    chip.className = 'reaction-chip reaction-btn flex items-center gap-1 px-2 py-1 rounded-full text-sm border transition-all min-h-[30px] ' +
      (r.userReacted
        ? 'bg-brand-50 dark:bg-brand-600/20 border-brand-300 dark:border-brand-600'
        : 'bg-slate-50 dark:bg-slate-700/40 border-slate-200 dark:border-slate-600 hover:border-brand-300 dark:hover:border-brand-500');
    chip.dataset.postId = postId;
    chip.dataset.emoji = emoji;
    chip.innerHTML = `<span>${emoji}</span><span class="reaction-count text-xs font-medium text-slate-500 dark:text-slate-400">${r.count}</span>`;
    chipsArea.insertBefore(chip, toggleBtn);
  });

  if (_pickerPostId === postId) _syncPickerState(postId);
}

async function handleReactionClick(postId, emoji) {
  hideTooltip();
  delete nameCache[postId];
  try {
    const res = await fetch(`/posts/${postId}/react`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emoji }),
    });
    const data = await res.json();
    if (!reactionState[postId]) reactionState[postId] = {};
    if (data.count === 0) {
      delete reactionState[postId][emoji];
    } else {
      reactionState[postId][emoji] = { count: data.count, userReacted: data.userReacted };
    }
    renderReactionChips(postId);
  } catch (e) { console.error(e); }
}

// Event delegation — chips and summary (handles dynamically-created chips too)
document.addEventListener('click', e => {
  const chip = e.target.closest('.reaction-chip');
  if (chip && !chip.closest('.emoji-picker')) {
    handleReactionClick(chip.dataset.postId, chip.dataset.emoji);
    return;
  }
  const summary = e.target.closest('.reaction-summary');
  if (summary) {
    const article = summary.closest('article[data-post-id]');
    if (!article) return;
    try { _showReactionSheet(JSON.parse(article.dataset.reactionNames || '{}')); }
    catch {}
  }
});

// ── Emoji picker bottom sheet ─────────────────────────────────────────────────
// Mirrors _reactionSheet exactly — same proven show/hide pattern that works on
// all platforms including iOS PWA. No floating-position math needed.

const _pickerSheet = document.createElement('div');
_pickerSheet.className = 'fixed inset-x-0 bottom-0 z-50 bg-white dark:bg-slate-800 rounded-t-2xl shadow-2xl border-t border-slate-200 dark:border-slate-700 p-4 translate-y-full transition-transform duration-300';
document.body.appendChild(_pickerSheet);

const _pickerHeader = document.createElement('div');
_pickerHeader.className = 'flex items-center justify-between mb-3';
const _pickerTitle = document.createElement('h3');
_pickerTitle.className = 'font-semibold text-slate-700 dark:text-slate-200 text-sm';
_pickerTitle.textContent = 'Add a reaction';
const _pickerCloseBtn = document.createElement('button');
_pickerCloseBtn.className = 'text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 text-xl min-h-[36px] min-w-[36px] flex items-center justify-center';
_pickerCloseBtn.textContent = '✕';
_pickerHeader.appendChild(_pickerTitle);
_pickerHeader.appendChild(_pickerCloseBtn);
_pickerSheet.appendChild(_pickerHeader);

const _pickerGrid = document.createElement('div');
_pickerGrid.style.cssText = 'display:grid;grid-template-columns:repeat(7,1fr);gap:4px;';
_pickerSheet.appendChild(_pickerGrid);

let _pickerPostId = null;
let _pickerOverlay = null;
const _pickerBtns = {};

EMOJI_ORDER.forEach(e => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = e;
  btn.dataset.emoji = e;
  btn.style.cssText = 'font-size:1.5rem;padding:8px;border-radius:10px;border:2px solid transparent;background:none;cursor:pointer;min-height:48px;display:flex;align-items:center;justify-content:center;';
  btn.addEventListener('click', ev => {
    ev.stopPropagation();
    const postId = _pickerPostId;
    _hidePickerSheet();
    if (postId) handleReactionClick(postId, e);
  });
  _pickerGrid.appendChild(btn);
  _pickerBtns[e] = btn;
});

function _syncPickerState(postId) {
  const state = reactionState[postId] || {};
  EMOJI_ORDER.forEach(e => {
    const btn = _pickerBtns[e];
    const active = !!state[e]?.userReacted;
    btn.style.background = active ? '#fdf6f0' : 'none';
    btn.style.borderColor = active ? '#c4895a' : 'transparent';
  });
}

function _showPickerSheet(postId) {
  _pickerPostId = postId;
  _syncPickerState(postId);
  _pickerOverlay = document.createElement('div');
  _pickerOverlay.className = 'fixed inset-0 z-40 bg-black/30';
  document.body.appendChild(_pickerOverlay);
  _pickerOverlay.addEventListener('click', _hidePickerSheet);
  requestAnimationFrame(() => _pickerSheet.classList.remove('translate-y-full'));
}

function _hidePickerSheet() {
  _pickerSheet.classList.add('translate-y-full');
  if (_pickerOverlay) { _pickerOverlay.remove(); _pickerOverlay = null; }
  _pickerPostId = null;
}

_pickerCloseBtn.addEventListener('click', _hidePickerSheet);

document.querySelectorAll('.emoji-picker-toggle').forEach(toggleBtn => {
  toggleBtn.addEventListener('click', e => {
    e.stopPropagation();
    _showPickerSheet(toggleBtn.dataset.postId);
  });
});

// Auto-refresh polling (feed page only)
const feedEl = document.getElementById('feed');
const refreshToast = document.getElementById('refresh-toast');
if (feedEl && refreshToast) {
  const latestId = parseInt(feedEl.dataset.latest) || 0;
  let toastShown = false;

  const poll = async () => {
    if (toastShown) return;
    try {
      const res = await fetch('/api/feed-state');
      const data = await res.json();
      if (data.latestId && data.latestId !== latestId) {
        refreshToast.classList.remove('hidden');
        toastShown = true;
      }
    } catch {}
  };

  setInterval(poll, 25000);
  refreshToast.addEventListener('click', () => location.reload());
}

// Pull-to-refresh (standalone PWA only — avoids conflicting with Safari's native gesture in browser)
if (feedEl && (navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches)) {
  const PTR_THRESHOLD = 80;
  let ptrStartY = 0;
  let ptrActive = false;
  let ptrDist = 0;

  const ptrEl = document.createElement('div');
  ptrEl.style.cssText = 'position:fixed;top:0;left:0;right:0;display:flex;justify-content:center;z-index:50;pointer-events:none;transform:translateY(-64px);transition:transform 0.15s ease';
  ptrEl.innerHTML = '<div style="margin-top:12px;width:36px;height:36px;background:var(--tw-bg-opacity,white);border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,.15);display:flex;align-items:center;justify-content:center" class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700"><svg id="ptr-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" style="width:18px;height:18px;transform-origin:center;color:#8b5e3c"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="56.5" stroke-dashoffset="14" opacity="0.25"/><path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg></div>';
  document.body.appendChild(ptrEl);

  document.addEventListener('touchstart', e => {
    if (window.scrollY === 0) { ptrStartY = e.touches[0].clientY; ptrActive = true; ptrDist = 0; }
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    if (!ptrActive) return;
    const dy = e.touches[0].clientY - ptrStartY;
    if (dy <= 0) { ptrActive = false; ptrEl.style.transform = 'translateY(-64px)'; return; }
    ptrDist = dy;
    const progress = Math.min(dy / PTR_THRESHOLD, 1);
    ptrEl.style.transform = `translateY(${-64 + 72 * progress}px)`;
    const icon = document.getElementById('ptr-icon');
    if (icon) icon.style.transform = `rotate(${progress * 360}deg)`;
  }, { passive: true });

  document.addEventListener('touchend', () => {
    if (!ptrActive) return;
    ptrActive = false;
    if (ptrDist >= PTR_THRESHOLD) {
      const icon = document.getElementById('ptr-icon');
      if (icon) { icon.style.transition = 'transform 0.4s linear'; icon.style.transform = 'rotate(720deg)'; }
      setTimeout(() => location.reload(), 350);
    } else {
      ptrEl.style.transform = 'translateY(-64px)';
    }
    ptrDist = 0;
  });
}

// Service worker registration (required for push on all platforms)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// Convert URL-safe base64 VAPID public key to Uint8Array for pushManager.subscribe
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return new Uint8Array([...raw].map(c => c.charCodeAt(0)));
}

// iOS Add to Home Screen banner (feed page only)
const _iosBanner = document.getElementById('ios-pwa-banner');
if (_iosBanner) {
  const _isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);
  const _isStandalone = navigator.standalone === true;
  const _pwaGranted = typeof Notification !== 'undefined' && Notification.permission === 'granted';
  const _pwaDismissed = localStorage.getItem('pwa-banner-dismissed');
  if (_isIOS && !_isStandalone && !_pwaGranted && !_pwaDismissed) {
    _iosBanner.classList.remove('hidden');
  }
  document.getElementById('ios-pwa-banner-dismiss')?.addEventListener('click', () => {
    localStorage.setItem('pwa-banner-dismissed', '1');
    _iosBanner.classList.add('hidden');
  });
}

// Push notifications UI (profile page only)
const _pushSection = document.getElementById('push-section');
if (_pushSection) {
  const _pushIsIOSNonStandalone = /iP(hone|ad|od)/.test(navigator.userAgent) && navigator.standalone !== true;

  function _showPushState(id) {
    ['push-state-default', 'push-state-enabled', 'push-state-denied', 'push-ios-notice'].forEach(s => {
      document.getElementById(s)?.classList.add('hidden');
    });
    document.getElementById(id)?.classList.remove('hidden');
  }

  function _populatePushCheckboxes() {
    const sec = document.getElementById('push-section');
    const posts = document.querySelector('#push-state-enabled input[name="push_notify_posts"]');
    const comments = document.querySelector('#push-state-enabled input[name="push_notify_comments"]');
    const bigNews = document.querySelector('#push-state-enabled input[name="push_notify_big_news"]');
    if (posts) posts.checked = sec.dataset.notifyPosts !== '0';
    if (comments) comments.checked = sec.dataset.notifyComments !== '0';
    if (bigNews) bigNews.checked = sec.dataset.notifyBigNews !== '0';
  }

  async function _initPushSection() {
    if (_pushIsIOSNonStandalone) { _showPushState('push-ios-notice'); return; }
    if (typeof Notification === 'undefined' || !('PushManager' in window)) {
      _pushSection.querySelector('h2').insertAdjacentHTML('afterend',
        '<p class="text-sm text-slate-400 dark:text-slate-500">Push notifications are not supported in this browser.</p>'
      );
      return;
    }
    if (Notification.permission === 'denied') {
      _showPushState('push-state-denied');
      const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);
      const el = document.getElementById('push-denied-instructions');
      if (el) el.textContent = isIOS
        ? 'To re-enable: go to Settings → Safari → Notifications and allow Family News.'
        : 'To re-enable: tap the lock icon in the address bar and allow notifications.';
      return;
    }
    try {
      const sw = await navigator.serviceWorker.ready;
      const sub = await sw.pushManager.getSubscription();
      if (sub) {
        _showPushState('push-state-enabled');
        _populatePushCheckboxes();
      } else {
        _showPushState('push-state-default');
      }
    } catch { _showPushState('push-state-default'); }
  }

  async function _enablePush() {
    try {
      const sw = await navigator.serviceWorker.ready;
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { _showPushState('push-state-denied'); return; }
      const { publicKey } = await fetch('/push/vapid-public-key').then(r => r.json());
      const sub = await sw.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
      const body = JSON.stringify({
        endpoint: sub.endpoint,
        p256dh: btoa(String.fromCharCode(...new Uint8Array(sub.getKey('p256dh')))),
        auth: btoa(String.fromCharCode(...new Uint8Array(sub.getKey('auth'))))
      });
      const _subResp = await fetch('/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      if (!_subResp.ok) throw new Error(`Subscribe failed: ${_subResp.status}`);
      const data = await _subResp.json();
      if (data.emailsOptedOut) {
        document.getElementById('push-email-notice')?.classList.remove('hidden');
      }
      _showPushState('push-state-enabled');
      _populatePushCheckboxes();
    } catch (err) { console.error('Push enable error:', err); }
  }

  async function _disablePush() {
    try {
      const sw = await navigator.serviceWorker.ready;
      const sub = await sw.pushManager.getSubscription();
      if (sub) {
        await sub.unsubscribe();
        await fetch('/push/unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) });
      }
      _showPushState('push-state-default');
    } catch (err) { console.error('Push disable error:', err); }
  }

  document.getElementById('push-enable-btn')?.addEventListener('click', _enablePush);
  document.getElementById('push-disable-btn')?.addEventListener('click', _disablePush);

  _initPushSection();
}
