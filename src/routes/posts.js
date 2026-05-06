// Post CRUD, feed/detail views, feed-state polling API, and pin/big-news/delete actions.
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { sendNewPostNotification, sendBigNewsNotification, sendMentionNotification } = require('../email');
const { sendPushToAllUsers, sendPushToUser } = require('../push');
const { handleMultiUpload, deleteUploadedFile } = require('./upload');
const { fetchOgPreview } = require('../utils/ogFetch');
const { enrichPosts } = require('../utils/feedData');
const { resolveMentions } = require('../utils/mentions');

const MAX_CONTENT = 2000;
// Posts older than BIG_NEWS_DAYS are shown in the archived big-news section rather than the active banner.
const BIG_NEWS_DAYS = 14;

// Lightweight polling endpoint so the client can detect new posts without a full page reload.
router.get('/api/feed-state', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const [[latest]] = await pool.query(
      'SELECT id FROM posts WHERE (publish_at IS NULL OR publish_at <= NOW() OR user_id = ?) AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1',
      [userId]
    );
    const [[{ total }]] = await pool.query(
      'SELECT COUNT(*) AS total FROM posts WHERE (publish_at IS NULL OR publish_at <= NOW() OR user_id = ?) AND deleted_at IS NULL',
      [userId]
    );
    res.json({ latestId: latest?.id || 0, total });
  } catch { res.json({ latestId: 0, total: 0 }); }
});

// Render the main feed; posts are split three ways: active big news (< 14 days old), archived big news (>= 14 days old),
// and regular posts sorted pin-first then by recency.
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const [allPosts] = await pool.query(`
      SELECT p.*, u.name AS author_name, u.avatar_url AS author_avatar,
        (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count,
        lp.og_title, lp.og_description, lp.og_image, lp.url AS preview_url
      FROM posts p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN link_previews lp ON lp.post_id = p.id
      WHERE (p.publish_at IS NULL OR p.publish_at <= NOW() OR p.user_id = ?) AND p.deleted_at IS NULL
      ORDER BY p.created_at DESC
    `, [userId]);

    const cutoffMs = BIG_NEWS_DAYS * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const bigNewsPosts = allPosts.filter(p => p.big_news && (now - new Date(p.created_at).getTime()) < cutoffMs);
    const archivedBigNews = allPosts.filter(p => p.big_news && (now - new Date(p.created_at).getTime()) >= cutoffMs);
    // Pinned posts rise to the top; within each group, newest first.
    const regularPosts = allPosts
      .filter(p => !p.big_news)
      .sort((a, b) => (b.pinned - a.pinned) || (new Date(b.created_at) - new Date(a.created_at)));

    const { reactionsByPost, reactionNames, latestCommentByPost } = await enrichPosts(allPosts, userId);

    // Feed also shows how many members have read each post (not needed on member pages)
    if (allPosts.length) {
      const ids = allPosts.map(p => p.id);
      const [readRows] = await pool.query(
        'SELECT post_id, COUNT(*) AS read_count FROM post_reads WHERE post_id IN (?) GROUP BY post_id',
        [ids]
      );
      const readMap = {};
      readRows.forEach(r => { readMap[r.post_id] = r.read_count; });
      allPosts.forEach(p => { p.read_count = readMap[p.id] || 0; });
    }

    const latestPostId = allPosts[0]?.id || 0;
    res.render('feed', { bigNewsPosts, regularPosts, archivedBigNews, reactionsByPost, reactionNames, latestCommentByPost, latestPostId });
  } catch (err) {
    console.error(err);
    res.render('error', { message: 'Could not load posts.' });
  }
});

