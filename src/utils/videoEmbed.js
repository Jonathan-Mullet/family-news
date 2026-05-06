'use strict';

/**
 * Extracts an embeddable iframe src URL from the first YouTube or Vimeo link
 * in `content`. Returns null if no supported video URL is found.
 *
 * Supported inputs → embed URLs:
 *   youtube.com/watch?v=ID   → https://www.youtube.com/embed/ID
 *   youtu.be/ID              → https://www.youtube.com/embed/ID
 *   youtube.com/shorts/ID    → https://www.youtube.com/embed/ID
 *   m.youtube.com/watch?v=ID → https://www.youtube.com/embed/ID
 *   vimeo.com/ID             → https://player.vimeo.com/video/ID
 *
 * @param {string|null|undefined} content - Raw post content text
 * @returns {string|null}
 */
function extractVideoEmbed(content) {
  if (!content) return null;

  // YouTube: handles watch?v=, youtu.be/, shorts/, m.youtube.com variants.
  // Video IDs are exactly 11 chars [A-Za-z0-9_-].
  // The (?:[^&\s]*&)* group skips any query params that appear before v=.
  const yt = content.match(
    /(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:[^&\s]*&)*v=|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
  );
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;

  // Vimeo: numeric IDs only — excludes /channels/, /groups/, /album/, etc.
  const vi = content.match(/(?:https?:\/\/)?(?:www\.)?vimeo\.com\/(\d+)(?:[/?#]|$)/);
  if (vi) return `https://player.vimeo.com/video/${vi[1]}`;

  return null;
}

module.exports = { extractVideoEmbed };
