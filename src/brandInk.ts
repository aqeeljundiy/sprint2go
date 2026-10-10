// The company's brand colour becomes the accent (src/tokens.css). As text it must read at 4.5:1, which a light
// brand colour (coral, yellow, a pale blue) doesn't, so this works out the shade of it that does: darker on white
// (--brand-ink) and lighter on the dark surface (--brand-ink-dark).

const hex = (c: string): [number, number, number] | null => {
  const m = c.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, (x) => x + x) : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
};
const lum = ([r, g, b]: number[]) => {
  const f = (v: number) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a: number[], b: number[]) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const toHex = (c: number[]) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');

/** The first mix of `color` toward `to` that reads at 4.5:1 on `bg`. */
function ink(color: number[], to: number[], bg: number[]) {
  for (let t = 0; t <= 1; t += 0.04) {
    const c = mix(color, to, t);
    if (contrast(c, bg) >= 4.5) return toHex(c);
  }
  return toHex(to);
}

/** Sets --brand and the two text shades on the page. */
export function setBrand(color: string, root: HTMLElement = document.documentElement) {
  root.style.setProperty('--brand', color);
  const c = hex(color);
  if (!c) {
    root.style.removeProperty('--brand-ink');
    root.style.removeProperty('--brand-ink-dark');
    return;
  }
  root.style.setProperty('--brand-ink', ink(c, [0, 0, 0], [255, 255, 255]));
  // The dark accent is the brand lifted 26% toward white (tokens.css); its text shade starts there.
  root.style.setProperty('--brand-ink-dark', ink(mix(c, [242, 242, 242], 0.26), [255, 255, 255], [0x15, 0x17, 0x1b]));
}
