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

// Scan content for @Name patterns and turn each into an @[Name](id) token.
// Returns { content, mentionedUserIds, ambiguous } — `ambiguous` lists bare names that match more
// than one person (e.g. "@Emily" with two Emilys) so the route can tell the poster nobody was
// notified, rather than silently dropping it.
//
// Words are Unicode letters/digits (José, Zoë), and the longest full name wins (up to four words:
// "@Emma A Wengerd Miller"), then a unique first name. A hand-typed "@[Name](id)" is reduced to
// plain "@Name" first, so nobody can fake a mention link.
const WORD = "[\\p{L}\\p{N}_-]+"; // no apostrophes: "@Bob's" must still find Bob
const NAME_AT = (n) => new RegExp(`^(${WORD}(?:[ \\t]+${WORD}){${n - 1}})`, 'u');
const norm = (s) => s.replace(/[ \t]+/g, ' ').toLowerCase();

async function resolveMentions(content, pool) {
  if (!content) return { content: content ?? '', mentionedUserIds: [], ambiguous: [] };
  content = content.replace(/@\[([^\]]+)\]\(\d+\)/g, '@$1');
  const [users] = await pool.query('SELECT id, name FROM users WHERE active = 1');
  const mentionedIds = new Set();
  const ambiguous = new Map();
  const out = [];
  let i = 0;
  // Brackets would break the stored token, so they never go into one.
  const token = (u) => `@[${u.name.replace(/[[\]()]/g, '')}](${u.id})`;

  while (i < content.length) {
    if (content[i] !== '@') { out.push(content[i++]); continue; }
    const rest = content.slice(i + 1);
    let matched = false;

    for (let n = 4; n >= 2 && !matched; n--) {
      const m = rest.match(NAME_AT(n));
      if (!m) continue;
      const user = users.find((u) => norm(u.name) === norm(m[1]));
      if (user) {
        out.push(token(user));
        mentionedIds.add(user.id);
        i += 1 + m[1].length;
        matched = true;
      }
    }

    const m1 = !matched && rest.match(NAME_AT(1));
    if (m1) {
      const first = m1[1].toLowerCase();
      const hits = users.filter((u) => u.name.split(' ')[0].toLowerCase() === first);
      if (hits.length === 1) {
        out.push(token(hits[0]));
        mentionedIds.add(hits[0].id);
        i += 1 + m1[1].length;
        matched = true;
      } else if (hits.length > 1) {
        ambiguous.set(first, { typed: m1[1], options: hits.map((u) => u.name) });
      }
    }

    if (!matched) { out.push('@'); i++; }
  }

  return { content: out.join(''), mentionedUserIds: [...mentionedIds], ambiguous: [...ambiguous.values()] };
}

/** A plain-language note for the poster when a bare name matched more than one person. */
function ambiguousNote(ambiguous) {
  if (!ambiguous || !ambiguous.length) return null;
  const parts = ambiguous.map((a) => `“@${a.typed}” could be ${a.options.join(' or ')}`);
  return `${parts.join('; ')} — so nobody was notified. Type their full name, or pick them from the list that appears when you type @.`;
}

/** Ids of the people mentioned in stored content (its @[Name](id) tokens), each once. */
function mentionIdsIn(content) {
  return [...new Set([...String(content || '').matchAll(/@\[[^\]]+\]\((\d+)\)/g)].map((m) => Number(m[1])))];
}

module.exports = { renderContent, resolveMentions, ambiguousNote, mentionIdsIn };
