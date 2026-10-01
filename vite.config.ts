import { defineConfig } from 'vite';

const apiTarget = 'http://127.0.0.1:3000';

export default defineConfig({
  // index.html at the project root is the app shell; it loads src/client/main.ts as the entry.
  esbuild: {
    jsx: 'transform',
    jsxFactory: 'h',
    jsxFragment: 'Fragment',
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
