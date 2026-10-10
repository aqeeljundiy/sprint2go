// Mail attachments, the rules both sides share (the app and the server import this file, so it has no DOM and no
// words to show): what kind of file it is, what can be previewed, which types are refused as Gmail refuses them, which
// ones get a warning, the 25 MB an email can carry, and every attachment across someone's mail for the Files view and
// for search (`has:attachment`, `filename:`).
import type { Attachment, Message, Thread } from './types';

/** What an attachment is, for its icon, the Files view's filter and how it's previewed. */
export type FileKind = 'image' | 'pdf' | 'doc' | 'sheet' | 'slides' | 'text' | 'video' | 'audio' | 'archive' | 'other';

export const extOf = (name: string) => {
  const m = /\.([a-z0-9]{1,10})$/i.exec(String(name ?? '').trim());
  return m ? m[1].toLowerCase() : '';
};

const IMAGE = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'heic', 'heif', 'svg', 'ico'];
const DOC = ['doc', 'docx', 'docm', 'odt', 'rtf', 'pages'];
const SHEET = ['xls', 'xlsx', 'xlsm', 'ods', 'csv', 'tsv', 'numbers'];
const SLIDES = ['ppt', 'pptx', 'pptm', 'odp', 'key'];
const TEXT = ['txt', 'md', 'log', 'json', 'xml', 'yaml', 'yml', 'ini', 'cfg', 'conf', 'eml', 'ics', 'vcf'];
const VIDEO = ['mp4', 'mov', 'webm', 'mkv', 'm4v', 'avi'];
const AUDIO = ['mp3', 'm4a', 'wav', 'ogg', 'oga', 'aac', 'flac', 'opus'];
const ARCHIVE = ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz'];

export function fileKind(name: string, type = ''): FileKind {
  const ext = extOf(name);
  const mime = String(type).toLowerCase();
  if (IMAGE.includes(ext) || mime.startsWith('image/')) return 'image';
  if (ext === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (DOC.includes(ext)) return 'doc';
  if (SHEET.includes(ext)) return 'sheet';
  if (SLIDES.includes(ext)) return 'slides';
  if (VIDEO.includes(ext) || mime.startsWith('video/')) return 'video';
  if (AUDIO.includes(ext) || mime.startsWith('audio/')) return 'audio';
  if (ARCHIVE.includes(ext)) return 'archive';
  if (TEXT.includes(ext) || mime.startsWith('text/')) return 'text';
  return 'other';
}

/**
 * How the viewer shows a file. 'image', 'pdf' (pdf.js in the app), 'media' (the browser's player),
 * 'converted' (the server turns it into a plain HTML page: Word, Excel, PowerPoint, CSV, text) or 'none' (old binary
 * Office files, archives and everything else: the viewer says so and offers Download).
 */
export type PreviewWay = 'image' | 'pdf' | 'media' | 'converted' | 'none';
/** Images the browser can show (HEIC only Safari does; the viewer falls back to "no preview" when it can't load). */
const SHOWABLE_IMAGES = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'svg', 'heic', 'heif'];
/** What the server converts (server/officePreview.ts). */
export const CONVERTS = ['docx', 'docm', 'xlsx', 'xlsm', 'pptx', 'pptm', 'csv', 'tsv', ...TEXT, 'txt'];
export function previewWay(name: string, type = ''): PreviewWay {
  const ext = extOf(name);
  const kind = fileKind(name, type);
  if (kind === 'image') return SHOWABLE_IMAGES.includes(ext) || /^image\/(png|jpe?g|gif|webp|avif|bmp)$/.test(type) ? 'image' : 'none';
  if (kind === 'pdf') return 'pdf';
  if (kind === 'video' || kind === 'audio') return 'media';
  if (CONVERTS.includes(ext) || (!ext && String(type).startsWith('text/plain'))) return 'converted';
  return 'none';
}

/* ---------- what's refused and what's warned about ---------- */

/**
 * The file types Gmail refuses to send or receive (support.google.com/mail/answer/6590), the same list here. They
 * can run code when opened. A zip, or a zip inside a zip, holding one of them is refused too (server side).
 */
export const BLOCKED_EXTS = [
  'ade', 'adp', 'apk', 'appx', 'appxbundle', 'bat', 'cab', 'chm', 'cmd', 'com', 'cpl', 'diagcab', 'diagcfg', 'diagpack', 'dll', 'dmg', 'ex', 'ex_', 'exe',
  'hta', 'img', 'ins', 'iso', 'isp', 'jar', 'jnlp', 'js', 'jse', 'lib', 'lnk', 'mde', 'mjs', 'msc', 'msi', 'msix', 'msixbundle', 'msp', 'mst', 'nsh', 'pif', 'ps1',
  'scr', 'sct', 'shb', 'sys', 'vb', 'vbe', 'vbs', 'vhd', 'vhdx', 'vxd', 'wsc', 'wsf', 'wsh', 'xll',
];
/** A name that ends in a refused type, also hidden behind a second one ("invoice.pdf.exe" ends in exe: refused). */
export const isBlockedName = (name: string) => BLOCKED_EXTS.includes(extOf(name));

/**
 * Types that are allowed but can do more than they seem: web pages and pictures that can hold scripts, documents
 * with macros, shortcuts. The reader shows a calm warning before opening them.
 */
