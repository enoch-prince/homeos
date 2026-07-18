import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
      manifest: {
        name: 'HomeOS',
        short_name: 'HomeOS',
        description: 'Your household operating system',
        theme_color: '#1a1a2e',
        background_color: '#1a1a2e',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/api\.groq\.com\/.*/i,
            handler: 'NetworkFirst',
            options: { cacheName: 'groq-api', networkTimeoutSeconds: 5 },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: [
      { find: '@homeos/backend/middleware/validator',  replacement: fileURLToPath(new URL('../backend/src/middleware/validator.ts', import.meta.url)) },
      { find: '@homeos/backend/services/voice-processor', replacement: fileURLToPath(new URL('../backend/src/services/voice-processor.ts', import.meta.url)) },
      { find: '@homeos/backend/testing/mock-db',      replacement: fileURLToPath(new URL('../backend/src/testing/mock-db.ts', import.meta.url)) },
      { find: '@homeos/backend/testing/fixtures',     replacement: fileURLToPath(new URL('../backend/src/testing/fixtures.ts', import.meta.url)) },
      { find: '@homeos/backend',   replacement: fileURLToPath(new URL('../backend/src/index.ts', import.meta.url)) },
      { find: '@homeos/schemas',   replacement: fileURLToPath(new URL('../schemas/src/index.ts', import.meta.url)) },
      { find: '@',                 replacement: fileURLToPath(new URL('./src', import.meta.url)) },
    ],
  },
})
