function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Replace @[Name](id) tokens with <a class="mention"> links.
// Escapes all content HTML first so tokens are never XSS vectors.
function renderContent(content) {
  if (!content) return '';
  const escaped = escapeHtml(content);
  return escaped.replace(/@\[([^\]]+)\]\((\d+)\)/g, (_, name, id) =>
    `<a href="/member/${id}" class="mention">@${name}</a>`
  );
}

// Scan content for @Name patterns, resolve matched names to @[Name](id) tokens.
// Returns { content: string, mentionedUserIds: number[] }.
// Tries two-word (full name) match first, then one-word (unique first name) match.
async function resolveMentions(content, pool) {
  if (!content) return { content: content ?? '', mentionedUserIds: [] };
  const [users] = await pool.query('SELECT id, name FROM users WHERE active = 1');
  const mentionedIds = new Set();
  const out = [];
  let i = 0;

  while (i < content.length) {
    if (content[i] !== '@') { out.push(content[i++]); continue; }

    const rest = content.slice(i + 1);
    // Two-word match only: names with 3+ words (rare on a family site) will match
    // the first two words and leave the remainder as plain text.
    const m2 = rest.match(/^(\w+[ \t]+\w+)/);
    const m1 = rest.match(/^(\w+)/);
    let matched = false;

    // Try full two-word name match first
    if (m2) {
      const candidate = m2[1].replace(/[ \t]+/, ' ');
      const user = users.find(u => u.name.toLowerCase() === candidate.toLowerCase());
      if (user) {
        out.push(`@[${user.name}](${user.id})`);
        mentionedIds.add(user.id);
        i += 1 + m2[1].length;
        matched = true;
      }
    }

    // Fall back to unique first-name match
    if (!matched && m1) {
      const firstName = m1[1].toLowerCase();
      const hits = users.filter(u => u.name.split(' ')[0].toLowerCase() === firstName);
      if (hits.length === 1) {
        out.push(`@[${hits[0].name}](${hits[0].id})`);
        mentionedIds.add(hits[0].id);
        i += 1 + m1[1].length;
        matched = true;
      }
    }

    if (!matched) { out.push('@'); i++; }
  }

  return { content: out.join(''), mentionedUserIds: [...mentionedIds] };
}

module.exports = { renderContent, resolveMentions };
