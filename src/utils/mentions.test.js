const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renderContent, resolveMentions } = require('./mentions');

// ── renderContent tests ───────────────────────────────────────────────────────

test('renderContent: returns empty string for falsy input', () => {
  assert.equal(renderContent(''), '');
  assert.equal(renderContent(null), '');
  assert.equal(renderContent(undefined), '');
});

test('renderContent: HTML-escapes regular text', () => {
  assert.equal(renderContent('<b>hello</b>'), '&lt;b&gt;hello&lt;/b&gt;');
  assert.equal(renderContent('a & b'), 'a &amp; b');
});

test('renderContent: replaces @[Name](id) token with link', () => {
  const result = renderContent('Hi @[Alice](42)!');
  assert.equal(result, 'Hi <a href="/member/42" class="mention">@Alice</a>!');
});

test('renderContent: multiple tokens in one string', () => {
  const result = renderContent('@[Alice](1) and @[Bob](2)');
  assert.equal(result, '<a href="/member/1" class="mention">@Alice</a> and <a href="/member/2" class="mention">@Bob</a>');
});

test('renderContent: escapes HTML then resolves tokens (XSS safety)', () => {
  const result = renderContent('say @[Alice](1) <script>bad</script>');
  assert.equal(result, 'say <a href="/member/1" class="mention">@Alice</a> &lt;script&gt;bad&lt;/script&gt;');
});

test('renderContent: leaves @-signs with no token format alone', () => {
  const result = renderContent('email me @home or @Alice');
  assert.equal(result, 'email me @home or @Alice');
});

// ── resolveMentions tests ─────────────────────────────────────────────────────

function makePool(users) {
  return { query: async () => [users] };
}

const USERS = [
  { id: 1, name: 'Alice Smith' },
  { id: 2, name: 'Bob Jones' },
  { id: 3, name: 'Alice Cooper' }, // same first name as user 1 → ambiguous
  { id: 4, name: 'Carol' },        // single-word name
];

test('resolveMentions: resolves unique first name', async () => {
  const pool = makePool([{ id: 2, name: 'Bob Jones' }]);
  const { content, mentionedUserIds } = await resolveMentions('Hi @Bob!', pool);
  assert.equal(content, 'Hi @[Bob Jones](2)!');
  assert.deepEqual(mentionedUserIds, [2]);
});

test('resolveMentions: resolves full name (two words)', async () => {
  const pool = makePool(USERS);
  const { content, mentionedUserIds } = await resolveMentions('Hey @Alice Smith come over', pool);
  assert.equal(content, 'Hey @[Alice Smith](1) come over');
  assert.deepEqual(mentionedUserIds, [1]);
});

test('resolveMentions: ambiguous first name → no match', async () => {
  const pool = makePool(USERS);
  const { content, mentionedUserIds } = await resolveMentions('Hi @Alice!', pool);
  assert.equal(content, 'Hi @Alice!');
  assert.deepEqual(mentionedUserIds, []);
});

test('resolveMentions: unmatched name → left as plain text', async () => {
  const pool = makePool(USERS);
  const { content, mentionedUserIds } = await resolveMentions('Hi @Zorgon!', pool);
  assert.equal(content, 'Hi @Zorgon!');
  assert.deepEqual(mentionedUserIds, []);
});

test('resolveMentions: deduplicates same user mentioned twice', async () => {
  const pool = makePool([{ id: 2, name: 'Bob Jones' }]);
  const { content, mentionedUserIds } = await resolveMentions('@Bob hey @Bob', pool);
  assert.equal(content, '@[Bob Jones](2) hey @[Bob Jones](2)');
  assert.deepEqual(mentionedUserIds, [2]);
});

test('resolveMentions: single-word user name', async () => {
  const pool = makePool([{ id: 4, name: 'Carol' }]);
  const { content, mentionedUserIds } = await resolveMentions('Hi @Carol!', pool);
  assert.equal(content, 'Hi @[Carol](4)!');
  assert.deepEqual(mentionedUserIds, [4]);
});

test('resolveMentions: returns empty for falsy content', async () => {
  const pool = makePool([]);
  const r1 = await resolveMentions('', pool);
  assert.equal(r1.content, '');
  assert.deepEqual(r1.mentionedUserIds, []);
  const r2 = await resolveMentions(null, pool);
  assert.equal(r2.content, '');
  assert.deepEqual(r2.mentionedUserIds, []);
});
