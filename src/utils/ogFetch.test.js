const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isPrivateAddress } = require('./ogFetch');

// ── IPv4 private/loopback/link-local ranges ───────────────────────────────────

test('isPrivateAddress: 10/8', () => {
  assert.equal(isPrivateAddress('10.0.0.1'), true);
  assert.equal(isPrivateAddress('10.255.255.255'), true);
  assert.equal(isPrivateAddress('11.0.0.1'), false);
  assert.equal(isPrivateAddress('9.255.255.255'), false);
});

test('isPrivateAddress: 172.16/12 boundaries', () => {
  assert.equal(isPrivateAddress('172.16.0.1'), true);
  assert.equal(isPrivateAddress('172.31.255.254'), true);
  assert.equal(isPrivateAddress('172.15.255.255'), false);
  assert.equal(isPrivateAddress('172.32.0.1'), false);
});

test('isPrivateAddress: 192.168/16', () => {
  assert.equal(isPrivateAddress('192.168.1.50'), true);
  assert.equal(isPrivateAddress('192.169.1.50'), false);
  assert.equal(isPrivateAddress('192.167.1.50'), false);
});

test('isPrivateAddress: 127/8 loopback', () => {
  assert.equal(isPrivateAddress('127.0.0.1'), true);
  assert.equal(isPrivateAddress('127.255.255.255'), true);
  assert.equal(isPrivateAddress('128.0.0.1'), false);
});

test('isPrivateAddress: 169.254/16 link-local', () => {
  assert.equal(isPrivateAddress('169.254.169.254'), true); // cloud metadata endpoint
  assert.equal(isPrivateAddress('169.253.0.1'), false);
  assert.equal(isPrivateAddress('169.255.0.1'), false);
});

test('isPrivateAddress: 0/8 unspecified network', () => {
  assert.equal(isPrivateAddress('0.0.0.0'), true);
  assert.equal(isPrivateAddress('0.1.2.3'), true);
});

test('isPrivateAddress: public IPv4 allowed', () => {
  assert.equal(isPrivateAddress('8.8.8.8'), false);
  assert.equal(isPrivateAddress('93.184.216.34'), false);
  assert.equal(isPrivateAddress('1.1.1.1'), false);
});

// ── IPv6 ──────────────────────────────────────────────────────────────────────

test('isPrivateAddress: IPv6 loopback and unspecified', () => {
  assert.equal(isPrivateAddress('::1'), true);
  assert.equal(isPrivateAddress('::'), true);
});

test('isPrivateAddress: fc00::/7 unique-local', () => {
  assert.equal(isPrivateAddress('fc00::1'), true);
  assert.equal(isPrivateAddress('fd12:3456:789a::1'), true);
  assert.equal(isPrivateAddress('fe00::1'), false); // just past fdff
  assert.equal(isPrivateAddress('fbff::1'), false); // just before fc00
});

test('isPrivateAddress: fe80::/10 link-local', () => {
  assert.equal(isPrivateAddress('fe80::1'), true);
  assert.equal(isPrivateAddress('febf::1'), true);
  assert.equal(isPrivateAddress('fec0::1'), false); // just past febf
  assert.equal(isPrivateAddress('fe7f::1'), false); // just before fe80
});

test('isPrivateAddress: link-local with zone index', () => {
  assert.equal(isPrivateAddress('fe80::1%eth0'), true);
});

test('isPrivateAddress: IPv4-mapped IPv6 (dotted and hex forms)', () => {
  assert.equal(isPrivateAddress('::ffff:10.0.0.1'), true);
  assert.equal(isPrivateAddress('::ffff:127.0.0.1'), true);
  assert.equal(isPrivateAddress('::ffff:8.8.8.8'), false);
  assert.equal(isPrivateAddress('::ffff:a00:1'), true); // hex form of 10.0.0.1
  assert.equal(isPrivateAddress('::ffff:808:808'), false); // hex form of 8.8.8.8
});

test('isPrivateAddress: public IPv6 allowed', () => {
  assert.equal(isPrivateAddress('2606:4700:4700::1111'), false);
  assert.equal(isPrivateAddress('2001:4860:4860::8888'), false);
});

// ── Fail-closed behavior ──────────────────────────────────────────────────────

test('isPrivateAddress: non-IP input fails closed (treated as private)', () => {
  assert.equal(isPrivateAddress(''), true);
  assert.equal(isPrivateAddress('   '), true);
  assert.equal(isPrivateAddress(null), true);
  assert.equal(isPrivateAddress(undefined), true);
  assert.equal(isPrivateAddress('example.com'), true);
  assert.equal(isPrivateAddress('999.1.1.1'), true);
  assert.equal(isPrivateAddress('not-an-ip'), true);
});
