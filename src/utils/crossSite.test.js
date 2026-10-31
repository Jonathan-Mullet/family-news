const { test } = require('node:test');
const assert = require('node:assert');
const { isCrossSiteWrite } = require('./crossSite');

const req = (method, headers = {}) => ({ method, get: (h) => headers[h.toLowerCase()], headers });
const HOST = { host: 'news.jonathan-mullet.com' };

test('reads are never blocked', () => {
  assert.equal(isCrossSiteWrite(req('GET', { ...HOST, 'sec-fetch-site': 'cross-site' })), false);
});

test('writes from this site go through', () => {
  assert.equal(isCrossSiteWrite(req('POST', { ...HOST, 'sec-fetch-site': 'same-origin', origin: 'https://news.jonathan-mullet.com' })), false);
  assert.equal(isCrossSiteWrite(req('DELETE', { ...HOST, 'sec-fetch-site': 'same-origin' })), false);
  // "none": typed into the address bar / a bookmark — no page made the request.
  assert.equal(isCrossSiteWrite(req('POST', { ...HOST, 'sec-fetch-site': 'none' })), false);
});

test('writes from another site — including the sibling *.jonathan-mullet.com apps — are blocked', () => {
  assert.equal(isCrossSiteWrite(req('POST', { ...HOST, 'sec-fetch-site': 'same-site', origin: 'https://tesla.jonathan-mullet.com' })), true);
  assert.equal(isCrossSiteWrite(req('POST', { ...HOST, 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' })), true);
});

test('older browsers without Sec-Fetch-Site: judged by Origin when there is a real one', () => {
  assert.equal(isCrossSiteWrite(req('POST', { ...HOST, origin: 'https://evil.example' })), true);
  assert.equal(isCrossSiteWrite(req('POST', { ...HOST, origin: 'https://news.jonathan-mullet.com' })), false);
  assert.equal(isCrossSiteWrite(req('POST', { ...HOST, origin: 'null' })), false, 'opaque origin: no basis to block');
  assert.equal(isCrossSiteWrite(req('POST', { ...HOST })), false, 'no headers at all (scripts, curl): the session cookie rules apply');
  assert.equal(isCrossSiteWrite(req('POST', { ...HOST, origin: 'not a url' })), true);
});
