const MAX_BYTES = 100 * 1024; // 100KB

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

    // Read up to MAX_BYTES
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
    console.error('OG fetch error:', err.message);
    return null;
  }
}

module.exports = { fetchOgPreview };
