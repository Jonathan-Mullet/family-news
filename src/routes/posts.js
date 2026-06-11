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
const { parsePublishAt, toSqlUtc } = require('../utils/dates');

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
//
// PAGINATION: the feed used to load EVERY post (and, via enrichPosts, every
// comment on every post) per visit — fine in year one, quietly multi-MB later.
// Big-news and pinned posts still load in full (small sets by design); unpinned
// regular posts load PAGE_SIZE at a time via a keyset cursor (created_at, id) —
// keyset rather than OFFSET so a new post landing mid-browse can't shift the
// window and duplicate/skip cards on "Load more".
const PAGE_SIZE = 30;
const FEED_SELECT = `
  SELECT p.*, u.name AS author_name, u.avatar_url AS author_avatar,
    (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id AND c.deleted_at IS NULL) AS comment_count,
    lp.og_title, lp.og_description, lp.og_image, lp.url AS preview_url
  FROM posts p
  JOIN users u ON p.user_id = u.id
  LEFT JOIN link_previews lp ON lp.post_id = p.id
  WHERE (p.publish_at IS NULL OR p.publish_at <= NOW() OR p.user_id = ?) AND p.deleted_at IS NULL`;

// One keyset page of unpinned regular posts → { rows, hasMore, cursor }.
async function fetchRegularPage(userId, before, beforeId) {
  const params = [userId];
  let cursorSql = '';
  if (before && beforeId) {
    cursorSql = ' AND (p.created_at < ? OR (p.created_at = ? AND p.id < ?))';
    params.push(before, before, beforeId);
  }
  const [rows] = await pool.query(
    `${FEED_SELECT} AND p.big_news = 0 AND p.pinned = 0${cursorSql}
     ORDER BY p.created_at DESC, p.id DESC LIMIT ${PAGE_SIZE + 1}`,
    params
  );
  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  const last = page[page.length - 1];
  return {
    rows: page,
    hasMore,
    cursor: last ? { before: new Date(last.created_at).toISOString(), beforeId: last.id } : null,
  };
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    // Full sets: big news (banner + archive) and pinned posts.
    const [bigNewsAll] = await pool.query(
      `${FEED_SELECT} AND p.big_news = 1 ORDER BY p.created_at DESC`, [userId]);
    const [pinnedPosts] = await pool.query(
      `${FEED_SELECT} AND p.big_news = 0 AND p.pinned = 1 ORDER BY p.created_at DESC`, [userId]);
    const { rows: unpinnedPage, hasMore, cursor } = await fetchRegularPage(userId, null, null);

    const allPosts = [...bigNewsAll, ...pinnedPosts, ...unpinnedPage];
    const cutoffMs = BIG_NEWS_DAYS * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const bigNewsPosts = bigNewsAll.filter(p => (now - new Date(p.created_at).getTime()) < cutoffMs);
    const archivedBigNews = bigNewsAll.filter(p => (now - new Date(p.created_at).getTime()) >= cutoffMs);
    // Pinned posts rise to the top; both lists arrive newest-first from SQL.
    const regularPosts = [...pinnedPosts, ...unpinnedPage];

    const { reactionsByPost, reactionNames, commentsByPost } = await enrichPosts(allPosts, userId);

    let readersByPost = {};
    let memberCount = 0;
    if (allPosts.length) {
      const ids = allPosts.map(p => p.id);
      const [readRows] = await pool.query(
        'SELECT post_id, COUNT(*) AS read_count FROM post_reads WHERE post_id IN (?) GROUP BY post_id',
        [ids]
      );
      const readMap = {};
      readRows.forEach(r => { readMap[r.post_id] = r.read_count; });
      allPosts.forEach(p => { p.read_count = readMap[p.id] || 0; });

      if (userId && (req.session.user.role === 'admin' || req.session.user.role === 'moderator')) {
        const [readerRows] = await pool.query(
          `SELECT pr.post_id, u.name AS reader_name
           FROM post_reads pr JOIN users u ON pr.user_id = u.id
           WHERE pr.post_id IN (?)`,
          [ids]
        );
        readerRows.forEach(r => {
          if (!readersByPost[r.post_id]) readersByPost[r.post_id] = [];
          readersByPost[r.post_id].push(r.reader_name);
        });
        const [[mc]] = await pool.query('SELECT COUNT(*) AS cnt FROM users WHERE active = 1');
        memberCount = mc.cnt;
      }
    }

    // Newest visible post id, for the new-post poller. Post ids are monotonic, and
    // the newest post is always in one of the loaded sets (newest unpinned is page
    // 1's first row; pinned/big-news load in full) — so max(id) over loaded rows
    // equals max over all visible posts.
    const latestPostId = allPosts.reduce((m, p) => Math.max(m, p.id), 0);
    res.render('feed', {
      bigNewsPosts, regularPosts, archivedBigNews, reactionsByPost, reactionNames,
      commentsByPost, latestPostId, readersByPost, memberCount,
      feedHasMore: hasMore, feedCursor: cursor,
    });
  } catch (err) {
    console.error(err);
    res.render('error', { message: 'Could not load posts.' });
  }
});

