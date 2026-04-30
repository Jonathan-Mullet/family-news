const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { sendNewPostNotification } = require('../email');

const MAX_CONTENT = 2000;

router.get('/api/feed-state', requireAuth, async (req, res) => {
  try {
    const [[latest]] = await pool.query('SELECT id FROM posts ORDER BY created_at DESC LIMIT 1');
    const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM posts');
    res.json({ latestId: latest?.id || 0, total });
  } catch { res.json({ latestId: 0, total: 0 }); }
});

router.get('/', requireAuth, async (req, res) => {
  try {
    const [posts] = await pool.query(`
      SELECT p.*, u.name AS author_name,
        (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count
      FROM posts p JOIN users u ON p.user_id = u.id
      ORDER BY p.pinned DESC, p.created_at DESC
    `);

    let reactionsByPost = {};
    if (posts.length) {
      const ids = posts.map(p => p.id);
      const [reactions] = await pool.query(`
        SELECT post_id, emoji, COUNT(*) AS count,
          MAX(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS user_reacted
        FROM reactions WHERE post_id IN (?)
        GROUP BY post_id, emoji
      `, [req.session.user.id, ids]);
      reactions.forEach(r => {
        if (!reactionsByPost[r.post_id]) reactionsByPost[r.post_id] = {};
        reactionsByPost[r.post_id][r.emoji] = { count: r.count, userReacted: r.user_reacted === 1 };
      });
    }

    res.render('feed', { posts, reactionsByPost });
  } catch (err) {
    console.error(err);
    res.render('error', { message: 'Could not load posts.' });
  }
});

router.get('/post/:id', requireAuth, async (req, res) => {
  try {
    const [posts] = await pool.query(
      'SELECT p.*, u.name AS author_name FROM posts p JOIN users u ON p.user_id = u.id WHERE p.id = ?',
      [req.params.id]
    );
    if (!posts.length) return res.render('error', { message: 'Post not found.' });
    const post = posts[0];

    const [reactions] = await pool.query(`
      SELECT emoji, COUNT(*) AS count,
        MAX(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS user_reacted
      FROM reactions WHERE post_id = ? GROUP BY emoji
    `, [req.session.user.id, post.id]);
    const reactionMap = {};
    reactions.forEach(r => { reactionMap[r.emoji] = { count: r.count, userReacted: r.user_reacted === 1 }; });

    const [comments] = await pool.query(`
      SELECT c.*, u.name AS author_name FROM comments c
      JOIN users u ON c.user_id = u.id
      WHERE c.post_id = ? ORDER BY c.created_at ASC
    `, [post.id]);
    const topLevel = comments.filter(c => !c.parent_id);
    topLevel.forEach(c => { c.replies = comments.filter(r => r.parent_id === c.id); });

    res.render('post', { post, reactions: reactionMap, comments: topLevel });
  } catch (err) {
    console.error(err);
    res.render('error', { message: 'Could not load post.' });
  }
});

router.post('/posts', requireAuth, async (req, res) => {
  const { title, content, photo_url } = req.body;
  if (!content?.trim()) { req.flash('error', 'Post content is required.'); return res.redirect('/'); }
  if (content.trim().length > MAX_CONTENT) { req.flash('error', `Post cannot exceed ${MAX_CONTENT} characters.`); return res.redirect('/'); }
  try {
    const [result] = await pool.query(
      'INSERT INTO posts (user_id, title, content, photo_url) VALUES (?, ?, ?, ?)',
      [req.session.user.id, title?.trim() || null, content.trim(), photo_url?.trim() || null]
    );
    const [users] = await pool.query('SELECT id, email FROM users WHERE active = 1');
    sendNewPostNotification(users, req.session.user, {
      id: result.insertId,
      title: title?.trim() || null,
      content: content.trim(),
    });
    res.redirect('/');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not create post.');
    res.redirect('/');
  }
});

router.post('/posts/:id/edit', requireAuth, async (req, res) => {
  const { content, title } = req.body;
  if (!content?.trim()) return res.redirect('/');
  if (content.trim().length > MAX_CONTENT) {
    req.flash('error', `Post cannot exceed ${MAX_CONTENT} characters.`);
    return res.redirect('/');
  }
  try {
    const [rows] = await pool.query('SELECT user_id FROM posts WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.redirect('/');
    if (rows[0].user_id !== req.session.user.id && req.session.user.role !== 'admin') return res.status(403).end();
    await pool.query(
      'UPDATE posts SET content = ?, title = ?, edited_at = NOW() WHERE id = ?',
      [content.trim(), title?.trim() || null, req.params.id]
    );
    const ref = req.headers.referer || '/';
    res.redirect(ref.includes('/post/') ? ref : '/');
  } catch (err) { console.error(err); res.redirect('/'); }
});

router.post('/posts/:id/pin', requireAuth, async (req, res) => {
  if (req.session.user.role !== 'admin') return res.status(403).end();
  try {
    await pool.query('UPDATE posts SET pinned = NOT pinned WHERE id = ?', [req.params.id]);
  } catch (err) { console.error(err); }
  const ref = req.headers.referer || '/';
  res.redirect(ref.includes('/post/') ? ref : '/');
});

router.post('/posts/:id/delete', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT user_id FROM posts WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.redirect('/');
    if (rows[0].user_id !== req.session.user.id && req.session.user.role !== 'admin') return res.status(403).end();
    await pool.query('DELETE FROM posts WHERE id = ?', [req.params.id]);
    res.redirect('/');
  } catch (err) { console.error(err); res.redirect('/'); }
});

module.exports = router;
