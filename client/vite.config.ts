import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Gate',
        short_name: 'Gate',
        description: 'Monitor and continue Codex sessions across servers',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        // File previews/downloads are server responses, including when opened as a new page.
        navigateFallbackDenylist: [/^\/api(?:\/|\?|$)/, /^\/ws(?:\/|\?|$)/],
        // The optional terminal bundle contains its own WASM and loads on first use.
        globIgnores: ['**/TerminalPane-*.js'],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react';
          if (id.includes('node_modules/@radix-ui/')) return 'ui';
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    proxy: {
      // The backend checks the browser's Origin against the requested Host.
      '/api': { target: 'http://localhost:3030', changeOrigin: false },
      '/ws': { target: 'ws://localhost:3030', ws: true, changeOrigin: false }
    }
  }
})
