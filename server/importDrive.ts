// Google Drive from a Google Takeout zip (no Google sign-in): folders and files go into Drive, inside a folder called
// "Google Drive import" at the top (the same one again for the next part of a Takeout split into several zips).
// Google Docs, Sheets and Slides arrive as the Office or PDF files Takeout made of them. Every file counts toward
// the company's storage like an upload: the preview says whether it fits, and files over the company's "ask before
// saving big files" size come in only when the admin says so.
import * as db from './db.ts';
import { ZipError, openEntry, readZip, type ZipEntry } from './zip.ts';
import { ImportError, limits, mbText, newId, saveStream, typeOf, type AnalyzeCtx, type RunCtx } from './importKit.ts';
import { kindOf } from '../src/data/drive.ts';
import { DRIVE_FOLDER, type ImportPreview } from '../src/importTypes.ts';

const JUNK = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini)(\/|$)|(^|\/)\._/i;
const DRIVE_ROOT = /^Takeout\/(Drive|My Drive|Google Drive|Drive de Google|Meine Ablage|Mon Drive|Il mio Drive)(\/|$)/i;

/** The Drive part of the zip: its files and folders (paths inside Drive), and the other Takeout parts left out. */
async function contents(file: string) {
  const entries = await readZip(file, { maxFiles: limits().files, maxTotal: limits().unzipped });
  const takeout = entries.some((e) => e.name.startsWith('Takeout/'));
  let prefix = '';
  const other = new Set<string>();
  if (takeout) {
    const hit = entries.find((e) => DRIVE_ROOT.test(e.name));
    if (!hit) {
      const parts = [...new Set(entries.map((e) => e.name.split('/')[1]).filter((x) => x && !/\.html?$/i.test(x)))];
      throw new ImportError(`This Takeout has no Drive in it${parts.length ? ` (it has ${parts.slice(0, 4).join(', ')})` : ''}. At takeout.google.com, pick Drive and export again.`);
    }
    prefix = hit.name.match(DRIVE_ROOT)![0].replace(/\/?$/, '/');
    for (const e of entries)
      if (e.name.startsWith('Takeout/') && !e.name.startsWith(prefix)) {
        const part = e.name.split('/')[1];
        if (part && e.name.split('/').length > 2) other.add(part);
      }
  }
  const files: (ZipEntry & { path: string })[] = [];
  const folders = new Set<string>();
  for (const e of entries) {
    if (prefix && !e.name.startsWith(prefix)) continue;
    const path = e.name.slice(prefix.length);
    if (!path || JUNK.test(path)) continue;
    if (e.dir) {
      folders.add(path);
      continue;
    }
    files.push({ ...e, path });
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join('/'));
  }
  if (!files.length) throw new ImportError(takeout ? 'The Drive in this Takeout is empty.' : 'This zip has no files in it.');
  return { files, folders: [...folders].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b)), other: [...other] };
}

/** Drive's own "Google Drive import" folder at the top, when an earlier import made one. */
const existingRoot = (wsId: string) => (db.allDocs('drive') as any[]).find((d) => d.workspaceId === wsId && d.kind === 'folder' && !d.parentId && !d.trashed && d.name === DRIVE_FOLDER);

export async function analyze(ctx: AnalyzeCtx): Promise<ImportPreview> {
  ctx.progress('Reading the zip', 0, 1);
  const { files, folders, other } = await contents(ctx.file);
  const askOver = ctx.room.askOverMb * 1024 * 1024;
  const big = askOver > 0 ? files.filter((f) => f.size > askOver) : [];
  ctx.progress('Reading the zip', 1, 1);
  return {
    source: 'drive',
    title: 'Google Drive',
    people: [],
    drive: {
      folders: folders.length,
      files: files.length,
      bytes: files.reduce((n, f) => n + f.size, 0),
      big: big.length,
      bigBytes: big.reduce((n, f) => n + f.size, 0),
      otherParts: other,
      into: existingRoot(ctx.ws.id) ? 'existing' : 'new',
    },
    room: ctx.room,
    seatsLeft: ctx.seats,
  };
}

