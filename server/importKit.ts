// What the three import sources share (server/imports.ts runs them): the limits, matching people from another app to
// members here, the context a source reads and runs in, and saving files: streamed from a zip or fetched from a link
// (never into a private network), into data/files like any upload.
import { createWriteStream, existsSync, rmSync, statSync, unlinkSync } from 'node:fs';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { lookup, type LookupAddress } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import type { IncomingMessage } from 'node:http';
import * as db from './db.ts';
import * as billing from './billing.ts';
import { isPrivateAddress } from './safeFetch.ts';
import type { ImportChoices, ImportPerson, ImportPreview } from '../src/importTypes.ts';

/** A problem with what was uploaded or picked, in a sentence for the admin. */
export class ImportError extends Error {}

const MB = 1024 * 1024;
const HOUR = 3_600_000;
/** The limits, read when used (the server loads .env after its modules). Tests set them low. */
export const limits = () => ({
  upload: Math.max(1, Number(process.env.S2G_IMPORT_MAX_MB) || 4096) * MB, // the upload itself
  unzipped: Math.max(1, Number(process.env.S2G_IMPORT_MAX_UNZIPPED_MB) || 16384) * MB, // everything in a zip, unpacked
  files: Math.max(1, Number(process.env.S2G_IMPORT_MAX_FILES) || 100_000), // files in a zip
  json: Math.max(1, Number(process.env.S2G_IMPORT_MAX_JSON_MB) || 100) * MB, // one JSON file (a Trello board, a Slack day)
});
export function roomOf(wsId: string) {
  const r = billing.storageRoom(wsId);
  const ws = db.getDoc('workspaces', wsId) as any;
  return { left: r.left, total: r.total, askOverMb: Number(ws?.storage?.askOver ?? 500) };
}
/** On Free, how many more people the company can have (5 in all); null on paid plans. */
export function seatsLeft(ws: any): number | null {
  if (billing.planOf(ws).tier !== 'free') return null;
  return Math.max(0, 5 - billing.teamSize(ws));
}

/* ---------- people: matched, invited, mapped or kept as a name ---------- */

const norm = (s: unknown) =>
  String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
/** The members of a company as people to match against. */
export function membersOf(ws: any): { id: string; name: string; email: string }[] {
  return (ws.members ?? [])
    .map((m: any) => db.getDoc('users', m.userId) as any)
    .filter((u: any) => u && !u.deletedAt)
    .map((u: any) => ({ id: u.id, name: String(u.name ?? ''), email: String(u.email ?? '').toLowerCase() }));
}
/** The member someone from the export is: by email first, then by their full name (only when one member has it). */
export function matchPerson(members: { id: string; name: string; email: string }[], p: { email?: string; names: string[] }): { id: string; how: 'email' | 'name' } | null {
  const email = String(p.email ?? '').toLowerCase();
  if (email) {
    const m = members.find((x) => x.email === email);
    if (m) return { id: m.id, how: 'email' };
  }
  for (const n of p.names.map(norm).filter((x) => x.length > 2)) {
    const hits = members.filter((x) => norm(x.name) === n || (x.email && x.email.split('@')[0] === n));
    if (hits.length === 1) return { id: hits[0].id, how: 'name' };
  }
  return null;
}
/** Suggestions for the people not matched: invite those who can be (as many as the plan has room for), else a name. */
export function suggest(people: Omit<ImportPerson, 'suggested'>[], seats: number | null): ImportPerson[] {
  let room = seats ?? Infinity;
  return people.map((p) => ({ ...p, suggested: p.match ? 'map' : p.canInvite && room-- > 0 ? 'invite' : 'former' }));
}

/** Who someone from the export becomes here: a member's id, or a name kept on what they wrote. */
export type Resolved = { userId: string; name: string } | { userId?: undefined; name: string };

/* ---------- what a source gets while it reads and while it runs ---------- */

export interface RunCtx {
  id: string;
  ws: any;
  me: string;
  file: string; // the upload on disk
  preview: ImportPreview;
  choices: ImportChoices;
  people: Map<string, Resolved>;
  /** New documents: recorded for Undo first, then saved, then sent to everyone who may see them. */
  add: (coll: string, docs: db.Doc[]) => void;
  /** A file saved under data/files (already on disk at db.filePath(id)), recorded for Undo. */
  addFile: (f: { id: string; name: string; type: string; size: number }) => void;
  progress: (phase: string, done: number, total: number) => void;
  missing: (name: string, where: string, why: string, kind?: 'conversation') => void;
  made: (what: string, n: number) => void;
  room: () => number; // storage left now, in bytes
  maxFile: () => number; // the largest single file
  breathe: () => Promise<void>; // lets the server answer others between batches
}

export interface AnalyzeCtx {
  file: string;
  ws: any;
  me: string;
  progress: (phase: string, done: number, total: number) => void;
  members: { id: string; name: string; email: string }[];
  seats: number | null;
  room: { left: number; total: number; askOverMb: number };
}

/* ---------- fetching a file from the internet (Slack's file links), to disk ---------- */

const allowPrivate = () => process.env.S2G_ALLOW_PRIVATE_FETCH === '1' && process.env.NODE_ENV !== 'production';
function guardedLookup(hostname: string, options: { all?: boolean }, cb: (err: NodeJS.ErrnoException | null, address?: string | LookupAddress[], family?: number) => void) {
  lookup(hostname, { all: true, verbatim: true }, (err, addrs) => {
    if (err) return cb(err);
    const ok = allowPrivate() ? addrs : addrs.filter((a) => !isPrivateAddress(a.address));
    if (!ok.length) return cb(Object.assign(new Error('private address'), { code: 'S2G_PRIVATE' }));
    if (options?.all) cb(null, ok);
    else cb(null, ok[0].address, ok[0].family);
  });
}

