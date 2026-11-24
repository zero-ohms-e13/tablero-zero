import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icono.svg', 'robots.txt'],
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
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin.includes('fonts.g'),
            handler: 'CacheFirst',
            options: { cacheName: 'fuentes', expiration: { maxEntries: 20, maxAgeSeconds: 31536000 } },
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/rest/v1/'),
            handler: 'NetworkFirst',
            options: { cacheName: 'datos', networkTimeoutSeconds: 5, expiration: { maxEntries: 200, maxAgeSeconds: 604800 } },
          },
        ],
      },
    }),
  ],
  test: { include: ['tests/**/*.test.ts'], testTimeout: 30000 },
} as never);
