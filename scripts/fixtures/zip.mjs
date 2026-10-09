// A tiny zip writer for the import tests (scripts/import-tests.mjs) and the fixture zips in this folder. It can also
// write zips that lie: a file that claims to be smaller than it unpacks to (a zip bomb), or names that point outside
// the zip ("../evil.txt", "/etc/passwd"), which the server must refuse.
import { crc32, deflateRawSync } from 'node:zlib';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const dos = (d) => ({
  time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2),
  date: ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
});

/**
 * entries: [{ name, data (Buffer or string), store (no compression), claim (the unpacked size to write in the zip,
 * instead of the real one), dir }]. Returns the zip as a Buffer.
 */
export function makeZip(entries, at = new Date(Date.UTC(2026, 9, 1, 9, 30))) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const { time, date } = dos(at);
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const raw = e.dir ? Buffer.alloc(0) : Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data ?? '', 'utf8');
    const method = e.dir || e.store ? 0 : 8;
    const body = method === 8 ? deflateRawSync(raw) : raw;
    const crc = crc32(raw) >>> 0;
    const usize = e.claim ?? raw.length;
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0800, 6);
    head.writeUInt16LE(method, 8);
    head.writeUInt16LE(time, 10);
    head.writeUInt16LE(date, 12);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(body.length, 18);
    head.writeUInt32LE(usize, 22);
    head.writeUInt16LE(name.length, 26);
    head.writeUInt16LE(0, 28);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(method, 10);
    cen.writeUInt16LE(time, 12);
    cen.writeUInt16LE(date, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(body.length, 20);
    cen.writeUInt32LE(usize, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(e.dir ? 0x10 : 0, 38);
    cen.writeUInt32LE(offset, 42);
    locals.push(head, name, body);
    centrals.push(cen, name);
    offset += head.length + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/** Every file under a folder as zip entries (paths inside the zip use "/"), with `swap` applied to text files. */
export function folderEntries(dir, prefix = '', swap = (s) => s) {
  const out = [];
  const walk = (d) => {
    for (const f of readdirSync(d).sort()) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else {
        const name = prefix + relative(dir, p).split(sep).join('/');
        const data = /\.(json|txt|html|md|csv)$/.test(f) ? swap(readFileSync(p, 'utf8')) : readFileSync(p);
        out.push({ name, data });
      }
    }
  };
  walk(dir);
  return out;
}

const here = new URL('.', import.meta.url).pathname;

/** The Slack export fixture as a zip; its file links point at `files` (a local server in the tests). */
export const slackZip = (files = 'https://files.example.test') => makeZip(folderEntries(join(here, 'slack-export'), '', (s) => s.replaceAll('{FILES}', files)));

/** The Takeout fixture as a zip: Drive (with a "big" file of 20 KB), and a Mail part that's left out. */
export function takeoutZip() {
  const entries = folderEntries(join(here, 'takeout'));
  entries.push({ name: 'Takeout/Drive/Videos/Launch video.mp4', data: Buffer.alloc(20 * 1024, 7) });
  entries.push({ name: 'Takeout/Drive/Empty folder/', dir: true });
  return makeZip(entries);
}

/** Zips the server must refuse, by what's wrong with them. */
export const malicious = {
  traversal: () =>
    makeZip([
      { name: 'Takeout/Drive/ok.txt', data: 'fine' },
      { name: '../../evil.txt', data: 'gotcha' },
    ]),
  absolute: () => makeZip([{ name: '/etc/passwd', data: 'root:x:0:0' }]),
  windows: () => makeZip([{ name: 'C:\\Windows\\evil.dll', data: 'MZ' }]),
  hidden: () => makeZip([{ name: 'Takeout/Drive/a/../../../evil.txt', data: 'gotcha' }]),
  /** One file that says it's 1 KB and unpacks to 20 MB of zeros (about 20 KB packed). */
  bomb: () =>
    makeZip([
      { name: 'Takeout/Drive/readme.txt', data: 'hello' },
      { name: 'Takeout/Drive/zeros.bin', data: Buffer.alloc(20 * 1024 * 1024), claim: 1024 },
    ]),
  /** Says honestly that it's 20 MB unpacked: over a 5 MB limit, refused before anything is unpacked. */
  huge: () => makeZip([{ name: 'Takeout/Drive/zeros.bin', data: Buffer.alloc(20 * 1024 * 1024) }]),
  /** More files than the limit allows (set S2G_IMPORT_MAX_FILES below n to try it; at most 65,535 here). */
  many: (n) => makeZip(Array.from({ length: n }, (_, i) => ({ name: `Takeout/Drive/f${i}.txt`, data: 'x', store: true }))),
};

// Run directly to get the fixture zips to try in the app (Settings, Import):
//   node scripts/fixtures/zip.mjs <folder> [where Slack's file links point]
if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const { mkdirSync, writeFileSync, copyFileSync } = await import('node:fs');
  const out = process.argv[2] ?? join(here, 'out');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'slack-export.zip'), slackZip(process.argv[3]));
  writeFileSync(join(out, 'takeout-drive.zip'), takeoutZip());
  copyFileSync(join(here, 'trello-board.json'), join(out, 'trello-board.json'));
  for (const [name, make] of Object.entries(malicious)) writeFileSync(join(out, `malicious-${name}.zip`), make(300));
  console.log(`Fixture zips in ${out}`);
}
