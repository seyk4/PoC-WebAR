import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

// BASE_PATH diisi oleh workflow GitHub Pages (misalnya "/ar-print-preview-poc/").
// Saat pengembangan lokal tetap "/".
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [svelte()],
  // three.js membuat bundle sekitar 600 kB; ukuran ini wajar untuk PoC.
  build: {
    chunkSizeWarningLimit: 800,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
})
