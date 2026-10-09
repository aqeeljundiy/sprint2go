// The app's side of imports (server/imports.ts): list, upload with progress, read, start, cancel and undo.
import type { ImportChoices, ImportJob, ImportSource } from '../../importTypes';
import { mark } from '../../i18n';

// Errors carry the English (the server's own, or one of these marked here); the screens show them with t(message).

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, { method, headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const d = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(d.error ?? mark('Something went wrong. Try again.'));
  return d;
}

export const listImports = (workspaceId: string) => call<{ jobs: ImportJob[]; limits: { upload: number; json: number } }>('GET', `/api/import?workspaceId=${encodeURIComponent(workspaceId)}`);
export const getImport = (id: string) => call<{ job: ImportJob }>('GET', `/api/import/${id}`).then((d) => d.job);
export const startImport = (id: string, choices: ImportChoices) => call<{ job: ImportJob }>('POST', `/api/import/${id}/start`, { choices }).then((d) => d.job);
export const cancelImport = (id: string) => call<{ job: ImportJob }>('POST', `/api/import/${id}/cancel`, {}).then((d) => d.job);
export const undoCheck = (id: string) => call<{ since: number }>('GET', `/api/import/${id}/undo`).then((d) => d.since);
export const undoImport = (id: string) => call<{ job: ImportJob }>('POST', `/api/import/${id}/undo`, {}).then((d) => d.job);

/**
 * Sends the export to the server, streaming, with progress (0 to 1). `abort` stops it. The promise has the new import,
 * which the server is now reading.
 */
export function uploadImport(workspaceId: string, source: ImportSource, file: File, onProgress: (share: number) => void): { done: Promise<ImportJob>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const done = new Promise<ImportJob>((resolve, reject) => {
    xhr.open('POST', `/api/import/upload?workspaceId=${encodeURIComponent(workspaceId)}&source=${source}`);
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    xhr.setRequestHeader('x-file-name', encodeURIComponent(file.name));
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let d: { job?: ImportJob; error?: string } = {};
      try {
        d = JSON.parse(xhr.responseText);
      } catch {
        /* not JSON: a proxy's page */
      }
      if (xhr.status >= 200 && xhr.status < 300 && d.job) resolve(d.job);
      else reject(new Error(d.error ?? (xhr.status === 413 ? mark('That file is too big to import.') : mark('The upload didn’t finish. Try again.'))));
    };
    xhr.onerror = () => reject(new Error(mark('The upload broke off. Check your connection and try again.')));
    xhr.onabort = () => reject(new Error('aborted'));
    xhr.send(file);
  });
  return { done, abort: () => xhr.abort() };
}
