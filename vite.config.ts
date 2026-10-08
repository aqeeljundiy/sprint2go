import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * The service worker (src/sw.js) goes out as /sw.js, stamped with this build: a new build is a new worker, which
 * takes over at once, so a deploy reaches installed phones without anyone reinstalling.
 */
function serviceWorker(): Plugin {
  const source = (build: string) => readFileSync('src/sw.js', 'utf8').replace('__BUILD__', build);
  return {
    name: 's2g-service-worker',
    generateBundle(_options, bundle) {
      const build = createHash('sha256').update(Object.keys(bundle).sort().join('\n')).update(readFileSync('src/sw.js')).update(readFileSync('public/offline.html')).update(readFileSync('public/offline.js')).digest('hex').slice(0, 12);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: source(build) });
    },
    // In development the worker isn't registered by itself; this is here for turning notifications on to try them.
    configureServer(server) {
      server.middlewares.use('/sw.js', (_req, res) => {
        res.setHeader('content-type', 'text/javascript');
        res.end(source('dev'));
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), serviceWorker()],
  // `npm run dev` talks to the local server (npm run server) for data, sign-in and AI.
  // Two pages: the app (index.html) and the public landing page (landing.html, small and fast, no app code).
  build: { rollupOptions: { input: { app: 'index.html', landing: 'landing.html' } } },
  server: { proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false } } },
});
