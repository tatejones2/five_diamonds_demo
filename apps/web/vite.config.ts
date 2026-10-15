import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Pre-bundle deps used only by lazy routes so the dev server never force-reloads mid-session.
  optimizeDeps: { include: ['react-markdown', 'lucide-react', 'clsx', '@tanstack/react-query', 'react-router'] },
  server: {
    port: 5173,
    strictPort: true,
    // Same-origin API in development (ADR-006). Production uses a reverse proxy.
    proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: false }, '/sitemap.xml': { target: 'http://localhost:4000' } },
  },
  preview: { port: 4173, proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: false } } },
  build: {
    sourcemap: true,
    target: 'es2022',
    rollupOptions: {
      output: {
        // Long-cacheable vendor chunk; app code changes don't bust it.
        manualChunks: (id) => (/node_modules\/(react|react-dom|scheduler|react-router|@tanstack)\//.test(id) ? 'vendor' : undefined),
      },
    },
  },
});
