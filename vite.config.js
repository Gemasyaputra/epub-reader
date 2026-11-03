import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icons/icon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Lembar — Pembaca EPUB',
        short_name: 'Lembar',
        description: 'Baca buku EPUB & PDF dengan animasi membalik halaman, bisa dipakai tanpa internet.',
        lang: 'id',
        start_url: '/',
        scope: '/',
        // layar penuh (status & navigation bar HP disembunyikan); browser yang belum
        // mendukung otomatis memakai standalone
        display: 'fullscreen',
        display_override: ['fullscreen', 'standalone'],
        orientation: 'any',
        background_color: '#f3ede4',
        theme_color: '#8a4f2a',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // Chrome desktop: "Buka dengan Lembar" untuk file .epub & .pdf
        file_handlers: [{ action: '/', accept: { 'application/epub+zip': ['.epub'], 'application/pdf': ['.pdf'] } }],
        launch_handler: { client_mode: 'focus-existing' },
      },
      workbox: {
        // mjs = worker pdf.js (agar PDF tetap bisa dibuka saat offline)
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,webmanifest}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
