// Attachments on a task's comments (TaskEvent.files): uploads like any other (POST /api/upload, so they count toward
// the company's storage and "Ask before saving big files" asks first), linked from the comment as /api/files/<id>.
// Who opens them follows the comment: GET /api/files/<id> opens a file only for someone whose view of the task holds
// it, and a guest's view of a task keeps only the comments shared with them (clientLens in server/index.ts).
//
// keepCommentFiles is the write rule, for teammates and guests alike: a comment someone adds carries only their own
// uploads in the task's company (named, typed and sized as the server recorded them, at most MAX_FILES), and a comment
// already saved keeps the files it had. So nobody can hang another person's file, or one from another company, on a
// task to open it through the task, and nobody swaps the files under someone else's comment.

export const MAX_FILES = 10;
export const FILE_URL = /^\/api\/files\/([a-f0-9]{32})$/;

export interface CommentFile {
  name: string;
  size: number; // bytes
  type: string; // the uploader's word for it (the server decides what opens in the browser)
  url: string; // /api/files/<id>
}
type FileInfo = { id: string; workspaceId: string; by: string; name: string; type: string; size: number } | null | undefined;

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The files a new comment may carry: `me`'s own uploads in `wsId`, as recorded. */
export function ownFiles(files: unknown, me: string, wsId: string | undefined, info: (id: string) => FileInfo): CommentFile[] {
  if (!Array.isArray(files)) return [];
  const out: CommentFile[] = [];
  for (const f of files) {
    const id = typeof f?.url === 'string' ? FILE_URL.exec(f.url)?.[1] : undefined;
    const rec = id ? info(id) : null;
    if (!rec || rec.by !== me || (wsId && rec.workspaceId !== wsId)) continue;
    if (out.some((x) => x.url === f.url)) continue;
    out.push({ name: String(rec.name ?? 'file').slice(0, 200), size: Number(rec.size) || 0, type: String(rec.type ?? 'application/octet-stream').slice(0, 100), url: `/api/files/${rec.id}` });
    if (out.length >= MAX_FILES) break;
  }
  return out;
}

/** A task as it may be saved by `me`: new comments with only their own files, saved comments with the files they had. */
export function keepCommentFiles<T extends { workspaceId?: string; history?: any[] }>(before: T | null | undefined, next: T, me: string, info: (id: string) => FileInfo): T {
  if (!next || !Array.isArray(next.history)) return next;
  const known = new Map((before?.history ?? []).map((h: any) => [h?.id, h]));
  const wsId = next.workspaceId ?? before?.workspaceId;
  let changed = false;
  const history = next.history.map((h: any) => {
    if (!h || typeof h !== 'object') return h;
    const old = known.get(h.id);
    if (old) {
      if (same(h.files, old.files)) return h;
      changed = true;
      const { files: _drop, ...rest } = h;
      return old.files ? { ...rest, files: old.files } : rest;
    }
    if (!('files' in h)) return h;
    changed = true;
    const { files, ...rest } = h;
    const kept = h.kind === 'comment' ? ownFiles(files, me, wsId, info) : [];
    return kept.length ? { ...rest, files: kept } : rest;
  });
  return changed ? { ...next, history } : next;
}

/** Whether a document (as someone sees it) links this file. */
export const holdsFile = (doc: unknown, id: string) => !!doc && JSON.stringify(doc).includes(`/api/files/${id}`);
