// Local stand-ins for trying agencies' own addresses without real DNS, Dokploy or Let's Encrypt (see
// docs/custom-domains.md, "Trying it locally"). Starts three things:
//   DNS on 127.0.0.1:5399     answers A, AAAA and CNAME from <dir>/zones.json (edit it while it runs)
//   Dokploy on 127.0.0.1:3999 POST /api/domain.create, POST /api/domain.delete, GET /api/domain.byApplicationId
//                             (key "test-key", application "app-123"); /mock/state lists domains, /mock/fail?on=1 breaks it
//   https on 127.0.0.1:8443   Traefik once the certificate is there: answers /api/health for <dir>/cert.pem's names
// Run: node scripts/custom-domains-mock.mjs [dir] [address]   (default dir data/mock-domains, address portal.agency.test)
import dgram from 'node:dgram';
import { createServer } from 'node:http';
import { createServer as createHttps } from 'node:https';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'data/mock-domains';
const address = process.argv[3] ?? 'portal.agency.test';
mkdirSync(dir, { recursive: true });
const zonesFile = join(dir, 'zones.json');
if (!existsSync(zonesFile)) writeFileSync(zonesFile, JSON.stringify({ 'custom.sprint2go.com': { A: ['203.0.113.10'] } }, null, 2) + '\n');

/* ---------- certificates: a local CA (trust it with NODE_EXTRA_CA_CERTS) and a certificate for the address ---------- */
const f = (n) => join(dir, n);
if (!existsSync(f('cert.pem'))) {
  const ssl = (...a) => execFileSync('openssl', a, { stdio: 'ignore' });
  ssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', f('ca.key'), '-out', f('ca.pem'), '-days', '30', '-subj', '/CN=sprint2go test CA');
  ssl('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', f('key.pem'), '-out', f('cert.csr'), '-subj', `/CN=${address}`);
  writeFileSync(f('ext.cnf'), `subjectAltName=DNS:${address}\nbasicConstraints=CA:FALSE\n`);
  ssl('x509', '-req', '-in', f('cert.csr'), '-CA', f('ca.pem'), '-CAkey', f('ca.key'), '-CAcreateserial', '-out', f('cert.pem'), '-days', '30', '-extfile', f('ext.cnf'));
}
const stamp = () => new Date().toISOString().slice(11, 19);

/* ---------- DNS ---------- */
const TYPES = { 1: 'A', 5: 'CNAME', 2: 'NS', 28: 'AAAA' };
const encName = (n) => Buffer.concat([...n.replace(/\.$/, '').split('.').filter(Boolean).map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l)])), Buffer.from([0])]);
function rr(name, type, data) {
  let rdata;
  if (type === 'A') rdata = Buffer.from(data.split('.').map(Number));
  else if (type === 'AAAA') {
    const [a, b] = data.includes('::') ? data.split('::') : [data, null];
    const ah = a ? a.split(':') : [];
    const bh = b ? b.split(':') : [];
    const full = b === null ? ah : [...ah, ...Array(8 - ah.length - bh.length).fill('0'), ...bh];
    rdata = Buffer.alloc(16);
    full.forEach((h, i) => rdata.writeUInt16BE(parseInt(h || '0', 16), i * 2));
  } else rdata = encName(data);
  const head = Buffer.alloc(10);
  head.writeUInt16BE({ A: 1, CNAME: 5, AAAA: 28 }[type], 0);
  head.writeUInt16BE(1, 2);
  head.writeUInt32BE(30, 4);
  head.writeUInt16BE(rdata.length, 8);
  return Buffer.concat([encName(name), head, rdata]);
}
const dns = dgram.createSocket('udp4');
dns.on('message', (msg, from) => {
  let zones = {};
  try {
    zones = JSON.parse(readFileSync(zonesFile, 'utf8'));
  } catch {
    /* half-written file: no answers this time */
  }
  let off = 12;
  const labels = [];
  while (msg[off]) (labels.push(msg.subarray(off + 1, off + 1 + msg[off]).toString()), (off += msg[off] + 1));
  off++;
  const want = TYPES[msg.readUInt16BE(off)];
  const name = labels.join('.').toLowerCase();
  const z = zones[name];
  const answers = [];
  if (z && want === 'CNAME' && z.CNAME) answers.push(rr(name, 'CNAME', z.CNAME));
  else if (z && (want === 'A' || want === 'AAAA') && z.CNAME) {
    answers.push(rr(name, 'CNAME', z.CNAME));
    for (const v of zones[z.CNAME.toLowerCase()]?.[want] ?? []) answers.push(rr(z.CNAME, want, v));
  } else if (z && want && z[want]) for (const v of z[want]) answers.push(rr(name, want, v));
  const exists = !!z || Object.keys(zones).some((k) => k.endsWith('.' + name));
  const head = Buffer.alloc(12);
  msg.copy(head, 0, 0, 2);
  head.writeUInt16BE(0x8180 | (exists ? 0 : 3), 2); // a response; NXDOMAIN for names nobody has
  head.writeUInt16BE(1, 4);
  head.writeUInt16BE(answers.length, 6);
  dns.send(Buffer.concat([head, msg.subarray(12, off + 4), ...answers]), from.port, from.address);
});
dns.bind(5399, '127.0.0.1', () => console.log(`DNS on 127.0.0.1:5399 (records in ${zonesFile})`));

