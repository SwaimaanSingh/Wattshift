import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const resolve = (path) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  plugins: [react()],
  // Honour PORT so the dev server can be placed on a free port.
  server: { port: Number(process.env.PORT) || 5173 },
  // pdfjs-dist ships its worker as a separate chunk; keep it out of the
  // dependency pre-bundle so the ?url import resolves to a real file.
  optimizeDeps: { exclude: ['pdfjs-dist'] },
  build: {
    rollupOptions: {
      /**
       * The service worker is a second entry point. Anything under src/ is
       * only reachable through the module graph, so without this it would
       * never be emitted and /sw.js would 404 in production.
       */
      input: {
        main: resolve('./index.html'),
        sw: resolve('./src/sw.js'),
      },
      output: {
        /**
         * A worker's scope is the directory it is served from, so sw.js has
         * to land at the root, unhashed — /assets/sw-a1b2c3.js could only
         * ever control /assets. Everything else keeps Vite's default naming.
         */
        entryFileNames: (chunk) =>
          chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js',
        // Unchanged — sw.js imports nothing, so it is never pulled into these.
        manualChunks: {
          pdf: ['pdfjs-dist'],
          charts: ['recharts'],
        },
      },
    },
    chunkSizeWarningLimit: 900,
  },
});
