// Search posts by keyword using MySQL FULLTEXT natural language mode.
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const MIN_QUERY_LEN = 3; // MySQL FULLTEXT default min token size is 3

// Returns an HTML-safe snippet of `content` with the first occurrence of
// `query` wrapped in <mark> tags. Strips @[Name](id) mention tokens first.
function buildSnippet(content, query) {
  const plain = content.replace(/@\[([^\]]+)\]\(\d+\)/g, '$1');
  const lower = plain.toLowerCase();
  const term = query.trim().toLowerCase();
  const idx = lower.indexOf(term);

  let start = 0;
  let end = Math.min(150, plain.length);
  if (idx !== -1) {
    start = Math.max(0, idx - 60);
    end = Math.min(plain.length, idx + term.length + 90);
    if (start > 0) {
      const ws = plain.indexOf(' ', start);
      if (ws !== -1 && ws < idx) start = ws + 1;
    }
    if (end < plain.length) {
      const ws = plain.lastIndexOf(' ', end);
      if (ws > idx + term.length) end = ws;
    }
  }

  const prefix = start > 0 ? '…' : '';
  const suffix = end < plain.length ? '…' : '';
  let snippet = plain.slice(start, end)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  snippet = snippet.replace(new RegExp(escaped, 'gi'), '<mark>$&</mark>');

  return prefix + snippet + suffix;
}

router.get('/', requireAuth, async (req, res) => {
  const q = (req.query.q || '').trim();

  const wantJson = req.query.format === 'json';

  if (q.length < MIN_QUERY_LEN) {
    if (wantJson) return res.json({ query: q, results: [], error: null });
    return res.render('search', { query: q, results: null, error: null });
  }

  try {
    const userId = req.session.user.id;
    const [rows] = await pool.query(`
      SELECT p.id, p.title, p.content, p.created_at, p.user_id,
             u.name AS author_name, u.avatar_url AS author_avatar,
             MATCH(p.title, p.content) AGAINST(? IN NATURAL LANGUAGE MODE) AS score
      FROM posts p
      JOIN users u ON p.user_id = u.id
      WHERE p.deleted_at IS NULL
        AND (p.publish_at IS NULL OR p.publish_at <= NOW() OR p.user_id = ?)
        AND MATCH(p.title, p.content) AGAINST(? IN NATURAL LANGUAGE MODE)
      ORDER BY score DESC
      LIMIT 50
    `, [q, userId, q]);

    const results = rows.map(r => ({
      ...r,
      snippet: buildSnippet(r.content, q),
    }));

    if (wantJson) return res.json({ query: q, results, error: null });
    res.render('search', { query: q, results, error: null });
  } catch (err) {
    console.error('Search error:', err);
    if (wantJson) return res.json({ query: q, results: [], error: 'Search is temporarily unavailable.' });
    res.render('search', { query: q, results: null, error: 'Search is temporarily unavailable.' });
  }
});

module.exports = router;