/**
 * Downloads a public address into `dest`, never into a private network (checked on the address connected to, and on
 * each redirect), stopping past `max` bytes or after `timeoutMs`. A page asking to sign in counts as a failure.
 * Resolves with the size and type, or rejects with a few words on why.
 */
export async function download(raw: string, dest: string, max: number, { timeoutMs = 120_000, html = false } = {}): Promise<{ size: number; type: string }> {
  let url = raw;
  const deadline = Date.now() + timeoutMs;
  for (let hop = 0; hop <= 4; hop++) {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      throw new Error('its link is broken');
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('its link isn’t a web address');
    const host = u.hostname.replace(/^\[|\]$/g, '');
    if (!allowPrivate() && ((/^[\d.:]+$/.test(host) && isPrivateAddress(host)) || /^localhost$|\.localhost$|\.local$|\.internal$/i.test(host))) throw new Error('its link points inside a private network');
    const res = await new Promise<IncomingMessage>((resolve, reject) => {
      const left = deadline - Date.now();
      if (left <= 0) return reject(new Error('it took too long'));
      const req = (u.protocol === 'https:' ? https : http).request(u, { method: 'GET', lookup: guardedLookup as never, headers: { 'user-agent': 'sprint2go-import/1.0' }, timeout: left }, resolve);
      req.on('timeout', () => req.destroy(new Error('it took too long')));
      req.on('error', (e: NodeJS.ErrnoException) => reject(new Error(e.code === 'S2G_PRIVATE' ? 'its link points inside a private network' : e.message === 'it took too long' ? e.message : 'its server didn’t answer')));
      req.end();
    });
    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400 && res.headers.location) {
      res.resume();
      url = new URL(res.headers.location, url).toString();
      continue;
    }
    if (status === 401 || status === 403) (res.resume(), fail('it asks for a sign-in'));
    if (status === 404 || status === 410) (res.resume(), fail('it’s gone from there'));
    if (status < 200 || status >= 300) (res.resume(), fail(`its server answered with an error (${status})`));
    const type = String(res.headers['content-type'] ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (type === 'text/html' && !html) (res.resume(), fail('it asks for a sign-in'));
    if (Number(res.headers['content-length'] ?? 0) > max) (res.resume(), fail('it’s bigger than allowed'));
    const out = createWriteStream(dest);
    let size = 0;
    try {
      const timer = setTimeout(() => res.destroy(new Error('it took too long')), Math.max(1, deadline - Date.now()));
      try {
        for await (const c of res) {
          size += (c as Buffer).length;
          if (size > max) throw new Error('it’s bigger than allowed');
          if (!out.write(c)) await once(out, 'drain');
        }
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      res.destroy();
      await new Promise<void>((done) => out.end(done));
      rmSync(dest, { force: true });
      throw e instanceof Error && /^it|^its/.test(e.message) ? e : new Error('the download broke off');
    }
    await new Promise<void>((done) => out.end(done));
    return { size, type };
  }
  throw new Error('its link redirects too many times');
}
const fail = (why: string): never => {
  throw new Error(why);
};

export const mbText = (n: number) => (n >= 1024 ** 3 ? `${+(n / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(n / MB))} MB`);

/* ---------- shared bits for the sources ---------- */

/** Type by file name, for files that arrive without one (from a zip). */
const TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  rtf: 'application/rtf',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  html: 'text/html',
  htm: 'text/html',
  json: 'application/json',
  xml: 'application/xml',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  avif: 'image/avif',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  m4v: 'video/mp4',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  aac: 'audio/aac',
  zip: 'application/zip',
  rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed',
  gz: 'application/gzip',
  key: 'application/vnd.apple.keynote',
  pages: 'application/vnd.apple.pages',
  numbers: 'application/vnd.apple.numbers',
};
export const typeOf = (name: string, given?: string) => (given && given !== 'application/octet-stream' ? given : (TYPES[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream'));
export const newId = (prefix: string) => `${prefix}${randomBytes(8).toString('hex')}`;
/** A new id for a file under data/files (the shape /api/files/<id> serves). */
export const fileId = () => randomBytes(16).toString('hex');

/** Streams from a zip entry (or any stream) into a new file under data/files. Returns its id and size. */
export async function saveStream(src: AsyncIterable<Buffer> & { destroy?: (e?: Error) => void }, max: number): Promise<{ id: string; size: number }> {
  const id = fileId();
  const path = db.filePath(id);
  const out = createWriteStream(path);
  let size = 0;
  try {
    for await (const c of src) {
      size += c.length;
      if (size > max) throw new ImportError('too big');
      if (!out.write(c)) await once(out, 'drain');
    }
  } catch (e) {
    src.destroy?.();
    await new Promise<void>((done) => out.end(done));
    rmSync(path, { force: true });
    throw e;
  }
  await new Promise<void>((done) => out.end(done));
  return { id, size };
}

/** Removes a file saved for an import that then wasn't kept. */
export const dropFile = (id: string) => {
  try {
    unlinkSync(db.filePath(id));
  } catch {
    /* gone */
  }
};
/** Size of an upload on disk (for the analysis to say how big it was). */
export const sizeOf = (path: string) => (existsSync(path) ? statSync(path).size : 0);
