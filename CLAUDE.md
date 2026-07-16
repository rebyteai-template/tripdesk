# TravelKit Repository Instructions

先读 [README.md](./README.md) 了解当前架构，再按 [PRODUCT.md](./PRODUCT.md) 和 [DESIGN.md](./DESIGN.md) 处理产品与视觉问题。代码事实优先于历史 TODO 和旧问题记录。

## 当前系统事实

- UI 是“会话侧栏 + 单列聊天流”，领域表格、推荐和写操作流程都在聊天内联渲染；没有独立右侧 bench。
- 航班能力来自 `simplifly-flyai-skill` CLI 直连 Simplifly Flight OpenAPI，不是 TravelKit MCP。
- Skill 由 Rebyte skills v3 从 `TravelKit-AI/simplifly-flyai-skill` 的远端 `main` 安装。改 Skill 要在 sibling repo 提交并 push；不要把 Skill 逻辑复制进 TravelKit。
- 当前鉴权是 `worker/index.ts` 的 embed handoff：`k`（配置 `EMBED_KEY` 时）、`uid`、`org`、`token`。`worker/auth.ts` 的 Cloudflare Access JWT 不在请求链上。
- `TaskDO.replaySubPrompt()` 已能把子会话结构化 `tool_result` 回放进父任务。不要再按“结构化结果回不来”的旧假设设计 fallback。

## 推荐边界

- `flight-recommendations/v1` 是唯一权威最终推荐；search/pricing/verify 是中间证据。
- TravelKit 只做契约与安全校验：版本、字段、唯一 `planId`、人数、票组覆盖、币种、总价、capability。
- TravelKit 不评价方案质量，不按价格、时间窗、经停次数或本地时钟删除、合并、重排方案，也不根据 `partial` 或 `budgetStatus` 自行生成业务警告。
- 有方案时原样渲染；只有 Skill 明确提供 `message` 或 `reason` 时才展示说明。推荐不好、缺直飞或排序不合理，一律修 FlyAI Skill。
- 同一用户轮次若出现多个不同的 plan-bearing `flight.recommendations`，视为 Agent 拆分了最终推荐协议并 fail closed；不得静默采用最后一个，也不得在 TravelKit 合并。相同结果的事件回放可去重。
- 不从 Agent Markdown 或 tool event 顺序推断最终航班事实。

## 安全红线

- 写操作（下单、支付、取消、退票、改签）执行前必须获得用户明确确认。
- API 未返回的行李、退改、中转信息不得编造。
- `solutionId`、`orderKey`、PNR、票号可以在内部工作台流转；token、环境变量、请求头和凭证文件内容绝不进入 UI、日志、提交或聊天。
- 不替用户付款，不谎称支付成功。

## 常用命令

```bash
pnpm dev
pnpm test
pnpm typecheck
pnpm build
pnpm db:migrate:local   # 仅 schema 变化时
```

Node 固定 22。保留工作区中与当前任务无关的用户修改；不要用破坏性 git 命令清理它们。
