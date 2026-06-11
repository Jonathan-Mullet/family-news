/**
 * Pure date helpers shared by routes and cron.
 *
 * Why these exist:
 * - `new Date('2025-02-31')` silently rolls over to March 3, which then fails
 *   MySQL strict-mode DATE validation with an opaque error. `isValidBirthday`
 *   rejects impossible calendar dates up front.
 * - Scheduled-post times arrive from the browser as UTC ISO strings (the
 *   browser converts the user's datetime-local wall-clock; this UTC container
 *   cannot). `parsePublishAt` validates and parses them.
 */

const ONE_YEAR_MS = 366 * 24 * 60 * 60 * 1000;

/**
 * True if `y` is a leap year (Gregorian rules).
 * @param {number} y
 * @returns {boolean}
 */
function isLeapYear(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/**
 * Validates a YYYY-MM-DD birthday string: strict format AND a real calendar
 * date (rejects 2025-02-31 and 2025-02-29, which `new Date()` would roll over).
 * Does NOT check past/future — callers do that.
 *
 * @param {string} str
 * @returns {boolean}
 */
function isValidBirthday(str) {
  if (typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const [y, m, d] = str.split('-').map(Number);
  if (m < 1 || m > 12) return false;
  const daysInMonth = [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d >= 1 && d <= daysInMonth[m - 1];
}

/**
 * Parses a scheduled-publish timestamp (expected: UTC ISO string from the
 * client-side hidden field). Returns a Date, or null when the value is empty,
 * unparseable, or more than ~1 year in the future (fat-finger guard).
 *
 * @param {string} value - ISO timestamp string.
 * @param {{maxFutureMs?: number, now?: number}} [opts] - Injectable for tests.
 * @returns {Date|null}
 */
function parsePublishAt(value, { maxFutureMs = ONE_YEAR_MS, now = Date.now() } = {}) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const d = new Date(value.trim());
  if (Number.isNaN(d.getTime())) return null;
  if (d.getTime() - now > maxFutureMs) return null;
  return d;
}

/**
 * Formats a Date as a MySQL DATETIME literal in UTC ('YYYY-MM-DD HH:MM:SS').
 * Explicit UTC formatting avoids relying on the node process timezone.
 *
 * @param {Date} d
 * @returns {string}
 */
function toSqlUtc(d) {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

module.exports = { isValidBirthday, isLeapYear, parsePublishAt, toSqlUtc };
