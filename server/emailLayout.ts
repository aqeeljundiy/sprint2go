// The one look every email sprint2go sends shares (sign-up codes, guest notices, digests, invoices, alerts…).
// Same brand as sprint2go.com (src/landing/landing.css): Plus Jakarta Sans with system fallbacks, the #2448ff blue,
// pill buttons, an 18px white card on the #f5f6f8 page, and the mark plus "sprint2go" wordmark with the 2 in blue.
//
// Email-client safe on purpose: tables and inline styles only (the <style> block only adds dark mode and phone
// padding, for the clients that read it), a bulletproof button with a VML fallback for Outlook's Word engine,
// max 600 wide, preheader text, and nothing that needs an image to be read (the logo is a hosted PNG with alt text,
// the wordmark is live text, a company without a logo gets its initial on its colour).
//
// Callers describe an email as blocks (renderEmail); the same blocks give the plain-text version, so the two never
// drift. Words go through t() by the caller, inside lang.inLang(), like before.
import { getLang, t } from '../src/i18n/index.ts';
import * as db from './db.ts';

/** Whose email it is: sprint2go's own, or a company's (guest notices, its digests, its admins' alerts). */
export type Brand = {
  name: string;
  /** The button and link colour. */
  color: string;
  /** A hosted PNG/JPEG (never a data URL: Gmail drops those). Absent: the initial on the colour. */
  logoUrl?: string;
  /** sprint2go's own email: the mark and the wordmark. */
  own?: boolean;
  /** A company that isn't white-labelled: the footer says it came through sprint2go. */
  via?: boolean;
};

export type Block =
  | { p: string; muted?: boolean; html?: boolean }
  | { heading: string }
  | { code: string; note?: string }
  | { rows: [string, string][]; total?: [string, string] }
  | { list: { text: string; url?: string; color?: string }[]; heading?: string }
  | { notice: string; tone?: 'warn' | 'info' }
  | { quote: string; by?: string }
  | { button: { text: string; url: string } }
  | { links: { text: string; url: string }[] };

export type EmailInput = {
  brand?: Brand;
  /** The line inboxes show after the subject. */
  preheader: string;
  title: string;
  blocks: Block[];
  /** Why they got it (and "Didn't ask for this?…" where it fits). The "who it's from" line is added. */
  footer?: string[];
  /** A link under the footer lines (the digest's settings link). */
  footerLink?: { text: string; url: string };
  lang?: string;
};

const BLUE = '#2448ff';
const FONT = "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const C = { page: '#f5f6f8', card: '#ffffff', border: '#e2e3e9', text: '#0b0c10', text2: '#2e3038', text3: '#777a88', soft: '#f5f6f8', line: '#eceef2', warn: '#b45309', warnSoft: '#fdf1e3' };

