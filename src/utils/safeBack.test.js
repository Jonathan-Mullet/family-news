const { test } = require('node:test');
const assert = require('node:assert');
const { backToPost } = require('./safeBack');

const req = (referer, host = 'news.jonathan-mullet.com') => ({ headers: { referer }, get: (h) => (h.toLowerCase() === 'host' ? host : undefined) });

test('goes back to a post page on this site', () => {
  assert.equal(backToPost(req('https://news.jonathan-mullet.com/post/12')), '/post/12');
  assert.equal(backToPost(req('https://news.jonathan-mullet.com/post/12?x=1#c5')), '/post/12?x=1');
});

test('anything else lands on the feed: other sites, other pages, junk, missing', () => {
  assert.equal(backToPost(req('https://evil.example/post/12')), '/');
  assert.equal(backToPost(req('https://news.jonathan-mullet.com.evil.example/post/1')), '/');
  assert.equal(backToPost(req('https://news.jonathan-mullet.com/settings')), '/');
  assert.equal(backToPost(req('https://news.jonathan-mullet.com/x/post/12')), '/');
  assert.equal(backToPost(req('not a url')), '/');
  assert.equal(backToPost(req(undefined)), '/');
  assert.equal(backToPost(req('//evil.example/post/1')), '/');
});
