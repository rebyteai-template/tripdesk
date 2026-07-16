# TravelKit / Kitty

Kitty 是一个 Agent 驱动的机票业务工作台。当前界面是“会话侧栏 + 单列聊天流”：搜索表格、验价结果、最终推荐、乘客表单和确认步骤都在聊天流内展示。

航班事实来自独立的 [`simplifly-flyai-skill`](https://github.com/TravelKit-AI/simplifly-flyai-skill)。Skill 在 Rebyte 沙箱中通过 CLI 直连 Simplifly Flight OpenAPI；TravelKit 不直接搜索、组合或推荐航班。

## 本地运行

要求 Node 22 和 pnpm 10。

```bash
pnpm install
pnpm dev        # Vite :4000 + Wrangler :8787
pnpm test
pnpm typecheck
pnpm build
```

本地 Worker 使用 `.dev.vars`，CLI 探针使用 `.env.local`。两者都可能包含凭证，禁止提交、打印或复制到聊天中。

应用采用 iframe handoff 鉴权。宿主通过 URL fragment 传入 `uid`、`org`、TravelKit `token`，配置了 `EMBED_KEY` 时还需传 `k`：

```text
http://127.0.0.1:4000/#uid=<uid>&org=<org>&token=<token>&k=<embed-key>
```

SPA 首次加载后把这些值保存在当前标签页的 `sessionStorage`，随后从地址栏移除 fragment。裸开页面或缺少 `uid`、`org`、`token` 会显示“无法访问 Kitty”。`DEV_EMAIL` 只提供本地 uid fallback 和管理员判断，不能替代 `org` 与 `token`。

## 系统结构

```text
用户请求
  → React 单列聊天 UI
  → Cloudflare Worker / TaskDO
  → Rebyte agent-loop
  → 用户沙箱中的 simplifly-flyai-skill
  → Simplifly Flight OpenAPI
  → versioned tool_result
  → TaskDO 回放子会话结果并写入 D1 frames
  → src/frames.ts 解析契约
  → 聊天流内的领域组件渲染
```

- `worker/index.ts`：Hono 组合根、iframe handoff 鉴权、D1/DO/relay 依赖注入。
- `worker/task-do.ts`：每个任务的流式执行、断线续跑、子会话 `tool_result` 回放。
- `worker/skill-ref.ts`：Skill GitHub 来源。新 Rebyte session 从远端 `main` 安装 Skill。
- `server/routes.ts`：`/api/app/*` 会话、附件、SSE、调试配置接口。
- `server/store-d1.ts`：D1 `Store` 实现。迁移目前包含 `tasks`、`prompts`、`frames`、`kv`、`agent_computers`、`attachments` 和 `prompt_files`。
- `src/frames.ts`：把 versioned CLI JSON 转成只读 UI view model。
- `src/components/ChatPanel.tsx`：在聊天流内渲染文本、搜索表、验价、推荐与写操作流程。

Cloudflare Access JWT 代码仍存在于 `worker/auth.ts`，但不在当前请求链上。当前身份边界以 `worker/index.ts` 的 embed handoff 中间件为准。

## 航班推荐的责任边界

`flight-recommendations/v1` 是最终航班推荐的权威结果。`flight.search`、pricing 和 verify 结果只是中间证据。

### FlyAI Skill 负责

- 召回单程、往返、联合/开口程票价；
- 匹配不同舱等乘客组的同一物理航班；
- 组成完整方案并计算票组覆盖关系；
- 选择直飞、中转、时间窗等有意义的候选；
- 验价、失败补位、repricing 和最终排序；
- 生成总价、复制文本、状态、诊断信息与 capability。

推荐结果不好、缺少直飞、排序不合理或方案过于相似，应修 Skill，不应在 TravelKit 增加第二套推荐算法。

### TravelKit 负责

- 按 `schemaVersion` 和 `resultType` 解析结果；
- 校验必备字段、类型、唯一 `planId`、乘客人数、票组行程覆盖、币种、总价和 capability；
- 原样展示 Skill 已选择的方案；
- 使用 Skill 生成的 `copyText`；
- 最终推荐出现后，把 search/verify 结果降为折叠的只读证据；
- 同一用户轮次出现多个不同的 plan-bearing `flight.recommendations` 时拒绝取最后一个结果，按协议错误安全失败；重复回放的同一结果不算冲突；
- 对空结果、加载失败或非法契约进行安全降级。

TravelKit 不得按价格、时间窗、经停次数或本地时钟删除、合并、重排方案，也不得从 `partial`、`budgetStatus` 或诊断字段自行推导“不是最低价”等业务结论。有方案时只展示方案；只有 Skill 明确返回 `message` 或 `reason` 时，UI 才展示对应说明。

## Rebyte 与 Skill 更新

首轮 relay 请求携带 `skills:[SKILL_REF]`，Rebyte skills v3 从私有 GitHub repo 安装 Skill。`TaskDO.replaySubPrompt()` 会把委派子会话中的真实 `tool_result` 回放到父任务 frames，因此结构化搜索和推荐结果可以直接驱动 UI。

修改 FlyAI Skill 后必须提交并推送它自己的远端 `main`；新 session 才会安装新版本。单纯改 Skill 不需要修改或部署 TravelKit。

## 数据与安全边界

- `solutionId`、`orderKey`、PNR、票号等业务标识可以在内部工作台与后续 prompt 中流转，以支持精确验价和售后。
- token、环境变量、鉴权头和凭证文件内容不得进入 UI、日志、提交或聊天。
- 下单、支付、取消、退票和改签必须在执行前获得用户明确确认。
- API 没有返回的行李、退改或中转事实必须显示“未返回”或不展示，不能补写。
- 支付由用户在第三方页面完成；Agent 不替用户付款，也不宣称未确认的支付结果。

## 部署

```bash
set -a
source cloudflare.env
set +a
pnpm run deploy
```

线上地址为 `https://tripdesk.impo.ai`。裸访问 SPA 返回 200，但没有有效 handoff 时只显示门禁页；匿名访问 `/api/app/*` 应返回 401。只有 D1 schema 变化时才运行 `pnpm db:migrate` 或 `pnpm db:migrate:local`。

更多产品和视觉约束见 [PRODUCT.md](./PRODUCT.md) 与 [DESIGN.md](./DESIGN.md)。推荐管线的设计与实施记录见 [docs/2026-07-16-verified-flight-recommendation-pipeline.md](./docs/2026-07-16-verified-flight-recommendation-pipeline.md)，其中历史 commit、旧数量上限和实施状态不作为当前代码事实。
