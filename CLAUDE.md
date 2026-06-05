# CLAUDE.md

AI 机票预订工作台（TripDesk）：左聊天、右 bench 渲染订票领域状态。agent 走完整在线机票流程（搜索→验价→下单→支付→售后），数据来自 **TravelKit MCP**（`https://mcp.travelkit.ai/mcp`）。产品与卡片设计见 **DESIGN.md**。

## 这是什么：Rebyte 能力的模板 demo（先读这条）

TripDesk 不是"一个订票应用"——它和姊妹项目 **adits**（`../adits`，做设计）是同一套东西的两个垂直示例：**真正卖的是 Rebyte 的能力**——① 跑 agent，② 跑 VM 沙箱，③ 跑你私有的 skill。每个 demo = 这套能力 + 为某业务场景配的一套 UI（adits=设计，travelkit=订票）。

- **复用模型（模板的意义）**：换场景 = 换 skill + 换 key/API + 配套卡片。所以从第一天就把**前端+server 与 Rebyte 连通彻底解耦**、key 边界保持干净、后端选择器化（`TRIPDESK_BACKEND`）、连通有测试覆盖——目的是下一个用户带自己的 skill + key，就能拿本项目当模板**快速**长出新垂直。改动越往「业务 UI / skill」集中、越不碰「Rebyte 连通 / 存储」越好。
- **部署目标**：主打 **Cloudflare**，并要能按场景方便切到 **AWS / GCP**。⇒ 存储与后端必须平台无关、可换（见「## 存储」）。adits 已是范本：后端按 env 选择器化，存储从 **Cloudflare D1** 迁过 **Postgres / MySQL**，call site 形状不变。

## 跑起来

```bash
pnpm install      # better-sqlite3 是原生模块，已在 pnpm.onlyBuiltDependencies 允许编译
pnpm dev:all      # vite(4000) + server(4001) → http://127.0.0.1:4000
pnpm typecheck    # tsc --noEmit
pnpm build        # vite build（远程访问看的是这个产物）
```

Node 固定 **22**（`.node-version`）；better-sqlite3 是原生模块，换 node 大版本后要 `pnpm rebuild better-sqlite3`。

机密放 `.env.local`（gitignored，**永不提交/打印**）：`REBYTE_API_KEY`、`TRIPDESK_BACKEND`、`TRIPDESK_PAYMENT_MODE` 等。

## 架构

- 前端 React+Vite(4000)，后端 Hono(4001)，`/api/app/*` 走代理。存储已抽象成可换的异步 `Store`（`server/store.ts`），本地走 sqlite 驱动（见「## 存储」）。
- **后端** `TRIPDESK_BACKEND`（`server/env.ts`）—— ⚠️ **永远用 `rebyte`，绝不用 `local` 来验证/演示/部署产品**：
  - `rebyte`（唯一可部署）—— agent 跑在 rebyte 托管 relay（`api.rebyte.ai/v1`，`API_KEY` 头），`server/rebyte/task-runner.ts`。**云端只有这条能用**。
  - `local`（不可部署，勿用）—— `spawn claude -p`（`server/task-runner.ts`），**要本机装 claude CLI**，部署到 Cloudflare/云后根本没有本地 claude → 上不了线。**本地跑通对产品零意义（部署后没人能用）**；只是早期脚手架，**永不用于验证产品**。详见 memory「永远只用 rebyte」。
- **领域状态机** `src/frames.ts`：解析 stream-json / relay 事件里的 travelkit `tool_result`，派生 `stage`(search/verify/order/payment) + 各阶段数据 + `notice`。**UI 是工具结果的镜像**，agent 不额外写文件。
- **bench 卡片**（`src/components/`）：`SearchResultsTable`、`FareDetailCard`（验价卡）、`PassengerForm`、`ConfirmGate`（二次确认闸）已有；订单卡 / 支付面板 / 售后待做。`Bench.tsx` 按 stage 切视图，`Composer.tsx` 把 UI 手势拼成下一句 prompt 回传 agent。
- **内部 ID（solutionId / orderKey / PNR / 票号）全留 agent 侧**，永不进 UI / URL / chip。

## 存储：可换的 Store（本地 sqlite，上云换驱动）

