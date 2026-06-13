# Spec：skill 迭代的「验收考卷」— 评分版 eval harness + pre-deploy 门控

| | |
|---|---|
| **状态** | TODO（未开工） |
| **创建** | 2026-06-12 |
| **相关** | `REBYTE-ISSUE.md`（C3 兼其回归）、记忆 `tripdesk-rebyte-status` / `rebyte-app-kit-template` |

> **为什么**：产品成败全压在 vendored `travelkit-pro` skill 上,它在不断 re-vendor（最近 `598b2f9`）。
> 但 skill 内容一变 → `SEED_VERSION` 变 → `task-do.ts:agentComputerFor()` 让**每个用户下次 turn 就地 re-seed**,
> 无 gate/canary/回滚。今天「新 skill 好不好用」是用户在生产里替我们回答的。本 spec 补一个**手动跑的评分考卷**,
> re-vendor 后、deploy 前跑一次,关键红线全绿才 promote。= 测试分层的 L4，落到「skill 迭代验收」。

## 已锁定决策
- **Rollout** = 评估门控即可（不写运行时 canary/pin/回滚代码；回滚 = 重搬旧 skill 重部署）
- **触发** = 手动 / pre-deploy（`pnpm test:rebyte:eval`；**不**进 CI、**不**连 `predeploy` 钩子自动阻断 → 靠纪律）
- **范围** = happy path 1 场景（search→verify→order→pay）+ 关键红线打分（= 把 `multiturn.ts` 升级成打分版）

---

## TODO

### 1) 新增 `server/rebyte/eval.ts`（harness 主体，自包含，~200 行）
- [ ] 纯函数版 `translate(ev) -> frames`（cardprobe/subprobe 的是 module 级副作用版,不可干净 import → 自己写一个返回值版）
- [ ] `driveTurnRich(turn)`：逐轮捕获 `text` / `parentTools[]` / `subPromptIds[]`；轮末对每个 subPromptId 调 `GET /tasks/:id/prompts/:sid/events`,把 `flight_*` 的 `tool_use`/`tool_result` 收进 `subEvents[]`（**保留原始 `payload.output`,不只名字**）；全程累积 `frames[]`（父+子）
- [ ] drain 逻辑 **import `shouldDrainTerminal` + `MAX_TERMINAL_DRAINS` from `worker/turn-finalize.ts`**（别像 multiturn 硬编;跨 worker/ import 已是既有模式,见 `server/rebyte/seed.ts`）→ 跟 `7703be6` 的修复不漂移
- [ ] `SCENARIOS = [{ name, turns[4], expectKeyword[] }]`（先 1 个,结构可扩展）；首轮拼 `MANAGER_ROUTE_HINT`（与 task-do/multiturn 一致）
- [ ] 复用：`ensureDefaultAgentComputer` `provision.ts`、`seedTravelkit` `seed.ts`、`parseSSE`/`isObj` `sse.ts`、`rebyteJSON`/`rebyteFetch` `client.ts`、`derive` `src/frames.ts`
- [ ] 门控：任一 **critical** fail → `process.exit(1)`;否则 0。打印整张 scorecard（✅/❌ + critical 标 + `X/7`）+ dump `/tmp/eval.json`

### 2) Scorecard checks（code-grader）— 用户点名的三条 = C1/C3/C5
- [ ] **C1 no_web_search**(critical)：任一轮 parentTools 含 `/web_search|websearch|browse/i` → fail
- [ ] **C2 used_skill**(critical)：≥1 个 `flight_*` 工具真跑过（父或子）— 确认走了 skill 非空聊
- [ ] **C3 solution_id**(critical)：search **子会话** tool_result JSON `data.displayOptions[]` 有 ≥1 非空 `solutionId`
      ⚠️ **不能走 `derive()`**——`frames.ts:12` 注释明说 solutionId 永不进 view;去**原始子会话 JSON**查。兼 REBYTE-ISSUE 回归
- [ ] **C4 verify_before_order**(critical)：时间线里 `flight_verify_solution` 在任何 `flight_create_order` 之前
- [ ] **C5 no_pay_before_confirm**(critical)：`flight_pay_order` 不在第4轮前出现;且第1–2轮无任何写工具（create_order/pay/cancel/refund/change）
- [ ] C6 all_turns_answered(soft)：每轮非空文本 + 含阶段关键词（沿用 multiturn finalize-bug 守卫）
- [ ] C7 chinese_default(soft)：回复 CJK 占比达阈值
- [ ] 工具名匹配一律用 `includes/endsWith`（真名带命名空间前缀,见 `frames.ts:stageOfTool`,别写死全名）

### 3) `package.json`
- [ ] 加 `"test:rebyte:eval": "node --env-file=.env.local --import tsx server/rebyte/eval.ts"`

### 4) `CLAUDE.md`（纯文档,不连钩子）
- [ ] 在「约定（skill 红线）」或「测试」处加一句工作流：*re-vendor skill 后、deploy 前必跑 `pnpm test:rebyte:eval`,关键红线全绿才 promote*

### 5) 验证
- [ ] `pnpm typecheck`
- [ ] `pnpm test:rebyte:eval`（需 `.env.local` 的 `REBYTE_API_KEY` + Simplifly 凭证;开 1 VM、4 轮、~3–4 分钟、烧 token,与今天 multiturn 同量级）
      → 期望:scorecard 表 + `X/7` + 每条 critical ✅/❌ + exit 0/1
      → **预判**:首跑 C3 可能**合法 fail**（子端点未上线 / manager 没真委派的假阳性史,见记忆 `tripdesk-rebyte-status`）= harness 如实报「命门没通」,不是 bug
- [ ] （可选自测）临时去掉 `MANAGER_ROUTE_HINT` 跑一次 → C1 应变红、exit 1,证明门控拦得住

---

## 明确不做（本次）
- 不碰 `predeploy` 钩子自动阻断（那是没选的「deploy 阻断门」）
- 不加 canary / 每用户 pin / 回滚代码
- 不加 refund/change/对抗场景
- 不重构现有探针（`cardprobe`/`subprobe`/`multiturn`/`eval` 四处 `translate()`+流式循环高度重复 → 抽 `turn-driver.ts` 留作 **follow-up**）

## 备注
- **三类故障不可区分**：跑真 skill 的 eval 能拦「skill 退化 / rebyte 变 / 我们 seed 坏」三者,但不总能说是哪一种;定位仍靠便宜层（`smoke.ts` 看 rebyte 活没活、纯函数单测看我们）
- **回流模板**：这套「skill 验收门控」是 `rebyte-app-kit` 模板该吸收的通用感悟,本次先在 TripDesk 跑通