// Show a single post with its full comment thread and reactions; marks the post as read for the current user.
router.get('/post/:id', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const [posts] = await pool.query(
      `SELECT p.*, u.name AS author_name, u.avatar_url AS author_avatar,
        lp.og_title, lp.og_description, lp.og_image, lp.url AS preview_url
       FROM posts p
       JOIN users u ON p.user_id = u.id
       LEFT JOIN link_previews lp ON lp.post_id = p.id
       WHERE p.id = ? AND p.deleted_at IS NULL`,
      [req.params.id]
    );
    if (!posts.length) return res.render('error', { message: 'Post not found.' });
    const post = posts[0];

    const [postPhotoRows] = await pool.query(
      'SELECT photo_url FROM post_photos WHERE post_id = ? ORDER BY sort_order',
      [post.id]
    );
    post.photos = postPhotoRows.map(p => p.photo_url);

    await pool.query(
      'INSERT INTO post_reads (post_id, user_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE read_at = NOW()',
      [post.id, userId]
    );

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

    const [reactionNameRows] = await pool.query(`
      SELECT r.emoji, u.name
      FROM reactions r JOIN users u ON r.user_id = u.id
      WHERE r.post_id = ?
      ORDER BY r.emoji, u.name
    `, [post.id]);
    const reactionNames = {};
    reactionNameRows.forEach(r => {
      if (!reactionNames[r.emoji]) reactionNames[r.emoji] = [];
      reactionNames[r.emoji].push(r.name);
    });

    const [comments] = await pool.query(`
      SELECT c.*, u.name AS author_name, u.avatar_url AS author_avatar FROM comments c
      JOIN users u ON c.user_id = u.id
      WHERE c.post_id = ? AND c.deleted_at IS NULL ORDER BY c.created_at ASC
    `, [post.id]);
    const topLevel = comments.filter(c => !c.parent_id);
    topLevel.forEach(c => { c.replies = comments.filter(r => r.parent_id === c.id); });

    res.render('post', { post, reactions: reactionMap, comments: topLevel, reactionNames });
  } catch (err) {
    console.error(err);
    res.render('error', { message: 'Could not load post.' });
  }
});

// Create a new post with optional photo gallery and send email + push notifications to all members.
// The link-preview fetch is fire-and-forget (async IIFE) so it never blocks the redirect response.
router.post('/posts', requireAuth, handleMultiUpload, async (req, res) => {
  const { title, content, publish_at, big_news } = req.body;
  if (!content?.trim()) { req.flash('error', 'Post content is required.'); return res.redirect('/'); }
  if (content.trim().length > MAX_CONTENT) { req.flash('error', `Post cannot exceed ${MAX_CONTENT} characters.`); return res.redirect('/'); }

  const isBigNews = big_news === '1' ? 1 : 0;

  let publishAt = null;
  if (publish_at && publish_at.trim()) {
    const parsed = new Date(publish_at.trim());
    if (!isNaN(parsed.getTime())) publishAt = parsed.toISOString().slice(0, 19).replace('T', ' ');
  }

  try {
    const { content: resolvedContent, mentionedUserIds } = await resolveMentions(content.trim(), pool);
    const [result] = await pool.query(
      'INSERT INTO posts (user_id, title, content, publish_at, big_news) VALUES (?, ?, ?, ?, ?)',
      [req.session.user.id, title?.trim() || null, resolvedContent, publishAt, isBigNews]
    );
    const postId = result.insertId;

    if (req.uploadedPaths && req.uploadedPaths.length) {
      for (let i = 0; i < req.uploadedPaths.length; i++) {
        await pool.query(
          'INSERT INTO post_photos (post_id, photo_url, sort_order) VALUES (?, ?, ?)',
          [postId, req.uploadedPaths[i], i]
        );
      }
    }

    const [users] = await pool.query('SELECT id, email, notify_posts FROM users WHERE active = 1');
    if (isBigNews) {
      sendBigNewsNotification(users, req.session.user, { id: postId, title: title?.trim() || null, content: content.trim() });
      sendPushToAllUsers(
        { title: `📣 Big News from ${req.session.user.name}`, body: (title?.trim() || content.trim()).substring(0, 100), url: `/post/${postId}` },
        { excludeUserId: req.session.user.id, checkColumn: 'push_notify_big_news' }
      );
    } else {
      sendNewPostNotification(users, req.session.user, { id: postId, title: title?.trim() || null, content: content.trim() });
      sendPushToAllUsers(
        { title: `${req.session.user.name} posted`, body: content.trim().substring(0, 100), url: '/' },
        { excludeUserId: req.session.user.id, checkColumn: 'push_notify_posts' }
      );
    }

    // Fire mention notifications (skip self-mentions)
    if (mentionedUserIds.length) {
      const toNotify = mentionedUserIds.filter(id => id !== req.session.user.id);
      if (toNotify.length) {
        try {
          const [mentionedUsers] = await pool.query(
            'SELECT id, email, name FROM users WHERE id IN (?)',
            [toNotify]
          );
          const excerpt = content.trim().substring(0, 80);
          const postUrl = `${process.env.BASE_URL}/post/${postId}`;
          for (const mu of mentionedUsers) {
            sendPushToUser(mu.id, { title: `${req.session.user.name} mentioned you`, body: excerpt, url: `/post/${postId}` });
            sendMentionNotification(mu.email, mu.name, req.session.user.name, excerpt, postUrl);
          }
        } catch (mentionErr) {
          console.error('Mention notification error:', mentionErr.message);
        }
      }
    }

    // Fire-and-forget: fetch Open Graph metadata for any URL in the post body and persist it for the link-preview card.
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
        } catch (e) { console.error('Link preview error:', e.message); }
      })();
    }

    res.redirect('/');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not create post.');
    res.redirect('/');
  }
});