export const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Where our own files live for mail clients: the app's public address. */
export const publicBase = () => (process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 8787}`).replace(/\/$/, '');

export const sprint2goBrand = (): Brand => ({ name: 'sprint2go', color: BLUE, logoUrl: `${publicBase()}/email/logo.png`, own: true });

/** A company's brand for its emails: its white-label name, colour and logo when on, else its own name and colour. */
export function companyBrand(wsOrId: any, fallbackName?: string): Brand {
  const ws = typeof wsOrId === 'string' ? (db.getDoc('workspaces', wsOrId) as any) : wsOrId;
  if (!ws) return fallbackName && fallbackName !== 'sprint2go' ? { name: fallbackName, color: BLUE, via: true } : sprint2goBrand();
  const wl = ws.whiteLabel?.enabled ? ws.whiteLabel : null;
  const logo: string | undefined = (wl?.logo ?? ws.logo) || undefined;
  const raster = typeof logo === 'string' && /^data:image\/(png|jpe?g|gif|webp);base64,/.test(logo);
  return {
    name: String(fallbackName || wl?.name || ws.name || 'sprint2go'),
    color: validColor(wl?.color ?? ws.color) ?? BLUE,
    ...(raster ? { logoUrl: `${publicBase()}/email/brand/${encodeURIComponent(ws.id)}.png?v=${hash(logo!)}` } : {}),
    via: !wl,
  };
}

const hash = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i += 97) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + s.length.toString(36);
};
const validColor = (c: unknown) => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : null);

/* ---------- colour helpers: a company colour that's too light for white text gets dark text ---------- */
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lum = (hex: string) => {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};
const mix = (hex: string, to: string, k: number) => '#' + rgb(hex).map((v, i) => Math.round(v + (rgb(to)[i] - v) * k).toString(16).padStart(2, '0')).join('');
/** The colour as text on white: darkened until it reads at 4.5:1. */
function inkOn(hex: string, bg = '#ffffff') {
  let c = hex;
  for (let k = 0.1; contrast(c, bg) < 4.5 && k <= 1; k += 0.1) c = mix(hex, '#000000', k);
  return c;
}
/** The colour as text on a dark card. */
const inkDark = (hex: string) => {
  let c = mix(hex, '#ffffff', 0.35);
  for (let k = 0.45; contrast(c, '#16171d') < 4.5 && k <= 1; k += 0.1) c = mix(hex, '#ffffff', k);
  return c;
};

/* ---------- pieces ---------- */

const td = (style: string, inner: string, attrs = '') => `<td${attrs} style="${style}">${inner}</td>`;
const table = (inner: string, style = '', attrs = '') => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"${attrs} style="border-collapse:collapse;mso-table-lspace:0;mso-table-rspace:0;${style}">${inner}</table>`;
const row = (inner: string) => `<tr>${inner}</tr>`;
const lines = (s: string) => esc(s).replace(/\n/g, '<br>');

function header(b: Brand) {
  if (b.own) {
    const mark = b.logoUrl ? `<img src="${esc(b.logoUrl)}" width="32" height="32" alt="sprint2go" style="display:block;width:32px;height:32px;border:0;outline:none;border-radius:9px">` : '';
    return table(row(`${mark ? td('width:32px;padding:0 10px 0 0;vertical-align:middle', mark) : ''}${td(`vertical-align:middle;font-family:${FONT};font-size:23px;line-height:1;font-weight:800;letter-spacing:-1px;color:${C.text}`, `<span class="em-t">sprint</span><span class="em-acc" style="color:${BLUE}">2</span><span class="em-t">go</span>`)}`), '', ' align="left" width="auto"');
  }
  const fg = contrast('#ffffff', b.color) >= 3 ? '#ffffff' : C.text;
  const tile = b.logoUrl
    ? `<img src="${esc(b.logoUrl)}" width="36" height="36" alt="${esc(b.name)}" style="display:block;width:36px;height:36px;border:0;outline:none;border-radius:10px;object-fit:cover">`
    : table(row(td(`width:36px;height:36px;background:${b.color};border-radius:10px;text-align:center;vertical-align:middle;font-family:${FONT};font-size:17px;font-weight:800;color:${fg};mso-line-height-rule:exactly;line-height:36px`, esc((b.name.trim()[0] ?? '?').toUpperCase()))), 'width:36px', ' width="36"');
  return table(row(`${td('width:36px;padding:0 12px 0 0;vertical-align:middle', tile)}${td(`vertical-align:middle;font-family:${FONT};font-size:18px;line-height:1.2;font-weight:700;letter-spacing:-0.3px;color:${C.text}`, `<span class="em-t">${esc(b.name)}</span>`)}`), '', ' align="left" width="auto"');
}

