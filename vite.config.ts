import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icono.svg', 'robots.txt', 'push-sw.js'],
      manifest: {
        name: 'Tablero Zero',
        short_name: 'Tablero Zero',
        description: 'Pendientes de Zero-Ohms Robotics',
        lang: 'es-MX',
        start_url: '/',
        display: 'standalone',
        background_color: '#FBF4E6',
        theme_color: '#590202',
        icons: [
          { src: 'icono-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icono-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icono-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        importScripts: ['push-sw.js'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin.includes('fonts.g'),
            handler: 'CacheFirst',
            options: { cacheName: 'fuentes', expiration: { maxEntries: 20, maxAgeSeconds: 31536000 } },
          },
          // SEG-003: las respuestas autenticadas de Supabase (/rest, /auth, /storage, /functions) NO se guardan
          // en la caché del service worker: es compartida entre usuarios del mismo dispositivo.
        ],
      },
    }),
  ],
  test: { include: ['tests/**/*.test.ts'], testTimeout: 30000 },
} as never);
