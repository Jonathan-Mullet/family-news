/**
 * Fetches Open Graph metadata from URLs found in post content.
 *
 * Returns a plain object with `url`, `og_title`, `og_description`, and
 * `og_image` on success, or `null` on any failure (network error, timeout,
 * missing OG tags, blocked target, etc.). Callers should always handle the
 * null case.
 *
 * Hardening (defense-in-depth for a fetcher that takes user-supplied URLs):
 * - Only http/https URLs are fetched.
 * - The hostname is resolved first and the fetch is refused when ANY resolved
 *   address is private, loopback, or link-local (SSRF guard). Note: this is a
 *   resolve-then-fetch check, so a malicious DNS server could in theory swap
 *   answers between the check and the fetch (rebinding); pinning the resolved
 *   IP would require a custom dispatcher and isn't worth it here.
 * - Redirects are followed manually (max 3 hops) and every hop's Location is
 *   re-validated the same way.
 * - One abort deadline covers headers AND the body read, so a slow body can't
 *   stream forever after headers arrive.
 * - Bodies are only parsed when Content-Type starts with text/html, and only
 *   the first 100 KB is read (OG tags nearly always live in <head>).
 * - og_image is only returned when it is an absolute http(s) URL whose host is
 *   not a literal IP address.
 */

const dns = require('node:dns').promises;
const net = require('node:net');

const MAX_BYTES = 100 * 1024; // 100KB
const MAX_REDIRECTS = 3;
const FETCH_DEADLINE_MS = 8000; // covers all redirect hops + the body read
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

// ── Address / host validation ─────────────────────────────────────────────────

/**
 * True when `ip` is a private, loopback, link-local, or otherwise non-public
 * address that an outbound fetcher must never talk to. Fails CLOSED: anything
 * that isn't a recognizable public IP literal returns true.
 *
 * Covered: 10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, 0/8,
 * ::1, :: (unspecified), fc00::/7 (ULA), fe80::/10 (link-local),
 * and IPv4-mapped IPv6 forms of all of the above.
 *
 * @param {string} ip - An IP address literal (no brackets).
 * @returns {boolean}
 */
function isPrivateAddress(ip) {
  if (typeof ip !== 'string' || !ip.trim()) return true; // fail closed
  let addr = ip.trim().toLowerCase();
  const zone = addr.indexOf('%'); // strip zone index (fe80::1%eth0)
  if (zone !== -1) addr = addr.slice(0, zone);

  if (net.isIPv4(addr)) {
    const [a, b] = addr.split('.').map(Number);
    if (a === 0) return true; // 0.0.0.0/8 ("this network" — routes to localhost on Linux)
    if (a === 10) return true; // 10/8
    if (a === 127) return true; // 127/8 loopback
    if (a === 169 && b === 254) return true; // 169.254/16 link-local
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
    if (a === 192 && b === 168) return true; // 192.168/16
    return false;
  }

  if (net.isIPv6(addr)) {
    if (addr === '::' || addr === '::1') return true; // unspecified / loopback
    // IPv4-mapped, dotted form (::ffff:10.0.0.1) → check the embedded IPv4
    const mappedDotted = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mappedDotted) return isPrivateAddress(mappedDotted[1]);
    // IPv4-mapped, hex form (::ffff:a00:1 == ::ffff:10.0.0.1)
    const mappedHex = addr.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
      const hi = parseInt(mappedHex[1], 16);
      const lo = parseInt(mappedHex[2], 16);
      return isPrivateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    const firstGroup = addr.startsWith('::') ? 0 : parseInt(addr.split(':')[0], 16);
    if (Number.isNaN(firstGroup)) return true; // fail closed
    if (firstGroup >= 0xfc00 && firstGroup <= 0xfdff) return true; // fc00::/7 ULA
    if (firstGroup >= 0xfe80 && firstGroup <= 0xfebf) return true; // fe80::/10 link-local
    return false;
  }

  return true; // not an IP literal at all → fail closed
}

/**
 * Resolves a URL's hostname and returns true only when every resolved address
 * is public. Literal-IP hosts are checked directly without a DNS round trip.
 *
 * @param {URL} u
 * @returns {Promise<boolean>}
 */
async function hostIsPublic(u) {
  const host = u.hostname.replace(/^\[|\]$/g, ''); // URL keeps IPv6 hosts bracketed
  if (net.isIP(host)) return !isPrivateAddress(host);
  let addrs;
  try {
    addrs = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    return false; // unresolvable → don't fetch
  }
  return addrs.length > 0 && addrs.every(a => !isPrivateAddress(a.address));
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Fetches and parses Open Graph meta tags from the given URL.
 * Uses a streaming read with an early abort to cap memory usage and latency.
 *
 * @param {string} url - The URL to fetch OG data from.
 * @returns {Promise<{url: string, og_title: string|null, og_description: string|null, og_image: string|null} | null>}
 *   Parsed OG data, or null if the fetch failed, was blocked, or no OG tags
 *   were found.
 */
async function fetchOgPreview(url) {
  const controller = new AbortController();
  // One deadline for the whole operation. The previous version cleared its
  // timer as soon as headers arrived, which let a slow body stream forever.
  const timer = setTimeout(() => controller.abort(), FETCH_DEADLINE_MS);
  try {
    let current = url;
    let res = null;
    let hops = 0;

    // Manual redirect loop: every hop (including the first request) gets the
    // same scheme + private-address validation, so a public page can't bounce
    // us into the LAN via a 302.
    while (true) {
      const u = new URL(current);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      if (!(await hostIsPublic(u))) return null;

      const r = await fetch(u.href, {
        signal: controller.signal,
        redirect: 'manual',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; FamilyNewsBot/1.0)',
          'Accept': 'text/html',
        },
      });

      if (REDIRECT_STATUSES.has(r.status)) {
        const loc = r.headers.get('location');
        r.body?.cancel().catch(() => {});
        if (!loc || ++hops > MAX_REDIRECTS) return null;
        current = new URL(loc, u).href; // re-validated at the top of the loop
        continue;
      }
      res = r;
      break;
    }

    if (!res.ok) return null;

    // Only HTML is worth parsing for OG tags; bail (and close the connection)
    // for images, PDFs, JSON APIs, etc.
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (!contentType.startsWith('text/html')) {
      res.body?.cancel().catch(() => {});
      return null;
    }

    // ── Streaming read with byte cap ──────────────────────────────────────────
    // We stream the body instead of calling res.text() so we can stop reading
    // as soon as we've accumulated MAX_BYTES. This avoids buffering multi-MB
    // pages (e.g. pages that embed large inline scripts) into memory.
    // reader.cancel() signals the server to close the connection early. The
    // abort deadline above is still armed here, so a trickling body gets cut
    // off when the timer fires.
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
    // og_image gets rendered as an <img src> for every family member, so it
    // must be an absolute http(s) URL and must not point at a literal IP
    // (e.g. an internal service that happens to answer on the LAN).
    let og_image = getMeta('og:image');
    if (og_image) {
      try {
        if (!/^https?:\/\//i.test(og_image) || net.isIP(new URL(og_image).hostname.replace(/^\[|\]$/g, ''))) {
          og_image = null;
        }
      } catch { og_image = null; }
    }

    if (!og_title && !og_description && !og_image) return null;

    return { url, og_title, og_description, og_image };
  } catch (err) {
    // Any error (network failure, timeout abort, parse error) returns null
    // so the caller can silently skip the preview without crashing the post.
    console.error('OG fetch error:', err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { fetchOgPreview, isPrivateAddress };
