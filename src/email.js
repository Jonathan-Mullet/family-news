/**
 * Nodemailer wrapper for all outbound email from Family News.
 *
 * All send functions are fire-and-forget — errors are logged to stderr but
 * never thrown to callers, so a broken SMTP configuration does not crash
 * request handlers. If `EMAIL_HOST` is not set in the environment the module
 * is a no-op and no mail is sent.
 */

const nodemailer = require('nodemailer');

// ── HTML escaping ──────────────────────────────────────────────────────────────

/**
 * Escapes HTML special characters to prevent user content from rendering as
 * markup in email client HTML bodies.
 *
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Transporter (lazy init) ───────────────────────────────────────────────────

let transporter = null;

/**
 * Returns a cached Nodemailer transporter, creating it on first call.
 * Returns null when `EMAIL_HOST` is not configured so callers can
 * short-circuit without throwing.
 *
 * @returns {import('nodemailer').Transporter | null}
 */
function getTransporter() {
  if (!process.env.EMAIL_HOST) return null;
  // Lazy-init: create the transporter object once rather than rebuilding it on every call.
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: parseInt(process.env.EMAIL_PORT) || 587,
      secure: false,
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });
  }
  return transporter;
}

// ── Core send helper ──────────────────────────────────────────────────────────

/**
 * Sends an HTML email. Silently no-ops when email is not configured.
 * Errors from the SMTP transport are caught and logged — never re-thrown.
 *
 * @param {string} to - Recipient email address.
 * @param {string} subject - Email subject line.
 * @param {string} html - HTML body of the email.
 * @returns {Promise<void>}
 */
async function sendMail(to, subject, html) {
  const t = getTransporter();
  if (!t) return;
  try {
    await t.sendMail({
      from: `"Family News" <${process.env.EMAIL_FROM || process.env.EMAIL_USER}>`,
      to,
      subject,
      html,
    });
  } catch (err) {
    // Log but swallow so a broken SMTP config never surfaces to the user.
    console.error('Email error:', err.message);
  }
}

// ── Notification senders ──────────────────────────────────────────────────────

/**
 * Sends a password-reset email containing a tokenised link that expires in
 * 1 hour. The link is constructed from `BASE_URL` + the provided token.
 *
 * @param {string} email - Recipient email address.
 * @param {string} token - One-time reset token (stored in password_reset_tokens).
 * @returns {Promise<void>}
 */
async function sendPasswordReset(email, token) {
  const url = `${process.env.BASE_URL}/reset-password?token=${token}`;
  await sendMail(email, 'Reset your Family News password', `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:20px">
      <h2 style="color:#1e293b">Password Reset</h2>
      <p style="color:#475569">Click below to reset your password. This link expires in 1 hour.</p>
      <a href="${url}" style="display:inline-block;background:#4f46e5;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:500;margin:8px 0">Reset Password</a>
      <p style="color:#94a3b8;font-size:12px;margin-top:16px">If you didn't request this, you can ignore this email.</p>
    </div>
  `);
}

/**
 * Notifies all eligible family members that a new post has been published.
 * Skips the poster themselves and any user who has opted out of post
 * notifications (`notify_posts === 0`).
 *
 * @param {Array<{id: number, email: string, notify_posts: number}>} toUsers - All active users.
 * @param {{id: number, name: string}} poster - The user who created the post.
 * @param {{id: number, title: string, content: string}} post - The new post.
 * @returns {Promise<void>}
 */
async function sendNewPostNotification(toUsers, poster, post) {
  const url = `${process.env.BASE_URL}/post/${post.id}`;
  for (const user of toUsers) {
    if (user.id === poster.id) continue;
    // Skip if user has opted out of post notifications
    if (user.notify_posts === 0) continue;
    await sendMail(user.email, `${poster.name} posted on Family News`, `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:20px">
        <p style="color:#475569"><strong style="color:#1e293b">${escapeHtml(poster.name)}</strong> shared something on Family News:</p>
        ${post.title ? `<h3 style="color:#1e293b;margin:8px 0">${escapeHtml(post.title)}</h3>` : ''}
        <p style="color:#374151;background:#f8fafc;padding:12px;border-radius:8px;border-left:3px solid #4f46e5">
          ${escapeHtml(post.content.substring(0, 300))}${post.content.length > 300 ? '…' : ''}
        </p>
        <a href="${url}" style="display:inline-block;background:#4f46e5;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:500;margin-top:8px">Read and react →</a>
      </div>
    `);
  }
}

/**
 * Notifies the post author that someone commented on their post.
 * Skips if commenter and post owner are the same user, or if the owner
 * has opted out of comment notifications (`notify_comments === 0`).
 *
 * @param {{id: number, email: string, notify_comments: number}} toUser - Post owner.
 * @param {{id: number, name: string}} fromUser - User who left the comment.
 * @param {{id: number, title: string}} post - The post that received a comment.
 * @returns {Promise<void>}
 */
