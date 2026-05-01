const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (!process.env.EMAIL_HOST) return null;
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
    console.error('Email error:', err.message);
  }
}

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

async function sendNewPostNotification(toUsers, poster, post) {
  const url = `${process.env.BASE_URL}/post/${post.id}`;
  for (const user of toUsers) {
    if (user.id === poster.id) continue;
    // Skip if user has opted out of post notifications
    if (user.notify_posts === 0) continue;
    await sendMail(user.email, `${poster.name} posted on Family News`, `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:20px">
        <p style="color:#475569"><strong style="color:#1e293b">${poster.name}</strong> shared something on Family News:</p>
        ${post.title ? `<h3 style="color:#1e293b;margin:8px 0">${post.title}</h3>` : ''}
        <p style="color:#374151;background:#f8fafc;padding:12px;border-radius:8px;border-left:3px solid #4f46e5">
          ${post.content.substring(0, 300)}${post.content.length > 300 ? '…' : ''}
        </p>
        <a href="${url}" style="display:inline-block;background:#4f46e5;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:500;margin-top:8px">Read and react →</a>
      </div>
    `);
  }
}

async function sendCommentNotification(toUser, fromUser, post) {
  if (toUser.id === fromUser.id) return;
  // Skip if user has opted out of comment notifications
  if (toUser.notify_comments === 0) return;
  const url = `${process.env.BASE_URL}/post/${post.id}`;
  await sendMail(toUser.email, `${fromUser.name} commented on your post`, `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:20px">
      <p style="color:#475569"><strong style="color:#1e293b">${fromUser.name}</strong> commented on your post${post.title ? ` "<em>${post.title}</em>"` : ''}.</p>
      <a href="${url}" style="display:inline-block;background:#4f46e5;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:500;margin-top:8px">See the comment →</a>
    </div>
  `);
}

module.exports = { sendPasswordReset, sendNewPostNotification, sendCommentNotification };
