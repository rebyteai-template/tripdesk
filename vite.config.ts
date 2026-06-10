import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Frontend dev server on 4000; the API runs under `wrangler dev` on 8787 (local
// Worker + local D1 + local DO). The client always talks to `/api/app/*`, proxied
// here in dev and same-origin in prod.
export default defineConfig({
  plugins: [react()],
  // Bump the persisted-query-cache buster on every build so a new deploy never
  // hydrates a stale snapshot shaped to an old schema (see lib/queryPersist.ts).
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  server: {
    host: '127.0.0.1',
    port: 4000,
    proxy: {
      '/api/app': 'http://127.0.0.1:8787',
    },
  },
  build: {
    outDir: 'build',
  },
})
