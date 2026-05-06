/**
 * Shared feed data loader.
 *
 * Enriches an array of post objects (already loaded from DB) with the
 * additional data needed to render feed cards: reactions, photos, reaction
 * name lists, and the most recent comment for each post.
 *
 * Posts are mutated in-place: a .photos array is added to each post.
 * The three lookup maps are returned for use in template rendering.
 */

const { pool } = require('../db');

/**
 * Loads reactions, photos, reaction names, and latest comments for a set of posts.
 *
 * @param {Array<{id: number}>} posts        - Post objects (must have .id; mutated in-place: .photos array added to each)
 * @param {number}              viewerUserId - Session user ID (for userReacted flags)
 * @returns {Promise<{
 *   reactionsByPost:     Object,
 *   reactionNames:       Object,
 *   latestCommentByPost: Object
 * }>}
 */
async function enrichPosts(posts, viewerUserId) {
  // Initialize photos array on each post (required by templates even when empty)
  posts.forEach(p => { p.photos = []; });

  const reactionsByPost = {};
  const reactionNames = {};
  const latestCommentByPost = {};

  // Nothing to load if there are no posts
  if (!posts.length) return { reactionsByPost, reactionNames, latestCommentByPost };

  const ids = posts.map(p => p.id);

  // ── Reactions ──────────────────────────────────────────────────────────────
  // Load per-emoji counts and whether the viewing user has reacted
  const [reactions] = await pool.query(`
    SELECT post_id, emoji, COUNT(*) AS count,
      MAX(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS user_reacted
    FROM reactions WHERE post_id IN (?)
    GROUP BY post_id, emoji
  `, [viewerUserId, ids]);
  reactions.forEach(r => {
    if (!reactionsByPost[r.post_id]) reactionsByPost[r.post_id] = {};
    reactionsByPost[r.post_id][r.emoji] = { count: r.count, userReacted: r.user_reacted === 1 };
  });

  // ── Photos ─────────────────────────────────────────────────────────────────
  // Load in sort_order so multi-photo posts display in the correct sequence
  const [photoRows] = await pool.query(
    'SELECT post_id, photo_url FROM post_photos WHERE post_id IN (?) ORDER BY sort_order',
    [ids]
  );
  photoRows.forEach(ph => {
    const post = posts.find(p => p.id === ph.post_id);
    if (post) post.photos.push(ph.photo_url);
  });

  // ── Reaction names ─────────────────────────────────────────────────────────
  // Used by the desktop tooltip and mobile bottom sheet to list who reacted
  const [nameRows] = await pool.query(`
    SELECT r.post_id, r.emoji, u.name
    FROM reactions r JOIN users u ON r.user_id = u.id
    WHERE r.post_id IN (?)
    ORDER BY r.post_id, r.emoji, u.name
  `, [ids]);
  nameRows.forEach(r => {
    if (!reactionNames[r.post_id]) reactionNames[r.post_id] = {};
    if (!reactionNames[r.post_id][r.emoji]) reactionNames[r.post_id][r.emoji] = [];
    reactionNames[r.post_id][r.emoji].push(r.name);
  });

  // ── Latest comment ─────────────────────────────────────────────────────────
  // Inline preview on feed cards shows only the most recent comment per post
  const [latestCommentRows] = await pool.query(`
    SELECT c.post_id, c.content, u.name AS author_name, u.avatar_url AS author_avatar, u.id AS author_id
    FROM comments c JOIN users u ON c.user_id = u.id
    WHERE c.id IN (SELECT MAX(id) FROM comments WHERE post_id IN (?) AND deleted_at IS NULL GROUP BY post_id)
  `, [ids]);
  latestCommentRows.forEach(c => { latestCommentByPost[c.post_id] = c; });

  return { reactionsByPost, reactionNames, latestCommentByPost };
}

module.exports = { enrichPosts };