export const UNUSUAL_EXTS = ['htm', 'html', 'xhtml', 'shtml', 'svg', 'docm', 'xlsm', 'pptm', 'dotm', 'xltm', 'potm', 'rtf', 'url', 'webloc', 'desktop', 'sh', 'command', 'py', 'pl', 'rb', 'php', 'reg', 'swf'];
export const isUnusualName = (name: string) => UNUSUAL_EXTS.includes(extOf(name)) || /\.(pdf|docx?|xlsx?|jpe?g|png|txt)\.[a-z0-9]{2,5}$/i.test(name);

/* ---------- size ---------- */

/** What one email can carry, all of it together (Gmail's 25 MB; our own engine refuses mail over this too). */
export const MAIL_SIZE_LIMIT = 25 * 1024 * 1024;
/** Room for the words, headers and pictures in the body, kept free under the limit. */
const BODY_ROOM = 256 * 1024;
/** A file's size once it's packed into an email (base64: 4 bytes for every 3, plus line breaks). */
export const encodedSize = (bytes: number) => Math.ceil(bytes / 3) * 4 * (78 / 76);
/**
 * Which files go as links: in order, a file that would take the email past the limit becomes a link (Gmail turns the
 * one that doesn't fit into a Drive link); files already chosen as links stay links. Returns the indexes that are links.
 */
export function linksNeeded(files: { size: number; link?: boolean }[], bodyBytes = 0): Set<number> {
  const out = new Set<number>();
  let used = bodyBytes + BODY_ROOM;
  files.forEach((f, i) => {
    if (f.link) return void out.add(i);
    const add = encodedSize(f.size);
    if (used + add > MAIL_SIZE_LIMIT) out.add(i);
    else used += add;
  });
  return out;
}
/** Whether these attachments fit in one email (the server checks the same before sending). */
export const fitsInEmail = (sizes: number[], bodyBytes = 0) => sizes.reduce((n, s) => n + encodedSize(s), bodyBytes + BODY_ROOM) <= MAIL_SIZE_LIMIT;

/* ---------- every attachment across someone's mail ---------- */

export interface MailFile {
  key: string; // threadId/messageId/index: stable for lists
  threadId: string;
  messageId: string;
  index: number;
  att: Attachment;
  kind: FileKind;
  from: { name: string; email: string };
  date: string;
  subject: string;
}

export interface FileFilter {
  q?: string; // words in the file's name ("filename:")
  kinds?: FileKind[];
  from?: string; // an address or part of a name
  after?: string; // ISO date: received on or after
  before?: string; // ISO date: received before
}

/** Whether a file's name matches "filename:" words: a part of the name, or a type ("pdf", "spreadsheet", "image"). */
export function filenameMatches(name: string, q: string): boolean {
  const words = String(q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const n = String(name ?? '').toLowerCase();
  const kind = fileKind(name);
  const alias: Record<string, FileKind> = { image: 'image', images: 'image', picture: 'image', photo: 'image', gambar: 'image', foto: 'image', pdf: 'pdf', document: 'doc', doc: 'doc', word: 'doc', dokumen: 'doc', spreadsheet: 'sheet', sheet: 'sheet', excel: 'sheet', presentation: 'slides', slides: 'slides', powerpoint: 'slides', video: 'video', audio: 'audio', zip: 'archive' };
  return words.every((w) => n.includes(w) || alias[w] === kind || extOf(n) === w.replace(/^\./, ''));
}

/** The files people can open (not refused ones, not pictures that sit inside the email's words). */
export const listedAttachments = (m: Pick<Message, 'attachments'>) => (m.attachments ?? []).filter((a) => !a.inline && !a.cid);
/** `has:attachment`: the conversation has a file someone attached (pictures inside the words don't count, as in Gmail). */
export const threadHasAttachment = (t: Pick<Thread, 'messages'>) => (t.messages ?? []).some((m) => listedAttachments(m).length > 0);

/** Every attachment in these conversations, newest first, filtered. Drafts and Trash stay out, as in Gmail's search. */
export function mailFiles(threads: Thread[], f: FileFilter = {}): MailFile[] {
  const out: MailFile[] = [];
  const from = String(f.from ?? '').toLowerCase().trim();
  for (const th of threads) {
    if (th.location === 'drafts' || th.location === 'trash') continue;
    for (const m of th.messages ?? []) {
      if (f.after && m.date < f.after) continue;
      if (f.before && m.date >= f.before) continue;
      if (from && !String(m.from?.email ?? '').toLowerCase().includes(from) && !String(m.from?.name ?? '').toLowerCase().includes(from)) continue;
      (m.attachments ?? []).forEach((att, index) => {
        if (att.inline || att.cid) return;
        const kind = fileKind(att.name, att.type);
        if (f.kinds?.length && !f.kinds.includes(kind)) return;
        if (f.q && !filenameMatches(att.name, f.q)) return;
        out.push({ key: `${th.id}/${m.id}/${index}`, threadId: th.id, messageId: m.id, index, att, kind, from: m.from, date: m.date, subject: th.subject });
      });
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/** The address of a file on our server ("/api/files/<id>"), or null. */
export const fileIdOf = (url: string | undefined) => /^\/api\/files\/([a-f0-9]{32})$/.exec(String(url ?? ''))?.[1] ?? null;
