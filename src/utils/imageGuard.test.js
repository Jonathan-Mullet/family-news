const { test } = require('node:test');
const assert = require('node:assert');
const { imageKind, heicPixels, MAX_PIXELS } = require('./imageGuard');

const box = (type, body) => { const b = Buffer.alloc(8 + body.length); b.writeUInt32BE(b.length, 0); b.write(type, 4, 'latin1'); body.copy(b, 8); return b; };
const ispe = (w, h) => { const body = Buffer.alloc(12); body.writeUInt32BE(w, 4); body.writeUInt32BE(h, 8); return box('ispe', body); };
const heic = (...props) => Buffer.concat([box('ftyp', Buffer.from('heic\0\0\0\0mif1heic', 'latin1')), ...props]);

test('imageKind: real photos by their first bytes, not the browser’s say-so', () => {
  assert.equal(imageKind(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), 'jpeg');
  assert.equal(imageKind(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])), 'png');
  assert.equal(imageKind(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1')), 'webp');
  assert.equal(imageKind(Buffer.from('GIF89a\0\0\0\0\0\0', 'latin1')), 'gif');
  assert.equal(imageKind(heic(ispe(4032, 3024))), 'heic');
  assert.equal(imageKind(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.equal(imageKind(Buffer.from('hello')), null);
});

test('heicPixels: the largest image size declared in the file', () => {
  assert.equal(heicPixels(heic(ispe(512, 384), ispe(4032, 3024))), 4032 * 3024);
  assert.equal(heicPixels(heic()), 0, 'nothing declared');
  assert.ok(heicPixels(heic(ispe(8064, 6048))) < MAX_PIXELS, 'a 48 MP iPhone photo is fine');
  assert.ok(heicPixels(heic(ispe(40000, 40000))) > MAX_PIXELS, 'a decompression bomb is not');
});
