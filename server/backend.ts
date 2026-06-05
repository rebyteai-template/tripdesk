/**
 * Backend selector. routes.ts imports runTurn/cancelTurn from here; which
 * implementation it gets is decided once at boot by TRIPDESK_BACKEND (env.BACKEND):
 *   local  → spawn claude on this box       (server/task-runner.ts)
 *   rebyte → run the agent on the relay VM   (server/rebyte/task-runner.ts)
 * Both expose the identical contract, so the routes never change. Mirrors adits'
 * server/backend/index.ts.
 *
 * Importing the rebyte runner is cheap (its heavy sandbox SDK deps are lazy-loaded
 * inside runTurn), so a static import here is safe even in local mode.
 */
import { env } from './env.ts'
import * as local from './task-runner.ts'
import * as rebyte from './rebyte/task-runner.ts'

const backend = env.BACKEND === 'rebyte' ? rebyte : local

export const runTurn = backend.runTurn
export const cancelTurn = backend.cancelTurn
