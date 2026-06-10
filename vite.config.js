import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    basicSsl(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Camino al Cielo',
        short_name: 'CACapp',
        description: 'Sistema de gestión interno — Camino al Cielo',
        start_url: '/',
        display: 'standalone',
        background_color: '#F8F9FA',
        theme_color: '#263218',
        orientation: 'portrait-primary',
        lang: 'es-CO',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // Limpiar caches viejos de Workbox al activar nuevo SW
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Fuentes de Google — cache por 1 año
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: { cacheName: 'google-fonts-cache', expiration: { maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
          {
            // Supabase Contabo (producción) — siempre red, nunca cachear datos
            urlPattern: /^https:\/\/db\.orbitacac\.com\/.*/i,
            handler: 'NetworkOnly',
          },
          {
            // Anthropic API — siempre red
            urlPattern: /^https:\/\/api\.anthropic\.com\/.*/i,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) }
  },
  server: {
    host: true,
    https: true,
  }
})
