import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Frontend dev server on 4000, API on 4001 (proxied). Mirrors adits' layout
// so the client always talks to `/api/app/*` whether in dev or prod.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 4000,
    proxy: {
      '/api/app': 'http://127.0.0.1:4001',
    },
  },
  build: {
    outDir: 'build',
  },
})
