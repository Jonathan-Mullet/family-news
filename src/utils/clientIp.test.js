const { test } = require('node:test');
const assert = require('node:assert');
const { clientIp, isCloudflare } = require('./clientIp');

const req = (ip, headers = {}) => ({ ip, get: (h) => headers[h.toLowerCase()] });

test('isCloudflare: Cloudflare edge ranges only', () => {
  assert.equal(isCloudflare('172.68.129.152'), true);
  assert.equal(isCloudflare('104.16.1.1'), true);
  assert.equal(isCloudflare('2606:4700:3036::ac43:9c89'), true);
  assert.equal(isCloudflare('8.8.8.8'), false);
  assert.equal(isCloudflare('192.168.1.74'), false);
  assert.equal(isCloudflare('nonsense'), false);
});

test('through Cloudflare: the visitor’s own address', () => {
  assert.equal(clientIp(req('172.68.129.152', { 'cf-connecting-ip': '76.54.60.199' })), '76.54.60.199');
});

test('not through Cloudflare: the header is ignored (it could be forged)', () => {
  assert.equal(clientIp(req('203.0.113.9', { 'cf-connecting-ip': '1.2.3.4' })), '203.0.113.9');
});

test('a junk header falls back to the connecting address', () => {
  assert.equal(clientIp(req('172.68.129.152', { 'cf-connecting-ip': 'evil, 1.2.3.4' })), '172.68.129.152');
  assert.equal(clientIp(req('172.68.129.152')), '172.68.129.152');
});