function button(text: string, url: string, color: string) {
  const fg = contrast('#ffffff', color) >= 3 ? '#ffffff' : C.text;
  const w = Math.min(520, Math.round(text.length * 8.6 + 60));
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;margin:8px 0 4px"><tr><td align="center" bgcolor="${color}" style="border-radius:9999px;background:${color}">
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${esc(url)}" style="height:48px;v-text-anchor:middle;width:${w}px;" arcsize="50%" stroke="f" fillcolor="${color}"><w:anchorlock/><center style="color:${fg};font-family:Arial,sans-serif;font-size:15px;font-weight:bold;">${esc(text)}</center></v:roundrect><![endif]--><!--[if !mso]><!-- --><a href="${esc(url)}" target="_blank" style="display:inline-block;padding:14px 26px;font-family:${FONT};font-size:15px;line-height:20px;font-weight:600;color:${fg};text-decoration:none;border-radius:9999px;mso-padding-alt:0">${esc(text)}</a><!--<![endif]-->
</td></tr></table>`;
}

function blockHtml(x: Block, b: Brand, link: string): string {
  const body = `font-family:${FONT};font-size:15px;line-height:24px;color:${C.text2};margin:0 0 16px`;
  if ('p' in x) return `<p class="${x.muted ? 'em-t3' : 'em-t2'}" style="${body};${x.muted ? `color:${C.text3};font-size:13.5px;line-height:21px` : ''}">${x.html ? x.p : lines(x.p)}</p>`;
  if ('heading' in x && !('list' in x)) return `<p class="em-t" style="font-family:${FONT};font-size:13px;line-height:18px;font-weight:700;color:${C.text};margin:24px 0 8px">${esc(x.heading)}</p>`;
  if ('code' in x) {
    // One run of text (letter-spaced, not split into boxes) so a long-press or double-click copies just the digits.
    return table(
      row(td(`background:${C.soft};border-radius:14px;padding:22px 16px 18px;text-align:center`, `<div class="em-t" style="font-family:${FONT};font-size:38px;line-height:44px;font-weight:800;letter-spacing:10px;color:${C.text};padding-left:10px;-webkit-user-select:all;user-select:all">${esc(x.code)}</div>${x.note ? `<div class="em-t3" style="font-family:${FONT};font-size:13px;line-height:18px;color:${C.text3};margin-top:8px">${esc(x.note)}</div>` : ''}`, ' class="em-soft"')),
      'margin:4px 0 20px',
    );
  }
  if ('rows' in x) {
    const r = (k: string, v: string, strong = false) =>
      row(
        td(`padding:11px 0;border-bottom:1px solid ${C.line};font-family:${FONT};font-size:14px;line-height:20px;color:${strong ? C.text : C.text3};${strong ? 'font-weight:700;font-size:15px' : ''}`, esc(k), ` class="em-line ${strong ? 'em-t' : 'em-t3'}"`) +
          td(`padding:11px 0 11px 16px;border-bottom:1px solid ${C.line};font-family:${FONT};font-size:14px;line-height:20px;color:${C.text};text-align:right;${strong ? 'font-weight:800;font-size:17px' : 'font-weight:600'}`, esc(v), ' class="em-line em-t" align="right"'),
      );
    return table(x.rows.map(([k, v]) => r(k, v)).join('') + (x.total ? r(x.total[0], x.total[1], true) : ''), 'margin:0 0 20px;border-top:1px solid ' + C.line, ' class="em-line"');
  }
  if ('list' in x) {
    const items = x.list
      .map((i) =>
        row(
          td('width:20px;padding:0;vertical-align:top', `<div style="width:8px;height:8px;border-radius:4px;background:${i.color ?? b.color};font-size:0;line-height:0;margin-top:7px">&nbsp;</div>`) +
            td(`padding:0 0 9px;vertical-align:top;font-family:${FONT};font-size:15px;line-height:22px;color:${C.text2}`, i.url ? `<a href="${esc(i.url)}" class="em-t" style="color:${C.text};text-decoration:none;font-weight:500">${esc(i.text)}</a>` : `<span class="em-t2">${esc(i.text)}</span>`),
        ),
      )
      .join('');
    return `${x.heading ? `<p class="em-t" style="font-family:${FONT};font-size:13px;line-height:18px;font-weight:700;color:${C.text};margin:16px 0 8px">${esc(x.heading)}</p>` : ''}${table(items, 'margin:0 0 6px')}`;
  }
  if ('notice' in x) {
    const warn = x.tone !== 'info';
    return table(row(td(`background:${warn ? C.warnSoft : C.soft};border-radius:12px;padding:14px 16px;font-family:${FONT};font-size:14px;line-height:21px;color:${warn ? '#7c3a06' : C.text2}`, lines(x.notice), ` class="${warn ? 'em-warn' : 'em-soft em-t2'}"`)), 'margin:0 0 20px');
  }
  if ('quote' in x) {
    return table(
      row(td(`border-left:3px solid ${b.color};background:${C.soft};border-radius:0 12px 12px 0;padding:14px 16px;font-family:${FONT};font-size:15px;line-height:23px;color:${C.text}`, `<span class="em-t">${lines(x.quote)}</span>${x.by ? `<div class="em-t3" style="font-size:13px;line-height:18px;color:${C.text3};margin-top:8px">${esc(x.by)}</div>` : ''}`, ' class="em-soft"')),
      'margin:0 0 20px',
    );
  }
  if ('button' in x) return `<div style="margin:4px 0 20px">${button(x.button.text, x.button.url, b.color)}</div>`;
  if ('links' in x) return `<p style="${body};font-size:14px">${x.links.map((l) => `<a href="${esc(l.url)}" class="em-link" style="color:${link};text-decoration:none;font-weight:600">${esc(l.text)}</a>`).join('<span class="em-t3" style="color:' + C.text3 + '">&nbsp;&nbsp;·&nbsp;&nbsp;</span>')}</p>`;
  return '';
}

function blockText(x: Block): string {
  const strip = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  if ('p' in x) return x.html ? strip(x.p) : x.p;
  if ('heading' in x && !('list' in x)) return x.heading;
  if ('code' in x) return `${x.code}${x.note ? `\n${x.note}` : ''}`;
  if ('rows' in x) return [...x.rows, ...(x.total ? [x.total] : [])].map(([k, v]) => `${k}: ${v}`).join('\n');
  if ('list' in x) return [...(x.heading ? [x.heading] : []), ...x.list.map((i) => `- ${i.text}${i.url ? `\n  ${i.url}` : ''}`)].join('\n');
  if ('notice' in x) return x.notice;
  if ('quote' in x) return `${x.quote.split('\n').map((l) => `> ${l}`).join('\n')}${x.by ? `\n${x.by}` : ''}`;
  if ('button' in x) return `${x.button.text}: ${x.button.url}`;
  if ('links' in x) return x.links.map((l) => `${l.text}: ${l.url}`).join('\n');
  return '';
}

/** Who it's from, the last footer line. */
function fromLine(b: Brand) {
  if (b.own) return t('Sent by sprint2go, the team app for mail, chat and tasks.');
  return b.via ? t('Sent by {company} through sprint2go.', { company: b.name }) : t('Sent by {company}.', { company: b.name });
}

/** One finished email: the HTML (layout, inline styles) and its plain-text twin. */
export function renderEmail(o: EmailInput): { html: string; text: string } {
  const b = o.brand ?? sprint2goBrand();
  const link = inkOn(b.color);
  const linkDark = inkDark(b.color);
  const foot = [...(o.footer ?? []), fromLine(b)];
  const pre = esc(o.preheader) + '&nbsp;&#847;&zwnj;'.repeat(60);
  const html = `<!doctype html>
<html lang="${esc(o.lang ?? getLang())}" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(o.title)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><style>table,td,p,a,span,div{font-family:Arial,sans-serif!important}</style><![endif]-->
<!--[if !mso]><!--><link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet"><!--<![endif]-->
<style>
:root{color-scheme:light dark;supported-color-schemes:light dark}
body{margin:0!important;padding:0!important;width:100%!important;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
a{text-decoration:none}
@media (max-width:620px){.em-pad{padding:28px 22px 12px!important}.em-out{padding:20px 12px 28px!important}.em-title{font-size:22px!important;line-height:29px!important}.em-foot{padding:20px 10px 0!important}}
@media (prefers-color-scheme:dark){
.em-bg{background:#0b0c10!important}.em-card{background:#16171d!important;border-color:#2a2c35!important}
.em-t{color:#f2f3f7!important}.em-t2{color:#c9cbd4!important}.em-t3{color:#8d909e!important}
.em-soft{background:#20222b!important}.em-line{border-color:#2a2c35!important}
.em-warn{background:#3a2611!important;color:#f8c690!important}.em-acc{color:#7d93ff!important}.em-link{color:${linkDark}!important}
}
[data-ogsc] .em-t{color:#f2f3f7!important}[data-ogsc] .em-t2{color:#c9cbd4!important}[data-ogsc] .em-t3{color:#8d909e!important}[data-ogsc] .em-acc{color:#7d93ff!important}[data-ogsc] .em-link{color:${linkDark}!important}
[data-ogsb] .em-bg{background:#0b0c10!important}[data-ogsb] .em-card{background:#16171d!important}[data-ogsb] .em-soft{background:#20222b!important}
</style>
</head>
<body class="em-bg" style="margin:0;padding:0;background:${C.page};word-spacing:normal">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${C.page};opacity:0">${pre}</div>
${table(
  row(
    td(
      `padding:32px 16px 40px;background:${C.page}`,
      `<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
${table(
  row(td('padding:0 4px 18px', header(b))) +
    row(
      td(
        `background:${C.card};border:1px solid ${C.border};border-radius:18px;padding:36px 40px 20px`,
        `<h1 class="em-t em-title" style="font-family:${FONT};font-size:24px;line-height:31px;font-weight:800;letter-spacing:-0.4px;color:${C.text};margin:0 0 14px">${esc(o.title)}</h1>
${o.blocks.map((x) => blockHtml(x, b, link)).join('\n')}`,
        ' class="em-card em-pad"',
      ),
    ) +
    row(
      td(
        `padding:22px 24px 0;font-family:${FONT};font-size:12.5px;line-height:19px;color:${C.text3};text-align:center`,
        foot.map((f) => `<p class="em-t3" style="margin:0 0 6px;color:${C.text3}">${lines(f)}</p>`).join('') + (o.footerLink ? `<p style="margin:0 0 6px"><a href="${esc(o.footerLink.url)}" class="em-t3" style="color:${C.text3};text-decoration:underline">${esc(o.footerLink.text)}</a></p>` : ''),
        ' class="em-foot"',
      ),
    ),
  'max-width:600px;margin:0 auto;border-collapse:separate',
  ' align="center"',
)}
<!--[if mso]></td></tr></table><![endif]-->`,
      ' class="em-bg em-out" align="center"',
    ),
  ),
  `background:${C.page}`,
  ' class="em-bg"',
)}
</body>
</html>`;
  const text = [o.title, '', ...o.blocks.map(blockText).flatMap((s) => [s, '']), '--', ...foot, ...(o.footerLink ? [`${o.footerLink.text}: ${o.footerLink.url}`] : [])].join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  return { html, text };
}

/** The common "a code for you" email (sign-up, password, confidential email, shared file). */
export function codeEmail(o: { brand?: Brand; title: string; lead: string; preheader?: string; code: string; minutes?: number; footer?: string[]; lang?: string }) {
  return renderEmail({
    brand: o.brand,
    preheader: o.preheader ?? o.lead,
    title: o.title,
    blocks: [{ p: o.lead }, { code: o.code, note: t('Works for {n} minutes', { n: o.minutes ?? 15 }) }],
    footer: o.footer ?? [t('Didn’t ask for this? You can ignore it.')],
    lang: o.lang,
  });
}
