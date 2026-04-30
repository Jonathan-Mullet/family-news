document.querySelectorAll('.reaction-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const postId = btn.dataset.postId;
    const emoji = btn.dataset.emoji;
    try {
      const res = await fetch(`/posts/${postId}/react`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emoji }),
      });
      const data = await res.json();

      // Update all buttons for this emoji on this post
      document.querySelectorAll(`.reaction-btn[data-post-id="${postId}"][data-emoji="${emoji}"]`).forEach(b => {
        const countEl = b.querySelector('.reaction-count');
        countEl.textContent = data.count;
        countEl.classList.toggle('hidden', data.count === 0);
        b.classList.toggle('bg-brand-50', data.userReacted);
        b.classList.toggle('border-brand-200', data.userReacted);
        b.classList.toggle('border-transparent', !data.userReacted);
      });
    } catch (e) { console.error(e); }
  });
});
