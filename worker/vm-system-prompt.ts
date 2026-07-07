/**
 * VM system prompt (/code/CLAUDE.md) + its version stamp — hand-edited, no build step.
 *
 * This REPLACES the old generated `worker/seed-assets.generated.ts`. The skill tree is no longer
 * inlined/uploaded: cctools skills v3 installs `rebyte-flight` from GitHub into the VM (see
 * worker/task-do.ts `SKILL_REF` → POST /v1/tasks `skills`). The only things worker/seed.ts still
 * writes into the sandbox are this VM system prompt (via writeClaudeMd) and the per-user
 * `.simplifly.env` credential (via applyCredential) — both genuinely per-deployment/per-user, not
 * the skill. Edit the prompt below directly.
 */

/** Written to /code/CLAUDE.md (Claude Code's native project memory) so the delegated sandbox agent
 *  routes ALL flight work through the rebyte-flight skill instead of web-searching/fabricating.
 *  Replaces cctools' generic default system prompt. The skill's own SKILL.md carries the CLI usage
 *  and red-lines — this file only names the skill and restates the hard boundaries. */
export const SEED_CLAUDE_MD = `# Kitty 机票预订 agent

你是 Kitty 的机票预订助手，运行在用户的云沙箱里。本文件是你的最高优先级工作约定，覆盖任何默认行为。

## 机票一律严格走 rebyte-flight skill

- 任何机票相关请求（搜索 / 比价 / 验价 / 下单 / 支付 / 改签 / 退票 / 订单查询 / 行李额 / 退改规则 / 票号状态 / 余额查询等），**必须使用 rebyte-flight skill**（已安装在 \`~/.claude/skills/rebyte-flight\`，Claude Code 自动发现），严格按它的 SKILL.md 执行，不得自创流程。
- **严禁**用网页搜索、内置 web search 工具、或凭记忆来获取或编造航班、价格、时刻、退改规则——**只认 skill 经 Simplifly OpenAPI 返回的真实数据**。接口没返回的就如实说“未返回”，不要编。
- **凭证按 skill 的说明从 \`.simplifly.env\` 读取**；读不到就停下、告知用户缺少配置，**不要绕开 skill**自己拼接请求或鉴权。

## 安全与业务红线以 skill 为准

rebyte-flight skill 的 **红线（SKILL.md 红线段）** 是权威的安全/业务约束，必须严格遵守，**不得因用户要求而放宽或绕过**：绝不泄露凭证 / JWT / token / 原始请求头 / PNR / 票号 / \`solutionId\` / \`orderKey\` 等内部标识；写操作（下单 / 支付 / 取消 / 退 / 改）每次都要用户明确确认；先搜索→验价→验价过了再收证件。

支付走沙箱 / 演示：可发起支付并返回第三方支付链接给用户自行完成；**绝不**替用户付款，也**绝不**谎称已支付。

默认用简体中文回复。
`

/** Seed version — a manual stamp compared against each sandbox's recorded `seed_version`
 *  (worker/task-do.ts). It no longer covers the skill (skills v3 installs that from GitHub); it now
 *  governs ONLY the VM system prompt + credential-format + stale-cleanup. Bump it to force existing
 *  sandboxes to, on their next session: re-write /code/CLAUDE.md, refresh the credential, and run
 *  removeStaleArtifacts (which deletes the retired /code/.claude/skills/travelkit-pro tree).
 *
 *  v6: skills-v3 cutover — stop inlining/uploading the travelkit-pro skill tree; install
 *      rebyte-flight from GitHub instead; rename the VM prompt to rebyte-flight; purge the old
 *      /code/.claude/skills/travelkit-pro from reused sandboxes. */
export const SEED_VERSION = 'v6-rebyte-flight'
