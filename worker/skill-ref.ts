/**
 * The flight skill reference — installed by the relay (cctools skills v3) from GitHub into the
 * workspace VM at ~/.claude/skills/rebyte-flight. Passed as the `skills` field on POST /v1/tasks.
 *
 * Shared by the production worker (worker/task-do.ts, first-turn task create) and the CLI probes
 * (server/rebyte/multiturn.ts, cardprobe.ts, subprobe.ts) so there is ONE source of truth for which
 * skill/ref installs. A `github:<owner/repo/tree/<branch>/<subdir>>` URL scopes the install to just
 * that skill dir. The repo is private → the relay clones it with the org's GitHub token (travelkit's
 * org binds GitHub in the rebyte UI).
 *
 * Tracking `main`: to update the skill, push to the repo — the next new session re-clones latest,
 * with zero travelkit rebuild/redeploy.
 */
export const SKILL_REF = 'github:https://github.com/rebyteai-template/rebyte-flight-skill/tree/main/skills/rebyte-flight'
