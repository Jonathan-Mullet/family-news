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

  btn.addEventListener('click', async () => {
    hideTooltip();
    // Invalidate cache so next hover fetches fresh names
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
        countEl.textContent = data.count;
        countEl.classList.toggle('hidden', data.count === 0);
        b.classList.toggle('bg-brand-50', data.userReacted);
        b.classList.toggle('dark:bg-brand-600/20', data.userReacted);
        b.classList.toggle('border-brand-200', data.userReacted);
        b.classList.toggle('dark:border-brand-700', data.userReacted);
        b.classList.toggle('border-transparent', !data.userReacted);
      });
    } catch (e) { console.error(e); }
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
