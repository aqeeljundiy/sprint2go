// Reading zip files people upload (a Slack export, a Google Takeout), carefully. The list of files comes from the zip's
// own index (the central directory), and before anything is unpacked: every name is checked (no absolute paths, no
// drive letters, no ".."), and the number of files and their total size are capped. Each file is then unpacked as a
// stream that stops the moment it grows past the size it claimed, so a zip bomb that lies about its sizes stops early.
// Nothing is ever written to disk under a name taken from the zip.
import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { Transform, type Readable } from 'node:stream';
import { crc32, createInflateRaw } from 'node:zlib';

/** A sentence to show. `why`: 'bomb' when a file grew past what the zip said (the whole zip is suspect then). */
export class ZipError extends Error {
  why: 'bomb' | 'damaged' | 'locked' | 'other';
  constructor(message: string, why: 'bomb' | 'damaged' | 'locked' | 'other' = 'other') {
    super(message);
    this.why = why;
  }
}

export interface ZipEntry {
  name: string; // a clean relative path ("Takeout/Drive/Plans/q4.docx"); folders end without a slash
  dir: boolean;
  size: number; // unpacked, as the zip says
  csize: number; // packed
  method: number; // 0 stored, 8 deflate
  crc: number;
  offset: number; // of its local header
  encrypted: boolean;
  modified: Date;
}

export interface ZipLimits {
  maxFiles: number;
  maxTotal: number; // bytes, unpacked, all files together
}

const EOCD = 0x06054b50;
const EOCD64 = 0x06064b50;
const EOCD64_LOC = 0x07064b50;
const CEN = 0x02014b50;
const LOC = 0x04034b50;
const MAX_INDEX = 128 * 1024 * 1024; // the central directory itself (about a million files)

/**
 * A path from a zip as a clean relative path, or null when it points outside the zip: absolute ("/etc/passwd",
 * "C:\\x"), or with a ".." part anywhere. Backslashes count as separators; "." and empty parts are dropped.
 */
export function cleanZipPath(raw: string): string | null {
  if (!raw || raw.includes('\0')) return null;
  const s = raw.replace(/\\/g, '/');
  if (s.startsWith('/') || /^[a-zA-Z]:/.test(s) || s.startsWith('~')) return null;
  const parts: string[] = [];
  for (const p of s.split('/')) {
    if (p === '' || p === '.') continue;
    if (p === '..') return null;
    parts.push(p);
  }
  return parts.join('/');
}

const big = (b: Buffer, at: number) => {
  const n = b.readBigUInt64LE(at);
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new ZipError('This zip says it’s bigger than any real file. It can’t be imported.');
  return Number(n);
};
const dosDate = (date: number, time: number) => {
  const d = new Date(Date.UTC(1980 + (date >> 9), ((date >> 5) & 15) - 1, date & 31, time >> 11, (time >> 5) & 63, (time & 31) * 2));
  return Number.isNaN(d.getTime()) ? new Date(0) : d;
};