// Edit post content; only the post author or an admin may submit changes.
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
    if (rows[0].user_id !== req.session.user.id && req.session.user.role !== 'admin' && req.session.user.role !== 'moderator') return res.status(403).end();
    const { content: resolvedContent, mentionedUserIds } = await resolveMentions(content.trim(), pool);
    await pool.query(
      'UPDATE posts SET content = ?, title = ?, edited_at = NOW() WHERE id = ?',
      [resolvedContent, title?.trim() || null, req.params.id]
    );

    // Fire mention notifications (re-notify all mentions on edit)
    if (mentionedUserIds.length) {
      const toNotify = mentionedUserIds.filter(id => id !== req.session.user.id);
      if (toNotify.length) {
        try {
          const [mentionedUsers] = await pool.query(
            'SELECT id, email, name FROM users WHERE id IN (?)',
            [toNotify]
          );
          const excerpt = content.trim().substring(0, 80);
          const postUrl = `${process.env.BASE_URL}/post/${req.params.id}`;
          for (const mu of mentionedUsers) {
            sendPushToUser(mu.id, { title: `${req.session.user.name} mentioned you`, body: excerpt, url: `/post/${req.params.id}` });
            sendMentionNotification(mu.email, mu.name, req.session.user.name, excerpt, postUrl);
          }
        } catch (mentionErr) {
          console.error('Mention notification error:', mentionErr.message);
        }
      }
    }

    const ref = req.headers.referer || '/';
    res.redirect(ref.includes('/post/') ? ref : '/');
  } catch (err) { console.error(err); res.redirect('/'); }
});

// Toggle pinned status on a post (admin only); pinned posts sort to the top of the regular feed.
router.post('/posts/:id/pin', requireAuth, async (req, res) => {
  if (req.session.user.role !== 'admin' && req.session.user.role !== 'moderator') return res.status(403).end();
  try {
    await pool.query('UPDATE posts SET pinned = NOT pinned WHERE id = ?', [req.params.id]);
  } catch (err) { console.error(err); }
  const ref = req.headers.referer || '/';
  res.redirect(ref.includes('/post/') ? ref : '/');
});

// Toggle big-news flag; sends a push notification when a post is promoted to big news.
router.post('/posts/:id/toggle-big-news', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT user_id FROM posts WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.redirect('/');
    if (rows[0].user_id !== req.session.user.id && req.session.user.role !== 'admin' && req.session.user.role !== 'moderator') return res.status(403).end();
    await pool.query('UPDATE posts SET big_news = NOT big_news WHERE id = ?', [req.params.id]);
    const [[post]] = await pool.query('SELECT id, title, content, big_news FROM posts WHERE id = ?', [req.params.id]);
    if (post && post.big_news) {
      const [allUsers] = await pool.query('SELECT id, email FROM users WHERE active = 1');
      sendBigNewsNotification(allUsers, req.session.user, post);
      sendPushToAllUsers(
        { title: `📣 Big News from ${req.session.user.name}`, body: (post.title || post.content).substring(0, 100), url: `/post/${post.id}` },
        { excludeUserId: req.session.user.id, checkColumn: 'push_notify_big_news' }
      );
    }
  } catch (err) { console.error(err); }
  const ref = req.headers.referer || '/';
  res.redirect(ref.includes('/post/') ? ref : '/');
});

// Soft-delete a post; only the author, a moderator, or an admin may delete.
// Photo files are preserved until the purge cron hard-deletes after 14 days.
router.post('/posts/:id/delete', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT user_id FROM posts WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    if (!rows.length) return res.redirect('/');
    if (rows[0].user_id !== req.session.user.id && req.session.user.role !== 'admin' && req.session.user.role !== 'moderator') return res.status(403).end();
    await pool.query('UPDATE posts SET deleted_at = NOW() WHERE id = ?', [req.params.id]);
    res.redirect('/');
  } catch (err) { console.error(err); res.redirect('/'); }
});

module.exports = router;
