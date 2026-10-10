// Received HTML mail, made safe to show as it was sent: tables, styles and pictures stay; scripts, forms, frames and
// anything that loads from outside go. It's shown inside a sandboxed frame (MailBody.tsx), so its CSS can't touch the
// app. Pictures come through our own proxy (/api/mail/img: the sender never learns the reader's address), pictures
// inside the email (cid:) from its saved files, and tracking pixels never load.
import DOMPurify from 'dompurify';
import type { Attachment } from '../../types';

export interface MailHtmlOptions {
  /** Load pictures (through the proxy). Off: they're left out and the reader offers "Show pictures". */
  images: boolean;
  /** Leave out tracking pixels (Settings, Mail). */
  blockTrackers: boolean;
  /** The email's files, for pictures shown inside it (cid:). */
  attachments?: Attachment[];
  /** Whether the server is there to proxy pictures (the demo without a server loads them straight). */
  proxy: boolean;
}
export interface MailHtml {
  html: string; // the body
  css: string; // the email's own <style> blocks, cleaned
  blocked: number; // outside pictures left out (for "Show pictures")
  designed: boolean; // a designed email (its own backgrounds and layout): shown on white paper in dark mode
}

const purify = DOMPurify(typeof window !== 'undefined' ? window : (undefined as never));
const proxied = (u: string) => `/api/mail/img?u=${encodeURIComponent(u)}`;
const isTracker = (el: Element) => {
  const w = el.getAttribute('width');
  const h = el.getAttribute('height');
  const st = (el.getAttribute('style') ?? '').replace(/\s/g, '').toLowerCase();
  return (w !== null && Number(w) <= 1) || (h !== null && Number(h) <= 1) || /(^|;)(width|height):[01]px/.test(st) || /display:none/.test(st);
};

/** CSS from the email, with outside loads routed through the proxy (or dropped) and nothing that can run or escape. */
function cleanCss(css: string, o: MailHtmlOptions) {
  return css
    .replace(/<\/?style[^>]*>/gi, '')
    .replace(/@import[^;]+;?/gi, '')
    .replace(/expression\s*\(/gi, 'x(')
    .replace(/behavior\s*:/gi, 'x:')
    .replace(/-moz-binding\s*:/gi, 'x:')
    .replace(/url\s*\(\s*(['"]?)([^'")]*)\1\s*\)/gi, (_m, _q, u: string) => (/^https?:/i.test(u) && o.images ? `url("${o.proxy ? proxied(u) : u}")` : /^data:image\//i.test(u) ? `url("${u}")` : 'none'));
}

let current: MailHtmlOptions & { count: number; cids: Map<string, string> } = { images: false, blockTrackers: true, proxy: true, count: 0, cids: new Map() };
purify.addHook('afterSanitizeAttributes', (node) => {
  const el = node as Element;
  if (el.tagName === 'A') {
    el.setAttribute('target', '_blank');
    el.setAttribute('rel', 'noopener noreferrer');
  }
  if (el.hasAttribute?.('style')) el.setAttribute('style', cleanCss(el.getAttribute('style') ?? '', current));
  if (el.hasAttribute?.('background')) {
    const u = el.getAttribute('background') ?? '';
    if (/^https?:/i.test(u) && current.images) el.setAttribute('background', current.proxy ? proxied(u) : u);
    else el.removeAttribute('background');
  }
  if (el.tagName !== 'IMG') return;
  el.removeAttribute('srcset');
  const src = (el.getAttribute('src') ?? '').trim();
  if (current.blockTrackers && isTracker(el)) return void el.setAttribute('data-drop', '');
  if (/^cid:/i.test(src)) {
    const url = current.cids.get(src.slice(4).replace(/^<|>$/g, '').toLowerCase());
    if (url) el.setAttribute('src', url);
    else el.setAttribute('data-drop', '');
    return;
  }
  if (/^data:image\//i.test(src)) return;
  if (/^https?:/i.test(src)) {
    if (current.images) el.setAttribute('src', current.proxy ? proxied(src) : src);
    else {
      current.count++;
      el.removeAttribute('src');
      el.setAttribute('data-hidden-img', '');
      if (!el.getAttribute('alt')) el.setAttribute('alt', '');
    }
    return;
  }
  el.setAttribute('data-drop', '');
});

/** The email's HTML, ready for the frame. */
export function mailHtml(raw: string, o: MailHtmlOptions): MailHtml {
  const styles = Array.from(raw.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)).map((m) => m[1]);
  const cids = new Map((o.attachments ?? []).filter((a) => a.cid && a.url).map((a) => [a.cid!.toLowerCase(), a.url!]));
  current = { ...o, count: 0, cids };
  const frag = purify.sanitize(raw.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ''), {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['form', 'input', 'button', 'textarea', 'select', 'option', 'iframe', 'frame', 'frameset', 'object', 'embed', 'video', 'audio', 'source', 'track', 'link', 'meta', 'base', 'svg', 'math', 'template', 'dialog'],
    FORBID_ATTR: ['srcset', 'action', 'formaction', 'ping'],
    ALLOW_DATA_ATTR: false,
    RETURN_DOM_FRAGMENT: true,
  }) as unknown as DocumentFragment;
  // Tracking pixels and pictures that can't be shown go (marked by the hook: removing while it walks skips nodes).
  frag.querySelectorAll('[data-drop]').forEach((x) => x.remove());
  const box = document.createElement('div');
  box.appendChild(frag);
  const html = box.innerHTML;
  const css = cleanCss(styles.join('\n'), o).slice(0, 200_000);
  const designed = /\bbgcolor\s*=|background(-color)?\s*:\s*(?!transparent|inherit|none)[^;"']+/i.test(raw) || /<table[^>]+width\s*=\s*["']?[3-9]\d\d/i.test(raw);
  return { html, css, blocked: current.count, designed };
}

/** Outside pictures in an email, without making it (for the "Show pictures" bar before anything renders). */
export const hasOutsidePictures = (raw: string) => /<img[^>]+src\s*=\s*["']?https?:/i.test(raw) || /url\s*\(\s*['"]?https?:/i.test(raw);
