/**
 * Where to send someone back to after a form on a post page: that post, if the Referer is one
 * of this site's own /post/ pages; otherwise the feed. Never a full URL from the header, so a
 * crafted Referer can't bounce the browser to another site.
 */
function backToPost(req, fallback = '/') {
  const ref = req.headers.referer;
  if (!ref) return fallback;
  try {
    const u = new URL(ref);
    if (u.host !== req.get('host') || !/^\/post\/\d+$/.test(u.pathname)) return fallback;
    return u.pathname + u.search;
  } catch {
    return fallback;
  }
}

module.exports = { backToPost };
