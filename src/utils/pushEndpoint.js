/**
 * Push subscriptions come from the browser, but the endpoint URL is just a field in a POST: without
 * a check, any member could store an address on the home network and make the server send to it
 * on every notification. Only https endpoints on the real push services are accepted.
 */
const PUSH_HOSTS = [/^web\.push\.apple\.com$/, /^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^[a-z0-9-]+\.notify\.windows\.com$/];

function isPushEndpoint(value) {
  if (typeof value !== 'string' || value.length > 1000) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

module.exports = { isPushEndpoint };
