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

// Handle a reaction click (shared between inline buttons and emoji picker)
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

    document.querySelectorAll(`.reaction-btn[data-post-id="${postId}"][data-emoji="${emoji}"]`).forEach(b => {
      const countEl = b.querySelector('.reaction-count');
      if (countEl) {
        countEl.textContent = data.count;
        countEl.classList.toggle('hidden', data.count === 0);
      }
      b.classList.toggle('bg-brand-50', data.userReacted);
      b.classList.toggle('dark:bg-brand-600/20', data.userReacted);
      b.classList.toggle('border-brand-200', data.userReacted);
      b.classList.toggle('dark:border-brand-700', data.userReacted);
      b.classList.toggle('border-transparent', !data.userReacted);
    });
  } catch (e) { console.error(e); }
}

// Reactions
document.querySelectorAll('.reaction-btn').forEach(btn => {
  if (btn.closest('.emoji-picker')) return;
  btn.addEventListener('click', () => {
    const postId = btn.dataset.postId;
    const emoji = btn.dataset.emoji;
    handleReactionClick(postId, emoji, btn);
  });
});

document.querySelectorAll('.reaction-summary').forEach(btn => {
  btn.addEventListener('click', () => {
    const article = btn.closest('article[data-post-id]');
    if (!article) return;
    try {
      _showReactionSheet(JSON.parse(article.dataset.reactionNames || '{}'));
    } catch {}
  });
});

// Emoji picker toggle
document.querySelectorAll('.emoji-picker-toggle').forEach(toggleBtn => {
  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const container = toggleBtn.closest('.relative');
    const picker = container.querySelector('.emoji-picker');
    if (!picker) return;

    // Close all other open pickers
    document.querySelectorAll('.emoji-picker').forEach(p => {
      if (p !== picker) p.classList.add('hidden');
    });
    picker.classList.toggle('hidden');
  });
});

// Emoji picker reaction buttons (inside the picker)
document.querySelectorAll('.emoji-picker .reaction-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const postId = btn.dataset.postId;
    const emoji = btn.dataset.emoji;
    // Close the picker
    const picker = btn.closest('.emoji-picker');
    if (picker) picker.classList.add('hidden');
    handleReactionClick(postId, emoji);
  });
});

// Close emoji pickers on outside click
document.addEventListener('click', () => {
  document.querySelectorAll('.emoji-picker').forEach(p => p.classList.add('hidden'));
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
      const data = await fetch('/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }).then(r => r.json());
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
        await fetch('/push/unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) });
        await sub.unsubscribe();
      }
      _showPushState('push-state-default');
    } catch (err) { console.error('Push disable error:', err); }
  }

  document.getElementById('push-enable-btn')?.addEventListener('click', _enablePush);
  document.getElementById('push-disable-btn')?.addEventListener('click', _disablePush);

  _initPushSection();
}
