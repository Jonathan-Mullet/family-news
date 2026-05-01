const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { sendNewPostNotification } = require('../email');
const { handleUpload, deleteUploadedFile } = require('./upload');
const { fetchOgPreview } = require('../utils/ogFetch');

const MAX_CONTENT = 2000;

router.get('/api/feed-state', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const [[latest]] = await pool.query(
      'SELECT id FROM posts WHERE publish_at IS NULL OR publish_at <= NOW() OR user_id = ? ORDER BY created_at DESC LIMIT 1',
      [userId]
    );
    const [[{ total }]] = await pool.query(
      'SELECT COUNT(*) AS total FROM posts WHERE publish_at IS NULL OR publish_at <= NOW() OR user_id = ?',
      [userId]
    );
    res.json({ latestId: latest?.id || 0, total });
  } catch { res.json({ latestId: 0, total: 0 }); }
});

router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const [posts] = await pool.query(`
      SELECT p.*, u.name AS author_name,
        (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count,
        lp.og_title, lp.og_description, lp.og_image, lp.url AS preview_url
      FROM posts p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN link_previews lp ON lp.post_id = p.id
      WHERE p.publish_at IS NULL OR p.publish_at <= NOW() OR p.user_id = ?
      ORDER BY p.pinned DESC, p.created_at DESC
    `, [userId]);

    let reactionsByPost = {};
    if (posts.length) {
      const ids = posts.map(p => p.id);
      const [reactions] = await pool.query(`
        SELECT post_id, emoji, COUNT(*) AS count,
          MAX(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS user_reacted
        FROM reactions WHERE post_id IN (?)
        GROUP BY post_id, emoji
      `, [userId, ids]);
      reactions.forEach(r => {
        if (!reactionsByPost[r.post_id]) reactionsByPost[r.post_id] = {};
        reactionsByPost[r.post_id][r.emoji] = { count: r.count, userReacted: r.user_reacted === 1 };
      });

      // Fetch read counts per post
      const [readRows] = await pool.query(
        'SELECT post_id, COUNT(*) AS read_count FROM post_reads WHERE post_id IN (?) GROUP BY post_id',
        [ids]
      );
      const readMap = {};
      readRows.forEach(r => { readMap[r.post_id] = r.read_count; });
      posts.forEach(p => { p.read_count = readMap[p.id] || 0; });
    }

    res.render('feed', { posts, reactionsByPost });
  } catch (err) {
    console.error(err);
    res.render('error', { message: 'Could not load posts.' });
  }
});

router.get('/post/:id', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const [posts] = await pool.query(
      `SELECT p.*, u.name AS author_name,
        lp.og_title, lp.og_description, lp.og_image, lp.url AS preview_url
       FROM posts p
       JOIN users u ON p.user_id = u.id
       LEFT JOIN link_previews lp ON lp.post_id = p.id
       WHERE p.id = ?`,
      [req.params.id]
    );
    if (!posts.length) return res.render('error', { message: 'Post not found.' });
    const post = posts[0];

    // Record read
    await pool.query(
      'INSERT INTO post_reads (post_id, user_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE read_at = NOW()',
      [post.id, userId]
    );

    // Fetch read count
    const [[{ cnt }]] = await pool.query(
      'SELECT COUNT(*) AS cnt FROM post_reads WHERE post_id = ?',
      [post.id]
    );
    post.readCount = cnt;

    const [reactions] = await pool.query(`
      SELECT emoji, COUNT(*) AS count,
        MAX(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS user_reacted
      FROM reactions WHERE post_id = ? GROUP BY emoji
    `, [userId, post.id]);
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

router.post('/posts', requireAuth, handleUpload, async (req, res) => {
  const { title, content, publish_at } = req.body;
  if (!content?.trim()) { req.flash('error', 'Post content is required.'); return res.redirect('/'); }
  if (content.trim().length > MAX_CONTENT) { req.flash('error', `Post cannot exceed ${MAX_CONTENT} characters.`); return res.redirect('/'); }

  // Resolve photo_url: prefer file upload, then fall back to none (URL input removed)
  const photo_url = req.uploadedPath || null;

  // Parse publish_at
  let publishAt = null;
  if (publish_at && publish_at.trim()) {
    const parsed = new Date(publish_at.trim());
    if (!isNaN(parsed.getTime())) {
      // Convert to MySQL datetime string
      publishAt = parsed.toISOString().slice(0, 19).replace('T', ' ');
    }
  }

  try {
    const [result] = await pool.query(
      'INSERT INTO posts (user_id, title, content, photo_url, publish_at) VALUES (?, ?, ?, ?, ?)',
      [req.session.user.id, title?.trim() || null, content.trim(), photo_url, publishAt]
    );
    const postId = result.insertId;

    // Fetch users with notification preferences for new post notifications
    const [users] = await pool.query('SELECT id, email, notify_posts FROM users WHERE active = 1');
    sendNewPostNotification(users, req.session.user, {
      id: postId,
      title: title?.trim() || null,
      content: content.trim(),
    });

    // Background: fetch OG preview from first URL in content
    const urlMatch = content.match(/(https?:\/\/[^\s]+)/);
    if (urlMatch) {
      (async () => {
        try {
          const preview = await fetchOgPreview(urlMatch[1]);
          if (preview) {
            await pool.query(
              'INSERT INTO link_previews (post_id, url, og_title, og_description, og_image) VALUES (?, ?, ?, ?, ?)',
              [postId, preview.url, preview.og_title, preview.og_description, preview.og_image]
            );
          }
        } catch (e) {
          console.error('Link preview error:', e.message);
        }
      })();
    }

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
    const [rows] = await pool.query('SELECT user_id, photo_url FROM posts WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.redirect('/');
    if (rows[0].user_id !== req.session.user.id && req.session.user.role !== 'admin') return res.status(403).end();
    // Delete uploaded file if present
    if (rows[0].photo_url) deleteUploadedFile(rows[0].photo_url);
    await pool.query('DELETE FROM posts WHERE id = ?', [req.params.id]);
    res.redirect('/');
  } catch (err) { console.error(err); res.redirect('/'); }
});

module.exports = router;
