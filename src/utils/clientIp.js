/**
 * The visitor's address, for rate limiting. Traffic arrives Cloudflare → nginx-proxy-manager →
 * app, and NPM doesn't restore the visitor's address (it looks for X-Real-IP, which Cloudflare
 * doesn't send), so req.ip is a Cloudflare edge address shared by many visitors. Cloudflare puts
 * the real one in CF-Connecting-IP — trusted only when the hop that reached NPM is a Cloudflare
 * edge, because the router also forwards 443 straight here and a direct request could forge it.
 * Ranges: https://www.cloudflare.com/ips/ (stable for years; refresh if Cloudflare adds some).
 */
const net = require('net');

const CF_V4 = ['173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18',
  '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
  '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22'];
const CF_V6 = ['2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32'];
const cf = new net.BlockList();
for (const r of CF_V4) { const [a, p] = r.split('/'); cf.addSubnet(a, Number(p), 'ipv4'); }
for (const r of CF_V6) { const [a, p] = r.split('/'); cf.addSubnet(a, Number(p), 'ipv6'); }

const strip = (ip) => String(ip || '').replace(/^::ffff:/, '');

function isCloudflare(ip) {
  const a = strip(ip);
  const v = net.isIP(a);
  return v ? cf.check(a, v === 6 ? 'ipv6' : 'ipv4') : false;
}

function clientIp(req) {
  const hop = strip(req.ip);
  const claimed = strip(req.get('cf-connecting-ip'));
  return isCloudflare(hop) && net.isIP(claimed) ? claimed : hop;
}

module.exports = { clientIp, isCloudflare };
