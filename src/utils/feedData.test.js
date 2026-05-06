const { test } = require('node:test');
const assert = require('node:assert/strict');
const { groupCommentsByPost } = require('./feedData');

test('groupCommentsByPost: empty rows returns empty object', () => {
  assert.deepEqual(groupCommentsByPost([]), {});
});

test('groupCommentsByPost: top-level comments grouped by post_id with empty replies', () => {
  const rows = [
    { id: 1, post_id: 10, parent_id: null, content: 'Hello', user_id: 1, author_name: 'Alice', author_avatar: null, created_at: new Date('2024-01-01') },
    { id: 2, post_id: 10, parent_id: null, content: 'World', user_id: 2, author_name: 'Bob',   author_avatar: null, created_at: new Date('2024-01-02') },
    { id: 3, post_id: 20, parent_id: null, content: 'Other', user_id: 1, author_name: 'Alice', author_avatar: null, created_at: new Date('2024-01-03') },
  ];
  const result = groupCommentsByPost(rows);
  assert.equal(result[10].length, 2);
  assert.equal(result[20].length, 1);
  assert.deepEqual(result[10][0].replies, []);
});

test('groupCommentsByPost: replies nested under their parent comment', () => {
  const rows = [
    { id: 1, post_id: 10, parent_id: null, content: 'Parent', user_id: 1, author_name: 'Alice', author_avatar: null, created_at: new Date('2024-01-01') },
    { id: 2, post_id: 10, parent_id: 1,    content: 'Reply1', user_id: 2, author_name: 'Bob',   author_avatar: null, created_at: new Date('2024-01-02') },
    { id: 3, post_id: 10, parent_id: 1,    content: 'Reply2', user_id: 1, author_name: 'Alice', author_avatar: null, created_at: new Date('2024-01-03') },
  ];
  const result = groupCommentsByPost(rows);
  assert.equal(result[10].length, 1);
  assert.equal(result[10][0].replies.length, 2);
  assert.equal(result[10][0].replies[0].content, 'Reply1');
  assert.equal(result[10][0].replies[1].content, 'Reply2');
});

test('groupCommentsByPost: reply with unknown parent_id is silently dropped', () => {
  const rows = [
    { id: 1, post_id: 10, parent_id: null, content: 'Parent', user_id: 1, author_name: 'Alice', author_avatar: null, created_at: new Date('2024-01-01') },
    { id: 2, post_id: 10, parent_id: 99,   content: 'Orphan', user_id: 2, author_name: 'Bob',   author_avatar: null, created_at: new Date('2024-01-02') },
  ];
  const result = groupCommentsByPost(rows);
  assert.equal(result[10].length, 1);
  assert.equal(result[10][0].replies.length, 0);
});