async function sendCommentNotification(toUser, fromUser, post) {
  if (toUser.id === fromUser.id) return;
  // Skip if user has opted out of comment notifications
  if (toUser.notify_comments === 0) return;
  const url = `${process.env.BASE_URL}/post/${post.id}`;
  await sendMail(toUser.email, `${fromUser.name} commented on your post`, `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:20px">
      <p style="color:#475569"><strong style="color:#1e293b">${escapeHtml(fromUser.name)}</strong> commented on your post${post.title ? ` "<em>${escapeHtml(post.title)}</em>"` : ''}.</p>
      <a href="${url}" style="display:inline-block;background:#4f46e5;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:500;margin-top:8px">See the comment →</a>
    </div>
  `);
}

/**
 * Sends a highlighted "Big News" notification to all family members except
 * the poster. Unlike regular post notifications this does not respect the
 * `notify_posts` preference — big news is always delivered via email.
 *
 * @param {Array<{id: number, email: string}>} toUsers - All active users.
 * @param {{id: number, name: string}} poster - The user who created the post.
 * @param {{id: number, title: string, content: string}} post - The big-news post.
 * @returns {Promise<void>}
 */
async function sendBigNewsNotification(toUsers, poster, post) {
  const url = `${process.env.BASE_URL}/post/${post.id}`;
  for (const user of toUsers) {
    if (user.id === poster.id) continue;
    await sendMail(user.email, `📣 Big News from ${escapeHtml(poster.name)}`, `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:20px">
        <div style="background:#92400e;color:#fff;padding:10px 16px;border-radius:8px 8px 0 0;font-weight:700;font-size:15px;letter-spacing:0.02em">📣 Big News</div>
        <div style="border:2px solid #92400e;border-top:none;border-radius:0 0 8px 8px;padding:16px">
          <p style="color:#475569;margin:0 0 8px"><strong style="color:#1e293b">${escapeHtml(poster.name)}</strong> shared big news on Family News:</p>
          ${post.title ? `<h3 style="color:#1e293b;margin:0 0 8px">${escapeHtml(post.title)}</h3>` : ''}
          <p style="color:#374151;background:#fffbeb;padding:12px;border-radius:8px;border-left:3px solid #f59e0b;margin:0 0 12px">
            ${escapeHtml(post.content.substring(0, 300))}${post.content.length > 300 ? '…' : ''}
          </p>
          <a href="${url}" style="display:inline-block;background:#92400e;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:500">Read the full story →</a>
        </div>
      </div>
    `);
  }
}

/**
 * Notifies a user that they have been promoted to a new role on Family News.
 * Only sent for promotions (member→moderator, member→admin, moderator→admin),
 * not for demotions.
 *
 * @param {string} email - Recipient email address.
 * @param {string} name - Recipient display name.
 * @param {'moderator'|'admin'} role - The new role they were promoted to.
 * @returns {Promise<void>}
 */
async function sendPromotionNotification(email, name, role) {
  const roleLabel = role === 'admin' ? 'Admin' : 'Moderator';
  const url = `${process.env.BASE_URL}/guide`;
  await sendMail(email, `You've been made a ${roleLabel} on Family News 🎉`, `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:20px">
      <p style="color:#475569">Hi ${escapeHtml(name)}, you've been made a <strong style="color:#7c3aed">${roleLabel}</strong> on Family News.</p>
      <a href="${url}" style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:500;margin-top:8px">See your role guide →</a>
    </div>
  `);
}

/**
 * Notifies a user that they were @mentioned in a post or comment.
 *
 * @param {string} toEmail   - Mentioned user's email address.
 * @param {string} toName    - Mentioned user's display name.
 * @param {string} fromName  - Name of the user who wrote the mention.
 * @param {string} excerpt   - First ~80 chars of the post/comment content (raw text).
 * @param {string} postUrl   - Full URL of the post (BASE_URL + /post/:id).
 * @returns {Promise<void>}
 */
async function sendMentionNotification(toEmail, toName, fromName, excerpt, postUrl) {
  await sendMail(toEmail, `${fromName} mentioned you on Family News`, `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:20px">
      <p style="color:#475569">Hi ${escapeHtml(toName)}, <strong style="color:#1e293b">${escapeHtml(fromName)}</strong> mentioned you on Family News:</p>
      <p style="color:#374151;background:#f5f3ff;padding:12px;border-radius:8px;border-left:3px solid #7c3aed;margin:8px 0">
        ${escapeHtml(excerpt)}${excerpt.length >= 80 ? '…' : ''}
      </p>
      <a href="${postUrl}" style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:500;margin-top:8px">See the post →</a>
    </div>
  `);
}

module.exports = { sendPasswordReset, sendNewPostNotification, sendCommentNotification, sendBigNewsNotification, sendPromotionNotification, sendMentionNotification };
