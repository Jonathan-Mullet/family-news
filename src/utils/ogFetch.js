/**
 * Fetches Open Graph metadata from URLs found in post content.
 *
 * Returns a plain object with `url`, `og_title`, `og_description`, and
 * `og_image` on success, or `null` on any failure (network error, timeout,
 * missing OG tags, etc.). Callers should always handle the null case.
 *
 * The fetch is intentionally limited to the first 100 KB of the response and
 * aborts after 5 seconds to prevent slow or huge pages from blocking the
 * Node.js event loop. OG tags nearly always appear in the <head>, so 100 KB
 * is sufficient for the overwhelming majority of pages.
 */

const MAX_BYTES = 100 * 1024; // 100KB

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Fetches and parses Open Graph meta tags from the given URL.
 * Uses a streaming read with an early abort to cap memory usage and latency.
 *
 * @param {string} url - The URL to fetch OG data from.
 * @returns {Promise<{url: string, og_title: string|null, og_description: string|null, og_image: string|null} | null>}
 *   Parsed OG data, or null if the fetch failed or no OG tags were found.
 */
async function fetchOgPreview(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; FamilyNewsBot/1.0)',
        'Accept': 'text/html',
      },
    });
    clearTimeout(timer);

    if (!res.ok) return null;

    // ── Streaming read with byte cap ──────────────────────────────────────────
    // We stream the body instead of calling res.text() so we can stop reading
    // as soon as we've accumulated MAX_BYTES. This avoids buffering multi-MB
    // pages (e.g. pages that embed large inline scripts) into memory.
    // reader.cancel() signals the server to close the connection early.
    const reader = res.body.getReader();
    const chunks = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      totalBytes += value.length;
      if (totalBytes >= MAX_BYTES) {
        reader.cancel();
        break;
      }
    }

    const html = Buffer.concat(chunks.map(c => Buffer.from(c))).toString('utf-8');

    function getMeta(property) {
      // Try og: property first, then name
      const patterns = [
        new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i'),
        new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`, 'i'),
      ];
      for (const re of patterns) {
        const m = html.match(re);
        if (m) return m[1].trim();
      }
      return null;
    }

    const og_title = getMeta('og:title');
    const og_description = getMeta('og:description');
    const og_image = getMeta('og:image');

    if (!og_title && !og_description && !og_image) return null;

    return { url, og_title, og_description, og_image };
  } catch (err) {
    // Any error (network failure, timeout abort, parse error) returns null
    // so the caller can silently skip the preview without crashing the post.
    console.error('OG fetch error:', err.message);
    return null;
  }
}

module.exports = { fetchOgPreview };
