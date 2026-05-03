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
  const postId = btn.dataset.postId;
  const emoji = btn.dataset.emoji;

  btn.addEventListener('mouseenter', async () => {
    const countEl = btn.querySelector('.reaction-count');
    if (countEl?.classList.contains('hidden')) return;
    const names = await fetchReactionNames(postId);
    const list = names[emoji];
    if (list?.length) showTooltip(list.join(', '), btn);
  });

  btn.addEventListener('mouseleave', hideTooltip);

  btn.addEventListener('click', () => handleReactionClick(postId, emoji));
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
