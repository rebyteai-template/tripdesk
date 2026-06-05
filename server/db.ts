/**
 * Storage entry point + driver selector. Call sites do `import { store } from
 * './db.ts'` and never see which database backs it — so the DB swaps by env alone
 * (the template's "switch whenever" goal; mirrors adits' DATABASE_URL pattern).
 *
 *   TRIPDESK_DB = sqlite (default, local zero-setup)
 *               | d1     (Cloudflare D1 — primary deploy target)
 *               | pg     (Postgres / AWS RDS)
 *               | mysql  (MySQL / GCP Cloud SQL)
 *
 * The Store interface (server/store.ts) is async so an edge/serverless driver
 * drops in unchanged. SQLite SQL uses `?` placeholders that D1 shares verbatim;
 * pg/mysql need a dialect driver. Only `sqlite` ships today; the rest land at
 * deploy time as sibling server/store-<driver>.ts files.
 */
import { env } from './env.ts'
import type { Store } from './store.ts'
import { createSqliteStore } from './store-sqlite.ts'

function createStore(): Store {
  switch (env.DB_DRIVER) {
    case 'sqlite':
      return createSqliteStore()
    case 'd1':
    case 'pg':
    case 'mysql':
      throw new Error(
        `DB 驱动 '${env.DB_DRIVER}' 待实现（部署阶段）：照 server/store-sqlite.ts 的 Store 接口加 ` +
          `server/store-${env.DB_DRIVER}.ts，并在此 case 实例化。SQL 已是可移植形状（D1 与 sqlite 同；pg/mysql 换方言）。`,
      )
    default:
      throw new Error(`未知 TRIPDESK_DB='${String(env.DB_DRIVER)}'，可选 sqlite|d1|pg|mysql。`)
  }
}

export const store: Store = createStore()
export type { Store, Task, Prompt, Frame, DbDriver } from './store.ts'
