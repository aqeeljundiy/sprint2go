import DOMPurify from 'dompurify';

// Every piece of email HTML goes through here before it touches the page,
// so a message can never run scripts or load tracking tricks.

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
  // Pictures: only our own files (a picture pasted into an email, or one an email carried inside it, kept by the mail
  // engine) and inline data. Nothing from other sites, so no tracking and no remote loads (server/mailFiles.ts).
  if (node.tagName === 'IMG') {
    const src = node.getAttribute('src') ?? '';
    if (!/^\/api\/files\/[a-f0-9]{32}$/.test(src) && !/^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(src)) {
      node.removeAttribute('src');
      node.setAttribute('hidden', '');
    } else node.setAttribute('loading', 'lazy');
  }
});

export function sanitize(html: string) {
  html = html.replace(/url\s*\(/gi, 'url-off(');
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'div', 'span', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'a', 'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'font', 'code', 'pre', 'hr', 'img'],
    ALLOWED_ATTR: ['href', 'style', 'color', 'size', 'src', 'alt', 'width', 'height'],
    FORBID_ATTR: ['srcset'],
  });
}

/** Plain-text version of some HTML (for snippets and search). */
export function htmlToText(html: string) {
  const el = document.createElement('div');
  el.innerHTML = sanitize(html.replace(/<\/(p|div|li|h\d|blockquote)>/gi, '$&\n').replace(/<br\s*\/?>/gi, '\n'));
  return (el.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
}

/** Escape plain text so it can be shown as HTML. */
export function textToHtml(text: string) {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/** True when the user typed something beyond the auto-inserted signature. */
export function hasOwnText(text: string, signatureHtml: string) {
  const sig = signatureHtml ? htmlToText(signatureHtml) : '';
  return (sig ? text.replace(sig, '') : text).trim().length > 0;
}
