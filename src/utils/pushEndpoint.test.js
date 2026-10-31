const { test } = require('node:test');
const assert = require('node:assert');
const { isPushEndpoint } = require('./pushEndpoint');

test('real push services are accepted', () => {
  for (const u of [
    'https://web.push.apple.com/QGx1Abc',
    'https://fcm.googleapis.com/fcm/send/abc:def',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://wns2-par02p.notify.windows.com/w/?token=abc',
  ]) assert.equal(isPushEndpoint(u), true, u);
});

test('anything else is refused: LAN addresses, http, look-alikes, junk', () => {
  for (const u of [
    'http://fcm.googleapis.com/fcm/send/x', 'https://192.168.1.74:8123/api', 'https://100.127.227.36/x',
    'https://fcm.googleapis.com.evil.example/x', 'https://evilfcm.googleapis.com.example/x', 'https://localhost/x',
    'https://user:pw@fcm.googleapis.com/x', 'not a url', '', null, ['https://fcm.googleapis.com/x'],
  ]) assert.equal(isPushEndpoint(u), false, String(u));
});
