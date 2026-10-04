import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // `npm run dev` talks to the local server (npm run server) for data, sign-in and AI.
  server: { proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false } } },
});
