/**
 * Storage entry point. The app talks to the async `Store` interface (server/store.ts)
 * and never to a concrete database. On Cloudflare the only driver is D1 — and since
 * `wrangler dev` gives a local D1, it's also the dev store (no separate sqlite driver).
 *
 * The D1 binding is per-request (env.DB), so there is NO module-global singleton here
 * the way the old better-sqlite3 build had: callers build the store from their binding
 * via createD1Store(env.DB). (pg/mysql could return later as sibling driver files.)
 */
export { createD1Store } from './store-d1.ts'
export type { Store, Task, Prompt, Frame } from './store.ts'