存储已抽象成**异步接口 `Store`**（`server/store.ts`）；`server/db.ts` 按 `TRIPDESK_DB` 选驱动，**call site 不知道背后是哪个库**——这就是"想切就能切"。三表 `tasks/prompts/frames` 不变，前端与 `src/frames.ts` 零改动。接口异步是关键：D1/pg/mysql 天生异步，同步接口换不过去。

- **`sqlite`（默认，本地零配置）**：`server/store-sqlite.ts`，better-sqlite3 写 `~/.tripdesk/tripdesk.db`。SQL 是纯 SQLite + `?` 占位符，**Cloudflare D1 原样能跑**。⚠️ 原生模块 + 本地文件 + 常驻进程 → **跑不了 Workers**，是本地/容器驱动。
- **切驱动**：`TRIPDESK_DB=d1|pg|mysql`（+ `DATABASE_URL`）。各加一个**同接口**的 `server/store-<driver>.ts`、在 `db.ts` 的对应 case 实例化即可——D1 与 sqlite 同 SQL、近乎机械；pg/mysql 换方言（datetime/占位符）。**这些驱动文件留到部署阶段补**（现在选 d1/pg/mysql 会抛"待实现"明确报错）。
- **部署取向（影响多大）**：Cloudflare = **Workers 全栈** 还是 **CF 前端 + 容器(Cloud Run/ECS)跑 server**？前者除换 D1 外，task-runner 的"长驻进程 + 长连 SSE + 内存态"还要改成 Durable Objects / 队列；后者现 runner 不动，只换存储驱动即可。**先定这个再动部署。**

## rebyte 集成（后端工作时）

- SDK `POST /v1/tasks` 统一走 **agent-loop**：manager 先跑，需编码时**委派**沙箱子 agent（`coding_agent__run_claude_code_in_sandbox` / `run_codex_in_sandbox`）；**travelkit `flight_search` 在子 agent 里**，父任务事件流只见委派 + 最终文本。
- 取结果：`/events`（SSE，`Accept: text/event-stream`）或轮询 `/content?include=events`。事件信封 `{seq,eventType,payload}`，eventType ∈ thinking/tool_use/tool_result/text/result，末 `done{status,lastSeq,finalResult}`。
- 测试：`pnpm test:rebyte`（L0 存活 + L1 鉴权 + L2 manager 往返，秒级）、`pnpm test:rebyte:full`（+L3 全链路 travelkit，会开 VM/烧额度）。诊断脚本都在 `server/rebyte/`。
- **进度**：`server/rebyte/task-runner.ts` 已写——消费 `/events`，把 relay 事件 `{eventType,payload}` **翻译成 claude stream-json frame**（tool_use/text/tool_result）灌进 `frames` 表；后端选择器在 `server/backend.ts`（routes 从它 import）；`tasks` 表加了 `relay_task_id`。前端零改动。webhook 暂不做（走 SSE/轮询）。
- **待解**：① 父流看不到**嵌套 `flight_search`**（见本节首条）→ 委派轮的搜索/验价卡不会亮；翻译器已就绪，父级一旦透出就直接渲染，解法待定（直调路 / 让 relay 不过滤子事件 / skill 落盘再读——落盘与「agent 不额外写文件」红线冲突，需定夺）。② 多轮上下文续接（rebyte 每轮新 task）未确认，单轮已通。③ 存储可移植（见「## 存储」）。

## 约定（skill 红线）

- 先搜索 → 实时验价 → 验价过了才收乘客证件；**写操作（下单/支付/取消/退/改）每次都要用户明确确认**（`ConfirmGate`）。
- 接口没返回的数据（行李额、退改规则等）如实说"未返回"，不要编。
- 默认**简体中文**回复。
- 支付：`TRIPDESK_PAYMENT_MODE=sandbox` 禁真实支付。

## 远程访问（Tailscale Serve）

- `https://finn-mini-v2.tigris-bigeye.ts.net:8443/`（仅本 tailnet）= Hono(4001) + 生产构建；改前端后要重 `pnpm build` 远程才更新。
- ⚠️ **别动 `:443`**（那是 tmux-mobile 手机网关，属生产）；TripDesk 只用 `:8443`。
