import type { Workspace } from '../types';
import { initials } from '../utils';

export function WorkspaceLogo({ ws, size = 28 }: { ws: Pick<Workspace, 'name' | 'logo' | 'color'>; size?: number }) {
  return ws.logo ? (
    <img className="ws-logo" src={ws.logo} alt="" width={size} height={size} style={{ borderRadius: size * 0.26 }} />
  ) : (
    <span
      className="ws-logo ws-mono"
      style={{ width: size, height: size, borderRadius: size * 0.26, background: ws.color, fontSize: size * 0.4 }}
      aria-hidden="true"
    >
      {initials(ws.name || '?')}
    </span>
  );
}

/** Reads an image file into a small data URL (max 160px) so logos stay light. */
export function readLogo(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const url = String(reader.result);
      if (file.type === 'image/svg+xml') return resolve(url);
      const img = new Image();
      img.onload = () => {
        const max = 160;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = reject;
      img.src = url;
    };
    reader.readAsDataURL(file);
  });
}

/** Sets the browser tab title and icon to the workspace's brand. */
export function applyBranding(ws: Workspace) {
  document.title = `${ws.name} · Elkiya Mail`;
  const icon =
    ws.logo ??
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="${ws.color}"/><text x="16" y="21" font-family="Plus Jakarta Sans,Arial" font-size="14" font-weight="700" fill="#fff" text-anchor="middle">${initials(ws.name).replace(/[<&>]/g, '')}</text></svg>`,
    )}`;
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.href = icon;
}
