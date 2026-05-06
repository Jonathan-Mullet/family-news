const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractVideoEmbed } = require('./videoEmbed');

// ── null / empty ──────────────────────────────────────────────────────────────

test('returns null for null input', () => {
  assert.equal(extractVideoEmbed(null), null);
});

test('returns null for empty string', () => {
  assert.equal(extractVideoEmbed(''), null);
});

test('returns null for plain text with no URL', () => {
  assert.equal(extractVideoEmbed('Hello family!'), null);
});

test('returns null for non-video URL', () => {
  assert.equal(extractVideoEmbed('Check this out https://example.com/page'), null);
});

// ── YouTube ───────────────────────────────────────────────────────────────────

test('detects youtube.com/watch?v=', () => {
  assert.equal(
    extractVideoEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
    'https://www.youtube.com/embed/dQw4w9WgXcQ'
  );
});

test('detects youtu.be short URL', () => {
  assert.equal(
    extractVideoEmbed('https://youtu.be/dQw4w9WgXcQ'),
    'https://www.youtube.com/embed/dQw4w9WgXcQ'
  );
});

test('detects youtube.com/shorts/', () => {
  assert.equal(
    extractVideoEmbed('https://www.youtube.com/shorts/dQw4w9WgXcQ'),
    'https://www.youtube.com/embed/dQw4w9WgXcQ'
  );
});

test('detects m.youtube.com/watch?v=', () => {
  assert.equal(
    extractVideoEmbed('https://m.youtube.com/watch?v=dQw4w9WgXcQ'),
    'https://www.youtube.com/embed/dQw4w9WgXcQ'
  );
});

test('detects YouTube URL embedded mid-sentence', () => {
  assert.equal(
    extractVideoEmbed('Check this out https://youtu.be/dQw4w9WgXcQ it is amazing!'),
    'https://www.youtube.com/embed/dQw4w9WgXcQ'
  );
});

test('handles YouTube URL with extra query params before v=', () => {
  assert.equal(
    extractVideoEmbed('https://www.youtube.com/watch?list=PLxxx&v=dQw4w9WgXcQ'),
    'https://www.youtube.com/embed/dQw4w9WgXcQ'
  );
});

// ── Vimeo ─────────────────────────────────────────────────────────────────────

test('detects vimeo.com/ID', () => {
  assert.equal(
    extractVideoEmbed('https://vimeo.com/123456789'),
    'https://player.vimeo.com/video/123456789'
  );
});

test('does not match vimeo channel/group paths', () => {
  assert.equal(extractVideoEmbed('https://vimeo.com/channels/staffpicks'), null);
});

// ── Priority ──────────────────────────────────────────────────────────────────

test('YouTube takes priority when both YouTube and Vimeo present', () => {
  assert.equal(
    extractVideoEmbed('https://youtu.be/dQw4w9WgXcQ and https://vimeo.com/123456789'),
    'https://www.youtube.com/embed/dQw4w9WgXcQ'
  );
});