/* ---------- Dokploy ---------- */
const KEY = 'test-key';
const APP = 'app-123';
const domains = new Map();
let failing = false;
createServer(async (req, res) => {
  let raw = '';
  for await (const c of req) raw += c;
  const url = new URL(req.url, 'http://x');
  const send = (s, b) => (res.writeHead(s, { 'content-type': 'application/json' }), res.end(JSON.stringify(b)));
  if (url.pathname === '/mock/fail') return ((failing = url.searchParams.get('on') === '1'), send(200, { failing }));
  if (url.pathname === '/mock/state') return send(200, [...domains.values()]);
  console.log(`${stamp()} dokploy ${req.method} ${url.pathname}${url.search} ${raw}`);
  if (req.headers['x-api-key'] !== KEY) return send(401, { message: 'Unauthorized' });
  if (failing) return send(500, { message: 'Internal error (mock)' });
  if (url.pathname === '/api/domain.create' && req.method === 'POST') {
    const b = JSON.parse(raw || '{}');
    if (!b.host || b.applicationId !== APP || b.certificateType !== 'letsencrypt' || b.https !== true) return send(400, { message: 'Input validation failed' });
    const d = { domainId: randomBytes(10).toString('hex'), host: b.host, https: b.https, port: b.port, path: b.path, certificateType: b.certificateType, applicationId: APP, domainType: b.domainType ?? 'application', createdAt: new Date().toISOString() };
    domains.set(d.domainId, d);
    return send(200, d);
  }
  if (url.pathname === '/api/domain.delete' && req.method === 'POST') {
    const d = domains.get(JSON.parse(raw || '{}').domainId);
    if (!d) return send(404, { message: 'Domain not found' });
    domains.delete(d.domainId);
    return send(200, d);
  }
  if (url.pathname === '/api/domain.byApplicationId' && req.method === 'GET') return url.searchParams.get('applicationId') === APP ? send(200, [...domains.values()]) : send(404, { message: 'Application not found' });
  send(404, { message: 'Not found' });
}).listen(3999, '127.0.0.1', () => console.log('Dokploy on 127.0.0.1:3999'));

/* ---------- https (what Traefik serves once the certificate is issued) ---------- */
createHttps({ key: readFileSync(f('key.pem')), cert: readFileSync(f('cert.pem')) }, (req, res) => {
  console.log(`${stamp()} https ${req.headers.host}${req.url}`);
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: true, at: new Date().toISOString() }));
}).listen(8443, '127.0.0.1', () => console.log(`https on 127.0.0.1:8443 for ${address} (trust ${f('ca.pem')})`));