/** The zip's files, checked against the limits. Throws a ZipError with a sentence to show. */
export async function readZip(path: string, limits: ZipLimits): Promise<ZipEntry[]> {
  const fh = await open(path, 'r');
  try {
    const { size } = await fh.stat();
    if (size < 22) throw new ZipError('This isn’t a zip file, or it didn’t finish downloading.');
    const read = async (pos: number, len: number) => {
      if (pos < 0 || len < 0 || pos + len > size) throw new ZipError('This zip is damaged or didn’t finish downloading.');
      const b = Buffer.alloc(len);
      const { bytesRead } = await fh.read(b, 0, len, pos);
      if (bytesRead !== len) throw new ZipError('This zip is damaged or didn’t finish downloading.');
      return b;
    };
    // The end record sits in the last 22 bytes plus a comment of up to 64 KB.
    const tailLen = Math.min(size, 22 + 0xffff);
    const tail = await read(size - tailLen, tailLen);
    let at = -1;
    for (let i = tail.length - 22; i >= 0; i--)
      if (tail.readUInt32LE(i) === EOCD) {
        at = i;
        break;
      }
    if (at < 0) throw new ZipError('This isn’t a zip file, or it didn’t finish downloading.');
    const eocdPos = size - tailLen + at;
    let disk = tail.readUInt16LE(at + 4);
    let count = tail.readUInt16LE(at + 10);
    let cdSize = tail.readUInt32LE(at + 12);
    let cdOffset = tail.readUInt32LE(at + 16);
    if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      // Zip64: big zips (Takeout's are) keep the real numbers in a second end record.
      if (eocdPos < 20) throw new ZipError('This zip is damaged.');
      const loc = await read(eocdPos - 20, 20);
      if (loc.readUInt32LE(0) !== EOCD64_LOC) throw new ZipError('This zip is damaged.');
      const rec = await read(big(loc, 8), 56);
      if (rec.readUInt32LE(0) !== EOCD64) throw new ZipError('This zip is damaged.');
      disk = rec.readUInt32LE(16);
      count = big(rec, 32);
      cdSize = big(rec, 40);
      cdOffset = big(rec, 48);
    }
    if (disk !== 0) throw new ZipError('This zip is split into parts. Upload each part as its own zip.');
    if (count > limits.maxFiles) throw new ZipError(`This zip has ${count.toLocaleString('en')} files; at most ${limits.maxFiles.toLocaleString('en')} at a time.`);
    if (cdSize > MAX_INDEX || cdOffset + cdSize > size) throw new ZipError('This zip is damaged.');
    const cd = await read(cdOffset, cdSize);
    const out: ZipEntry[] = [];
    let total = 0;
    let p = 0;
    const utf8 = new TextDecoder('utf-8');
    for (let i = 0; i < count; i++) {
      if (p + 46 > cd.length || cd.readUInt32LE(p) !== CEN) throw new ZipError('This zip is damaged.');
      const flags = cd.readUInt16LE(p + 8);
      const method = cd.readUInt16LE(p + 10);
      const time = cd.readUInt16LE(p + 12);
      const date = cd.readUInt16LE(p + 14);
      const crc = cd.readUInt32LE(p + 16);
      let csize = cd.readUInt32LE(p + 20);
      let usize = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      let offset = cd.readUInt32LE(p + 42);
      const end = p + 46 + nameLen + extraLen + commentLen;
      if (end > cd.length) throw new ZipError('This zip is damaged.');
      const rawName = utf8.decode(cd.subarray(p + 46, p + 46 + nameLen));
      // Zip64 sizes and offset, for the fields marked 0xFFFFFFFF, in this order.
      let e = p + 46 + nameLen;
      const extraEnd = e + extraLen;
      while (e + 4 <= extraEnd) {
        const id = cd.readUInt16LE(e);
        const len = cd.readUInt16LE(e + 2);
        if (id === 0x0001) {
          let q = e + 4;
          const need = (n: number) => {
            if (q + n > e + 4 + len) throw new ZipError('This zip is damaged.');
          };
          if (usize === 0xffffffff) (need(8), (usize = big(cd, q)), (q += 8));
          if (csize === 0xffffffff) (need(8), (csize = big(cd, q)), (q += 8));
          if (offset === 0xffffffff) (need(8), (offset = big(cd, q)), (q += 8));
        }
        e += 4 + len;
      }
      p = end;
      const name = cleanZipPath(rawName);
      if (name === null) throw new ZipError(`This zip has a file that points outside it (“${rawName.slice(0, 80)}”), so it can’t be imported.`);
      const dir = rawName.endsWith('/') || rawName.endsWith('\\');
      if (!name) continue; // "./" and the like
      if (!dir) {
        total += usize;
        if (total > limits.maxTotal) throw new ZipError(`Unpacked, this zip would be over ${Math.round(limits.maxTotal / 1024 ** 2).toLocaleString('en')} MB, more than one import takes.`);
      }
      if (offset >= size) throw new ZipError('This zip is damaged.');
      out.push({ name, dir, size: dir ? 0 : usize, csize: dir ? 0 : csize, method, crc, offset, encrypted: !!(flags & 1), modified: dosDate(date, time) });
    }
    return out;
  } finally {
    await fh.close();
  }
}

/**
 * One file from the zip, unpacked as a stream. It fails (with a ZipError) if the file is encrypted or packed in a way
 * we can't open, if it grows past the size the zip claims (or past `max`), or if it doesn't match its checksum.
 */
export async function openEntry(path: string, e: ZipEntry, max = Infinity): Promise<Readable> {
  if (e.dir) throw new ZipError(`${e.name} is a folder.`);
  if (e.encrypted) throw new ZipError(`${e.name} is protected with a password.`, 'locked');
  if (e.method !== 0 && e.method !== 8) throw new ZipError(`${e.name} is packed in a way we can’t open.`, 'locked');
  if (e.size > max) throw new ZipError(`${e.name} is too big.`);
  const fh = await open(path, 'r');
  let dataAt: number;
  try {
    const head = Buffer.alloc(30);
    const { bytesRead } = await fh.read(head, 0, 30, e.offset);
    if (bytesRead !== 30 || head.readUInt32LE(0) !== LOC) throw new ZipError('This zip is damaged.', 'damaged');
    dataAt = e.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
  } finally {
    await fh.close();
  }
  const limit = Math.min(e.size, max);
  let seen = 0;
  let sum = 0;
  const guard = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      seen += chunk.length;
      if (seen > limit) return cb(new ZipError(`${e.name} is bigger than this zip says, so the zip can’t be trusted. It can’t be imported.`, 'bomb'));
      sum = crc32(chunk, sum);
      cb(null, chunk);
    },
    flush(cb) {
      if (seen !== e.size) return cb(new ZipError(`${e.name} is damaged in this zip.`, 'damaged'));
      if ((sum >>> 0) !== (e.crc >>> 0)) return cb(new ZipError(`${e.name} is damaged in this zip.`, 'damaged'));
      cb();
    },
  });
  if (e.csize === 0) {
    queueMicrotask(() => guard.end());
    return guard;
  }
  const raw = createReadStream(path, { start: dataAt, end: dataAt + e.csize - 1 });
  const src = e.method === 8 ? raw.pipe(createInflateRaw()) : raw;
  const fail = (err: Error) => guard.destroy(err instanceof ZipError ? err : new ZipError(`${e.name} is damaged in this zip.`, 'damaged'));
  raw.on('error', fail);
  if (src !== raw) src.on('error', fail);
  guard.on('close', () => (raw.destroy(), src.destroy()));
  src.pipe(guard);
  return guard;
}

/** One file from the zip as text (JSON files), up to `max` bytes. */
export async function readEntryText(path: string, e: ZipEntry, max: number): Promise<string> {
  if (e.size > max) throw new ZipError(`${e.name} is over ${Math.round(max / 1024 ** 2)} MB, too big to read.`);
  const s = await openEntry(path, e, max);
  const chunks: Buffer[] = [];
  for await (const c of s) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}
