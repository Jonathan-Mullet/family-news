/**
 * Blocks state-changing requests made by another site's page while the member is signed in here
 * (CSRF). The session cookie is SameSite=Lax, but the other *.jonathan-mullet.com apps count as the
 * same "site", so Lax alone would let a page on any of them POST here with the session.
 * Browsers label requests with Sec-Fetch-Site (iOS Safari 16.4+); older ones are judged by Origin.
 */
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

function isCrossSiteWrite(req) {
  if (SAFE.has(req.method)) return false;
  const site = req.get('sec-fetch-site');
  if (site) return site !== 'same-origin' && site !== 'none';
  const origin = req.get('origin');
  if (!origin || origin === 'null') return false;
  try {
    return new URL(origin).host !== req.get('host');
  } catch {
    return true;
  }
}

module.exports = { isCrossSiteWrite };
