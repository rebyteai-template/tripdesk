/**
 * Server entry. Mounts the API at /api/app (matching the Vite dev proxy and a
 * future single-service prod deploy) and serves the built SPA in production.
 */
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { env } from './env.ts'
import { app as api } from './routes.ts'
import { DEFAULT_PROJECT_ID, ensureProject } from './project.ts'

ensureProject(DEFAULT_PROJECT_ID)

const top = new Hono()
top.route('/api/app', api)

// In prod, serve the Vite build. In dev the SPA is served by Vite on :4000.
top.get('/', serveStatic({ root: './build', path: 'index.html' }))
top.get('*', serveStatic({ root: './build' }))

serve({ fetch: top.fetch, port: env.PORT }, (info) => {
  console.log(`[tripdesk] api on http://127.0.0.1:${info.port}  (backend: ${env.BACKEND}, payment: ${env.PAYMENT_MODE})`)
  console.log(`[tripdesk] data dir: ${env.DATA_DIR}`)
  console.log(`[tripdesk] claude bin: ${env.CLAUDE_BIN}`)
})