export async function run(ctx: RunCtx) {
  const { files, folders } = await contents(ctx.file);
  const wsId = ctx.ws.id;
  const now = new Date().toISOString();
  const drive = (db.allDocs('drive') as any[]).filter((d) => d.workspaceId === wsId && !d.trashed);
  const folderAt = new Map<string, string>(); // path inside Drive ('' = the import folder) -> folder id
  ctx.made('folders', 0);
  ctx.made('files', 0);
  // The import folder, and each folder inside it: the one already there with the same name, else a new one.
  const root = existingRoot(wsId);
  if (root) folderAt.set('', root.id);
  else {
    const id = newId('d-');
    ctx.add('drive', [{ id, name: DRIVE_FOLDER, kind: 'folder', parentId: null, size: 0, modified: now, workspaceId: wsId, uploadedBy: ctx.me }]);
    folderAt.set('', id);
    ctx.made('folders', 1);
  }
  let pending: db.Doc[] = [];
  for (const path of folders) {
    const parent = folderAt.get(path.split('/').slice(0, -1).join('/'))!;
    const name = path.split('/').pop()!.slice(0, 200);
    const there = drive.find((d) => d.kind === 'folder' && d.parentId === parent && d.name === name) ?? pending.find((d: any) => d.parentId === parent && d.name === name);
    if (there) {
      folderAt.set(path, String(there.id));
      continue;
    }
    const id = newId('d-');
    pending.push({ id, name, kind: 'folder', parentId: parent, size: 0, modified: now, workspaceId: wsId, uploadedBy: ctx.me });
    folderAt.set(path, id);
    ctx.made('folders', 1);
  }
  // Parents before children (folders are sorted by depth), in batches.
  for (let i = 0; i < pending.length; i += 300) ctx.add('drive', pending.slice(i, i + 300));
  pending = [];

  const askOver = Number(ctx.preview.room.askOverMb ?? 500) * 1024 * 1024;
  let batch: db.Doc[] = [];
  const flush = async () => {
    ctx.add('drive', batch);
    ctx.made('files', batch.length);
    batch = [];
    await ctx.breathe();
  };
  // What was saved before a stop still gets its place in Drive (and Undo takes it out like the rest).
  try {
    for (const [i, f] of files.entries()) {
      const name = f.path.split('/').pop()!.slice(0, 200);
      const where = `${DRIVE_FOLDER}/${f.path.split('/').slice(0, -1).join('/')}`.replace(/\/$/, '');
      ctx.progress(name, i, files.length);
      if (!ctx.choices.big && askOver > 0 && f.size > askOver) {
        ctx.missing(name, where, `over ${mbText(askOver)}, left out`);
        continue;
      }
      if (f.size > ctx.maxFile()) {
        ctx.missing(name, where, `over the ${mbText(ctx.maxFile())} limit for one file`);
        continue;
      }
      if (f.size > ctx.room()) {
        ctx.missing(name, where, 'no room left in the company’s storage');
        continue;
      }
      let stored: { id: string; size: number };
      try {
        stored = await saveStream(await openEntry(ctx.file, f, ctx.maxFile()), ctx.maxFile());
      } catch (e) {
        // A file that grows past what the zip said: the zip lies about its sizes, so nothing more is read from it.
        if (e instanceof ZipError && e.why === 'bomb') throw e;
        ctx.missing(name, where, e instanceof ZipError && e.why === 'locked' ? 'protected or packed in a way we can’t open' : 'damaged in the zip');
        continue;
      }
      const type = typeOf(name).slice(0, 100);
      ctx.addFile({ id: stored.id, name, type, size: stored.size });
      const kind = kindOf({ name, type });
      const url = `/api/files/${stored.id}`;
      batch.push({
        id: newId('d-'),
        name,
        kind,
        parentId: folderAt.get(f.path.split('/').slice(0, -1).join('/')) ?? folderAt.get('')!,
        size: stored.size,
        modified: f.modified.getTime() > 0 ? f.modified.toISOString() : now,
        url,
        ...(kind === 'image' || kind === 'video' ? { thumb: url } : {}),
        workspaceId: wsId,
        uploadedBy: ctx.me,
      });
      if (batch.length >= 200) await flush();
    }
  } finally {
    await flush();
  }
  ctx.progress('Done', files.length, files.length);
}
