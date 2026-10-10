// What the attachment screens ask the server (server/mailFiles.ts), with the demo's way when there's no server (the
// demo company keeps everything in the browser and nothing leaves it).
import type { Attachment, DriveItem } from '../../types';
import { server, uploadFile } from '../../sync';
import { session, setStored, store } from '../../store';
import { isSandboxId } from '../../sandbox';
import { kindOf, parseSize, sizeText } from '../../data/drive';
import { t } from '../../i18n';
import { uid } from '../../utils';

/** Whether this company talks to the real server (not the demo, not the demo company). */
export const realFor = (wsId = session.wsId) => server.on && !isSandboxId(wsId);

const why = async (r: Response, fallback: string) => {
  const e = ((await r.json().catch(() => ({}))) as { error?: string }).error;
  return new Error(e ? t(e) : fallback);
};

/** Drive's folders in this company, for the folder picker (not trashed, by name). */
export const driveFolders = (wsId = session.wsId) => (store.drive as DriveItem[]).filter((d) => d.kind === 'folder' && !d.trashed && (d.workspaceId ?? 'pnp') === wsId).sort((a, b) => a.name.localeCompare(b.name));

/** Whether this file from this email is in Drive already. */
export const inDrive = (threadId: string, name: string, drive: DriveItem[] = store.drive as DriveItem[]) => drive.some((d) => d.threadId === threadId && d.name === name && !d.trashed && d.kind !== 'folder');

/**
 * Save to Drive: copies of the real files (the person's own, in the folder picked), within the company's storage.
 * The demo keeps a Drive entry that points at the same file.
 */
export async function saveToDrive(o: { threadId: string; messageId?: string; atts: Attachment[]; folderId: string | null; date?: string; wsId?: string }): Promise<number> {
  const wsId = o.wsId ?? session.wsId;
  const atts = o.atts.filter((a) => !a.blocked && !a.inline);
  if (!atts.length) return 0;
  if (realFor(wsId)) {
    const r = await fetch('/api/mail/files/drive', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ threadId: o.threadId, messageId: o.messageId, urls: atts.map((a) => a.url).filter(Boolean), folderId: o.folderId }) }).catch(() => null);
    if (!r) throw new Error(t('There’s no connection.'));
    if (!r.ok) throw await why(r, t('Couldn’t save to Drive.'));
    return ((await r.json()) as { items: unknown[] }).items.length;
  }
  const now = new Date().toISOString();
  const items: DriveItem[] = atts.map((a) => ({ id: uid(), name: a.name, kind: kindOf({ name: a.name, type: a.type }), parentId: o.folderId, size: parseSize(a.size), modified: o.date ?? now, threadId: o.threadId, workspaceId: wsId, url: a.url }));
  setStored('drive', [...(store.drive as DriveItem[]), ...items]);
  return items.length;
}

/** Where "Download all" gets its zip. */
export const zipUrl = (threadId: string, messageId?: string) => `/api/mail/zip?threadId=${encodeURIComponent(threadId)}${messageId ? `&messageId=${encodeURIComponent(messageId)}` : ''}`;

/** A Word, Excel, PowerPoint, CSV or text file as a plain HTML page, or why there's none. */
export async function previewPage(url: string, dark: boolean): Promise<{ html: string } | { none: string }> {
  const r = await fetch(`${url}/preview${dark ? '?theme=dark' : ''}`).catch(() => null);
  if (!r) return { none: t('There’s no connection.') };
  if (!r.ok) return { none: (await why(r, t('There’s no preview for this kind of file. Download it to open it.'))).message };
  return { html: await r.text() };
}

/* ---------- files going out ---------- */

/** A file in Compose or a reply: uploading, uploaded (with its address), or failed. `link`: goes as a Drive link. */
export interface DraftFile {
  key: string;
  name: string;
  size: number;
  type?: string;
  url: string; // the server address once uploaded ("" while uploading)
  state: 'uploading' | 'done' | 'failed';
  error?: string;
  /** Chosen as a link (inserted from Drive as a link); files over the email's room become links by themselves. */
  link?: boolean;
}

/** Uploads one file for an email; resolves with its address (the demo keeps it in the browser). */
export async function uploadForMail(file: File, wsId = session.wsId) {
  const up = await uploadFile(file, wsId, file.name);
  return { url: up.url, type: up.type || file.type, size: file.size };
}

export type LinkAccess = 'anyone' | 'recipients';

/**
 * The files that go as links: each gets a Drive copy and a link (server). Returns the HTML and text to add at the end
 * of the email. The demo can't share links (nothing leaves it), so there the files stay attachments.
 */
export async function makeLinks(files: { name: string; url: string; size: number }[], access: LinkAccess, recipients: string[], wsId = session.wsId): Promise<{ html: string; text: string } | null> {
  if (!files.length) return null;
  const r = await fetch('/api/mail/links', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: wsId, files: files.map((f) => ({ name: f.name, url: f.url })), access, recipients }) }).catch(() => null);
  if (!r) throw new Error(t('There’s no connection.'));
  if (!r.ok) throw await why(r, t('The links couldn’t be made.'));
  const { links } = (await r.json()) as { links: { name: string; size: number; href: string }[] };
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  // Written in the sender's language: the recipient reads it as part of the email.
  const note = access === 'recipients' ? t('Only the people this email went to can open these.') : t('Anyone with the link can open these.');
  const html = `<div style="margin:16px 0 0;padding:12px 16px;border:1px solid #e5e7eb;border-radius:10px"><div style="font-size:13px;color:#6b7280;margin:0 0 8px">${esc(note)}</div>${links.map((l) => `<div style="margin:4px 0"><a href="${esc(l.href)}">${esc(l.name)}</a> <span style="color:#6b7280;font-size:13px">(${esc(sizeText(l.size))})</span></div>`).join('')}</div>`;
  const text = `\n\n${note}\n${links.map((l) => `${l.name} (${sizeText(l.size)}): ${l.href}`).join('\n')}`;
  return { html, text };
}
