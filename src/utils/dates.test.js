const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isValidBirthday, isLeapYear, parsePublishAt, toSqlUtc } = require('./dates');

// ── isLeapYear ────────────────────────────────────────────────────────────────

test('isLeapYear: standard leap and non-leap years', () => {
  assert.equal(isLeapYear(2024), true);
  assert.equal(isLeapYear(2025), false);
  assert.equal(isLeapYear(2000), true); // divisible by 400
  assert.equal(isLeapYear(1900), false); // divisible by 100 but not 400
});

// ── isValidBirthday ───────────────────────────────────────────────────────────

test('isValidBirthday: accepts real dates', () => {
  assert.equal(isValidBirthday('1985-07-04'), true);
  assert.equal(isValidBirthday('2024-02-29'), true); // leap day in a leap year
  assert.equal(isValidBirthday('2025-12-31'), true);
  assert.equal(isValidBirthday('2025-01-01'), true);
});

test('isValidBirthday: rejects impossible calendar dates (JS Date would roll them over)', () => {
  assert.equal(isValidBirthday('2025-02-31'), false);
  assert.equal(isValidBirthday('2025-02-29'), false); // not a leap year
  assert.equal(isValidBirthday('1900-02-29'), false); // century non-leap
  assert.equal(isValidBirthday('2025-04-31'), false); // April has 30 days
  assert.equal(isValidBirthday('2025-00-10'), false);
  assert.equal(isValidBirthday('2025-13-01'), false);
  assert.equal(isValidBirthday('2025-06-00'), false);
  assert.equal(isValidBirthday('2025-06-32'), false);
});

test('isValidBirthday: rejects malformed input', () => {
  assert.equal(isValidBirthday('2025-6-01'), false); // unpadded month
  assert.equal(isValidBirthday('2025-06-1'), false); // unpadded day
  assert.equal(isValidBirthday('06/01/2025'), false);
  assert.equal(isValidBirthday('2025-06-01T00:00'), false);
  assert.equal(isValidBirthday(''), false);
  assert.equal(isValidBirthday(null), false);
  assert.equal(isValidBirthday(undefined), false);
  assert.equal(isValidBirthday(20250601), false);
});

// ── parsePublishAt ────────────────────────────────────────────────────────────

const NOW = Date.UTC(2026, 5, 11, 12, 0, 0); // 2026-06-11T12:00:00Z

test('parsePublishAt: parses a UTC ISO string', () => {
  const d = parsePublishAt('2026-06-12T22:00:00.000Z', { now: NOW });
  assert.ok(d instanceof Date);
  assert.equal(d.toISOString(), '2026-06-12T22:00:00.000Z');
});

test('parsePublishAt: trims surrounding whitespace', () => {
  const d = parsePublishAt('  2026-06-12T22:00:00.000Z  ', { now: NOW });
  assert.equal(d.toISOString(), '2026-06-12T22:00:00.000Z');
});

test('parsePublishAt: rejects empty / missing / non-string values', () => {
  assert.equal(parsePublishAt('', { now: NOW }), null);
  assert.equal(parsePublishAt('   ', { now: NOW }), null);
  assert.equal(parsePublishAt(null, { now: NOW }), null);
  assert.equal(parsePublishAt(undefined, { now: NOW }), null);
  assert.equal(parsePublishAt(1234567890, { now: NOW }), null);
});

test('parsePublishAt: rejects unparseable strings', () => {
  assert.equal(parsePublishAt('not a date', { now: NOW }), null);
  assert.equal(parsePublishAt('2026-13-40T99:99Z', { now: NOW }), null);
});

test('parsePublishAt: rejects more than ~1 year out, accepts just inside', () => {
  assert.equal(parsePublishAt('2027-06-13T12:00:01.000Z', { now: NOW }), null); // > 366 days
  const ok = parsePublishAt('2027-06-10T12:00:00.000Z', { now: NOW });
  assert.ok(ok instanceof Date);
});

test('parsePublishAt: past dates are allowed (post just publishes immediately)', () => {
  const d = parsePublishAt('2026-06-10T12:00:00.000Z', { now: NOW });
  assert.ok(d instanceof Date);
});

// ── toSqlUtc ──────────────────────────────────────────────────────────────────

test('toSqlUtc: formats as UTC MySQL DATETIME', () => {
  assert.equal(toSqlUtc(new Date('2026-06-12T22:05:09.123Z')), '2026-06-12 22:05:09');
});