// "Load more" endpoint: next keyset page of unpinned regular posts, returned as
// server-rendered post-card HTML (same partial the feed uses) + the next cursor.
router.get('/api/feed-page', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const before = String(req.query.before || '');
    const beforeId = parseInt(req.query.beforeId, 10);
    if (!before || isNaN(new Date(before).getTime()) || !Number.isInteger(beforeId) || beforeId < 1) {
      return res.status(400).json({ error: 'bad cursor' });
    }
    const { rows, hasMore, cursor } = await fetchRegularPage(userId, new Date(before), beforeId);
    if (!rows.length) return res.json({ html: '', hasMore: false, cursor: null });

    const { reactionsByPost, reactionNames, commentsByPost } = await enrichPosts(rows, userId);
    // Read counts + (mod/admin) reader names, mirroring the page-1 enrichment.
    const ids = rows.map(p => p.id);
    const [readRows] = await pool.query(
      'SELECT post_id, COUNT(*) AS read_count FROM post_reads WHERE post_id IN (?) GROUP BY post_id', [ids]);
    const readMap = {};
    readRows.forEach(r => { readMap[r.post_id] = r.read_count; });
    rows.forEach(p => { p.read_count = readMap[p.id] || 0; });
    let readersByPost = {};
    let memberCount = 0;
    if (req.session.user.role === 'admin' || req.session.user.role === 'moderator') {
      const [readerRows] = await pool.query(
        `SELECT pr.post_id, u.name AS reader_name
         FROM post_reads pr JOIN users u ON pr.user_id = u.id WHERE pr.post_id IN (?)`, [ids]);
      readerRows.forEach(r => {
        if (!readersByPost[r.post_id]) readersByPost[r.post_id] = [];
        readersByPost[r.post_id].push(r.reader_name);
      });
      const [[mc]] = await pool.query('SELECT COUNT(*) AS cnt FROM users WHERE active = 1');
      memberCount = mc.cnt;
    }

    res.render('partials/feed-page', {
      posts: rows, reactionsByPost, reactionNames, commentsByPost, readersByPost, memberCount,
    }, (err, html) => {
      if (err) { console.error('feed-page render error:', err); return res.status(500).json({ error: 'render failed' }); }
      res.json({ html, hasMore, cursor });
    });
  } catch (err) {
    console.error('feed-page error:', err);
    res.status(500).json({ error: 'failed' });
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
       WHERE p.id = ? AND p.deleted_at IS NULL
         AND (p.publish_at IS NULL OR p.publish_at <= NOW() OR p.user_id = ?)`,
      [req.params.id, userId]
    );
    if (!posts.length) return res.render('error', { message: 'Post not found.' });
    const post = posts[0];

    // Mark notifications as read when the user views the post (fire-and-forget)
    if (req.session.user) {
      pool.query(
        'UPDATE notifications SET read_at = NOW() WHERE user_id = ? AND post_id = ? AND read_at IS NULL',
        [req.session.user.id, post.id]
      ).catch(e => console.error('Notification read mark error:', e.message));
    }

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
  const { title, content, publish_at, publish_at_utc, big_news } = req.body;
  if (!content?.trim()) { req.flash('error', 'Post content is required.'); return res.redirect('/'); }
  if (content.trim().length > MAX_CONTENT) { req.flash('error', `Post cannot exceed ${MAX_CONTENT} characters.`); return res.redirect('/'); }

  const isBigNews = big_news === '1' ? 1 : 0;

  // publish_at_utc is a hidden field the composer JS fills with a UTC ISO
  // string converted from the datetime-local input — the browser knows the
  // user's timezone; this UTC container does not (parsing the raw wall-clock
  // here would schedule Pacific users 7-8h early). publish_at (the raw
  // datetime-local value) is only a no-JS fallback, parsed in server TZ.
  let publishAt = null;
  const rawSchedule = (publish_at_utc || '').trim() || (publish_at || '').trim();
  if (rawSchedule) {
    const parsed = parsePublishAt(rawSchedule); // null if unparseable or >1 year out
    if (!parsed) {
      // The upload middleware already wrote any photos to disk — clean them up.
      (req.uploadedPaths || []).forEach(p => deleteUploadedFile(p));
      req.flash('error', 'Scheduled time is invalid — it must be a real date no more than a year away.');
      return res.redirect('/');
    }
    publishAt = toSqlUtc(parsed);
  }

  try {
    const { content: resolvedContent, mentionedUserIds } = await resolveMentions(content.trim(), pool);

    // Post + photos are inserted atomically: a failed photo INSERT must not
    // leave a half-created post in the feed. Notifications stay OUTSIDE the
    // transaction (they're fire-and-forget and must not hold the connection).
    // notified_at: immediate posts are notified right here, so stamp NOW();
    // scheduled posts stay NULL and the 5-minute cron notifies at publish time.
    const conn = await pool.getConnection();
    let postId;
    try {
      await conn.beginTransaction();
      const [result] = await conn.query(
        `INSERT INTO posts (user_id, title, content, publish_at, big_news, notified_at)
         VALUES (?, ?, ?, ?, ?, ${publishAt ? 'NULL' : 'NOW()'})`,
        [req.session.user.id, title?.trim() || null, resolvedContent, publishAt, isBigNews]
      );
      postId = result.insertId;

      if (req.uploadedPaths && req.uploadedPaths.length) {
        for (let i = 0; i < req.uploadedPaths.length; i++) {
          await conn.query(
            'INSERT INTO post_photos (post_id, photo_url, sort_order) VALUES (?, ?, ?)',
            [postId, req.uploadedPaths[i], i]
          );
        }
      }
      await conn.commit();
    } catch (txErr) {
      await conn.rollback().catch(() => {});
      // The upload files were written before the INSERTs ran; with the post
      // rolled back they are orphans — best-effort unlink (deleteUploadedFile
      // logs-and-continues on failure).
      (req.uploadedPaths || []).forEach(p => deleteUploadedFile(p));
      throw txErr;
    } finally {
      conn.release();
    }

    // Notifications (email + push + mentions) are skipped entirely for
    // scheduled posts — notifying the family at creation time would spoil the
    // surprise the scheduling feature exists for. The 5-minute cron in
    // src/cron.js sends the same notifications once publish_at arrives.
    if (!publishAt) {
      const [users] = await pool.query('SELECT id, email, notify_posts FROM users WHERE active = 1');
      if (isBigNews) {
        sendBigNewsNotification(users, req.session.user, { id: postId, title: title?.trim() || null, content: content.trim() })
          .catch(err => console.error('Big news email error:', err));
        sendPushToAllUsers(
          { title: `📣 Big News from ${req.session.user.name}`, body: (title?.trim() || content.trim()).substring(0, 100), url: `/post/${postId}` },
          { excludeUserId: req.session.user.id, checkColumn: 'push_notify_big_news' }
        ).catch(err => console.error('Big news push error:', err));
      } else {
        sendNewPostNotification(users, req.session.user, { id: postId, title: title?.trim() || null, content: content.trim() })
          .catch(err => console.error('New post email error:', err));
        sendPushToAllUsers(
          { title: `${req.session.user.name} posted`, body: content.trim().substring(0, 100), url: '/' },
          { excludeUserId: req.session.user.id, checkColumn: 'push_notify_posts' }
        ).catch(err => console.error('New post push error:', err));
      }

      // Fire-and-forget: mention notifications (skip self-mentions)
      if (mentionedUserIds.length) {
        const toNotify = mentionedUserIds.filter(id => id !== req.session.user.id);
        const authorName = req.session.user.name;
        const excerpt = content.trim().substring(0, 80);
        const postUrl = `${process.env.BASE_URL}/post/${postId}`;
        if (toNotify.length) {
          (async () => {
            try {
              const [mentionedUsers] = await pool.query(
                'SELECT id, email, name FROM users WHERE id IN (?)',
                [toNotify]
              );
              for (const mu of mentionedUsers) {
                sendPushToUser(mu.id, { title: `${authorName} mentioned you`, body: excerpt, url: `/post/${postId}` })
                  .catch(err => console.error('Mention push error:', err));
                sendMentionNotification(mu.email, mu.name, authorName, excerpt, postUrl)
                  .catch(err => console.error('Mention email error:', err));
                pool.query(
                  'INSERT INTO notifications (user_id, actor_id, type, post_id) VALUES (?, ?, ?, ?)',
                  [mu.id, req.session.user.id, 'mention', postId]
                ).catch(e => console.error('Mention notification insert error:', e.message));
              }
            } catch (mentionErr) {
              console.error('Mention notification error:', mentionErr.message);
            }
          })();
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

    // Fire-and-forget: mention notifications (re-notify all mentions on edit — v1 simple approach)
    if (mentionedUserIds.length) {
      const toNotify = mentionedUserIds.filter(id => id !== req.session.user.id);
      const authorName = req.session.user.name;
      const excerpt = content.trim().substring(0, 80);
      const postUrl = `${process.env.BASE_URL}/post/${req.params.id}`;
      const editedPostId = req.params.id;
      if (toNotify.length) {
        (async () => {
          try {
            const [mentionedUsers] = await pool.query(
              'SELECT id, email, name FROM users WHERE id IN (?)',
              [toNotify]
            );
            for (const mu of mentionedUsers) {
              sendPushToUser(mu.id, { title: `${authorName} mentioned you`, body: excerpt, url: `/post/${editedPostId}` })
                .catch(err => console.error('Mention push error:', err));
              sendMentionNotification(mu.email, mu.name, authorName, excerpt, postUrl)
                .catch(err => console.error('Mention email error:', err));
            }
          } catch (mentionErr) {
            console.error('Mention notification error:', mentionErr.message);
          }
        })();
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
      sendBigNewsNotification(allUsers, req.session.user, post)
        .catch(err => console.error('Big news email error:', err));
      sendPushToAllUsers(
        { title: `📣 Big News from ${req.session.user.name}`, body: (post.title || post.content).substring(0, 100), url: `/post/${post.id}` },
        { excludeUserId: req.session.user.id, checkColumn: 'push_notify_big_news' }
      ).catch(err => console.error('Big news push error:', err));
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
