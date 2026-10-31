/**
 * Checks on an uploaded image before anything decodes it.
 *  - imageKind: what the file really is, from its first bytes (the browser's mimetype is just a
 *    claim). Only photo formats are accepted — not SVG, which sharp would render.
 *  - heicPixels: the image size an iPhone HEIC declares (its `ispe` boxes). heic-convert decodes
 *    the whole thing into memory, so a tiny file declaring 40000×40000 could exhaust the Pi;
 *    anything over MAX_PIXELS is refused first. sharp has its own limit (limitInputPixels).
 */
const MAX_PIXELS = 60_000_000; // a 48 MP iPhone photo (8064×6048) is ~48.8 M
const HEIC_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs', 'mif1', 'msf1']);

function imageKind(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a) return 'png';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (/^GIF8[79]a$/.test(buf.toString('latin1', 0, 6))) return 'gif';
  if (buf.toString('latin1', 4, 8) === 'ftyp' && HEIC_BRANDS.has(buf.toString('latin1', 8, 12))) return 'heic';
  return null;
}

function heicPixels(buf) {
  let max = 0;
  for (let i = buf.indexOf('ispe', 0, 'latin1'); i !== -1 && i + 16 <= buf.length; i = buf.indexOf('ispe', i + 4, 'latin1')) {
    const w = buf.readUInt32BE(i + 8); const h = buf.readUInt32BE(i + 12);
    max = Math.max(max, w * h);
  }
  return max;
}

module.exports = { imageKind, heicPixels, MAX_PIXELS };
