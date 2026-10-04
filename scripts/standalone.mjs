// Bundles dist/ into one self-contained HTML file, so it can be opened without a server.
// JS and CSS are gzipped + base64'd and unpacked in the browser, which keeps the file small
// enough for preview panes that refuse large local files.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const assets = readdirSync('dist/assets');
const js = readFileSync(`dist/assets/${assets.find((f) => f.endsWith('.js'))}`);
const css = readFileSync(`dist/assets/${assets.find((f) => f.endsWith('.css'))}`);
const pack = (buf) => gzipSync(buf, { level: 9 }).toString('base64');

const loader = `<script type="module">
const unpack = async (s) => new Response(new Blob([Uint8Array.from(atob(s), (c) => c.charCodeAt(0))]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
const style = document.createElement('style');
style.textContent = await unpack('${pack(css)}');
document.head.appendChild(style);
const script = document.createElement('script');
script.type = 'module';
script.textContent = await unpack('${pack(js)}');
document.body.appendChild(script);
</script>`;

const html = readFileSync('dist/index.html', 'utf8')
  .replace(/<script type="module" crossorigin src="[^"]+"><\/script>/, '')
  .replace(/<link rel="stylesheet" crossorigin href="[^"]+">/, '')
  .replace('<link rel="icon" href="/favicon.svg" />', '')
  .replace('</body>', () => `${loader}</body>`);

writeFileSync('dist/sprint2go.html', html);
console.log(`wrote dist/sprint2go.html (${Math.round(html.length / 1024)} KB)`);
