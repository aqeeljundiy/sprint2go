// BIMI: a company's logo next to its mail in inboxes that support it. sprint2go does the plumbing only:
//  - an SVG logo, checked for the SVG Tiny PS basics BIMI asks for (version 1.2, baseProfile tiny-ps, a title, square,
//    no scripts, animation, embedded pictures or references outside the file), kept as one of the company's files;
//  - served at a stable https address (/bimi/<company>.svg on the app's own address);
//  - the exact default._bimi TXT record, and whether DNS has it and DMARC is strict enough (quarantine or reject).
// Gmail (and Apple Mail) also need a VMC or CMC certificate for the logo, which needs 12 months of the logo in use or a
// registered trademark. Nothing here can get that, so nothing here says the logo shows.
import { promises as dns } from 'node:dns';
import * as db from './db.ts';

export const MAX_BYTES = 32 * 1024; // BIMI's guidance for the logo file
export type Bimi = { fileId: string; name: string; at: string; by: string };

/** The problems with an SVG as a BIMI logo, in plain words; none means it passes the basics. */
export function svgProblems(raw: string): string[] {
  const svg = String(raw ?? '');
  const out: string[] = [];
  if (!svg.trim()) return ['The file is empty.'];
  if (Buffer.byteLength(svg) > MAX_BYTES) out.push(`It’s ${Math.round(Buffer.byteLength(svg) / 1024)} KB; BIMI logos should be 32 KB or less.`);
  if (/<!DOCTYPE|<!ENTITY/i.test(svg)) out.push('It has a DOCTYPE or ENTITY declaration, which BIMI logos can’t have.');
  const root = svg.replace(/^﻿/, '').replace(/^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*/i, '').match(/^<svg\b([^>]*)>/i);
  if (!root) return [...out, 'It isn’t an SVG file: it should start with an <svg> element.'];
  const attrs = root[1];
  const attr = (name: string) => attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'))?.[2];
  if (attr('version') !== '1.2') out.push('Its <svg> element needs version="1.2" (SVG Tiny 1.2).');
  if ((attr('baseProfile') ?? '').toLowerCase() !== 'tiny-ps') out.push('Its <svg> element needs baseProfile="tiny-ps" (the SVG profile BIMI uses).');
  if (attr('x') !== undefined || attr('y') !== undefined) out.push('Its <svg> element can’t have x or y.');
  if (!/<title\b[^>]*>\s*[^<\s][^<]*<\/title>/i.test(svg)) out.push('It needs a <title> with the company’s name.');
  // Square: by its viewBox, or its width and height when it has no viewBox.
  const vb = attr('viewBox')?.trim().split(/[\s,]+/).map(Number);
  const w = parseFloat(attr('width') ?? '');
  const h = parseFloat(attr('height') ?? '');
  if (vb && vb.length === 4 && vb.every(Number.isFinite)) {
    if (Math.abs(vb[2] - vb[3]) > 0.001) out.push(`It isn’t square: its viewBox is ${vb[2]} by ${vb[3]}. BIMI logos must be square.`);
  } else if (Number.isFinite(w) && Number.isFinite(h)) {
    if (Math.abs(w - h) > 0.001) out.push(`It isn’t square: it’s ${w} by ${h}. BIMI logos must be square.`);
  } else out.push('It has no viewBox (or width and height), so it can’t be checked for being square.');
  if (/<script\b/i.test(svg)) out.push('It has a script, which BIMI logos can’t have.');
  if (/\son[a-z]+\s*=/i.test(svg)) out.push('It has event handlers (onclick and the like), which BIMI logos can’t have.');
  if (/javascript:/i.test(svg)) out.push('It has a javascript: address, which BIMI logos can’t have.');
  if (/<(foreignObject|iframe|embed|object)\b/i.test(svg)) out.push('It embeds other content (foreignObject), which BIMI logos can’t have.');
  if (/<image\b/i.test(svg)) out.push('It has an embedded picture (<image>). BIMI logos must be drawn shapes only.');
  if (/<(animate|animateTransform|animateMotion|animateColor|set)\b/i.test(svg)) out.push('It’s animated. BIMI logos must be still.');
  // References outside the file: any href that isn't to something inside it, url() to anything else, @import.
  const hrefs = [...svg.matchAll(/(?:xlink:)?href\s*=\s*(["'])(.*?)\1/gi)].map((m) => m[2].trim());
  const urls = [...svg.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)].map((m) => m[2].trim());
  if ([...hrefs, ...urls].some((r) => r && !r.startsWith('#')) || /@import/i.test(svg)) out.push('It points at something outside the file (a link, font or picture). Everything has to be inside the SVG.');
  return out;
}

/** Where the logo is served from: the app's own address, the same for as long as the company has a logo. */
export const logoUrl = (publicUrl: string, wsId: string) => `${publicUrl.replace(/\/$/, '')}/bimi/${encodeURIComponent(wsId)}.svg`;
/** The exact TXT record at default._bimi.<domain>. No certificate (a=) until the company has one. */
export const bimiRecord = (url: string) => `v=BIMI1; l=${url}; a=;`;

const pub = new dns.Resolver({ timeout: 4000, tries: 2 });
pub.setServers(['1.1.1.1', '8.8.8.8']);
const txt = (host: string) => pub.resolveTxt(host).then((r) => r.map((x) => x.join('')), () => [] as string[]);

/** What the Email delivery page shows: the logo, the record, and what DNS says about it and about DMARC. */
export async function bimiState(ws: { id: string; bimi?: Bimi }, domain: string, publicUrl: string) {
  const url = logoUrl(publicUrl, ws.id);
  const logo = ws.bimi && db.fileInfo(ws.bimi.fileId) ? ws.bimi : null;
  const host = `default._bimi.${domain}`;
  const [bimiTxt, dmarcTxt] = await Promise.all([txt(host), txt(`_dmarc.${domain}`)]);
  const found = bimiTxt.find((t) => /^v=BIMI1/i.test(t.trim())) ?? null;
  const l = found?.match(/(?:^|;)\s*l=([^;]*)/i)?.[1].trim() ?? null;
  const dmarc = dmarcTxt.find((t) => /^v=DMARC1/i.test(t.trim())) ?? null;
  const policy = dmarc?.match(/(?:^|;)\s*p=([a-z]+)/i)?.[1].toLowerCase() ?? null;
  const pct = Number(dmarc?.match(/(?:^|;)\s*pct=(\d+)/i)?.[1] ?? 100);
  return {
    domain,
    url,
    https: url.startsWith('https://'),
    logo,
    record: { type: 'TXT', host: 'default._bimi', value: bimiRecord(url) },
    dns: { found, matches: !!found && l === url },
    dmarc: { found: dmarc, policy, enforced: (policy === 'quarantine' || policy === 'reject') && pct === 100 },
  };
}
