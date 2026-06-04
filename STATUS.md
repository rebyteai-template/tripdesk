# TravelKit 仓库 — 当前状态

> 给切过来的 Claude / 给我自己看的交接说明。最后更新见 git log。

## 这个仓库是什么

AI 机票 agent 实验仓库。已经安装了 **TravelKit skill**（来自
<https://github.com/TravelKit-AI/travelkit-skill>），用来让 agent 走完整的
在线机票流程：搜索 → 验价 → 下单 → 支付 → 售后（退/改/发票/行程单）。

skill 本身只是 prompt/policy，真正的机票数据要靠 TravelKit 的 **MCP server**。

## TripDesk 产品（仿 adits 的订票工作台）

方案见 `DESIGN.md`。**M1 脚手架已搭好并端到端验证通过**。

### 怎么跑
```bash
pnpm install            # better-sqlite3 是原生模块，已在 package.json 里 onlyBuiltDependencies 允许编译
pnpm dev:all            # vite(4000) + server(4001) 一起起
# 打开 http://127.0.0.1:4000
```
- 前端 React+Vite(4000)，后端 Hono+SQLite(4001)，`/api/app/*` 走代理。
- 后端每轮 `spawn claude -p --output-format stream-json`，cwd = `~/.tripdesk/projects/default`（自动 seed 了 `.mcp.json` + travelkit skill）。**prompt 走 stdin**（`--disallowedTools` 是变参，会吞掉位置参数的 prompt）。
- 沙箱模式：`--disallowedTools mcp__travelkit__flight_pay_order` 禁掉真实支付（`TRIPDESK_PAYMENT_MODE=sandbox`）。
- 左聊天右 bench：bench 解析 frames 里 `mcp__travelkit__flight_search` 的 tool_result 渲染结果表；点「预订」把「预订选项N」拼成 followup prompt 回传 agent，内部 ID 全留 agent 侧。

### 已验证
搜索 → 真实调用 travelkit `flight_search` → 解析出 3 个航班选项 → 结果表 + 聊天表格都正确。

### 远程访问（Tailscale Serve）
- **URL：https://finn-mini-v2.tigris-bigeye.ts.net:8443/**（仅本 tailnet 可达）
- 映射：`tailscale serve --bg --https=8443 http://127.0.0.1:4001`，即走 **Hono 服务器(4001) + 生产构建**（一个端口同时出 SPA 和 `/api/app`，避开 Vite 的 allowedHosts / HMR-over-HTTPS 麻烦）。
- ⚠️ **不要动 `:443`**：那是 tmux-mobile（→127.0.0.1:3737），是这台机器的手机网关，属生产。TripDesk 只用 `:8443`。
- ⚠️ 远程看的是 **`vite build` 静态产物**：改前端代码后必须重新 `pnpm vite build` 远程才更新；后端 `dev:server` 有 `--watch` 会自动重载。
- 关闭：`tailscale serve --https=8443 off`。
- 起服务：后端 `node --env-file=.env.local --import tsx server/index.ts`（serve build/ 需先 `vite build`）。验证外部 URL：`curl -sS -o /dev/null -w "%{http_code}\n" https://finn-mini-v2.tigris-bigeye.ts.net:8443/` 期望 200。

### M2 进行中（见 DESIGN.md 路线图）

**已完成 ✅**
- `frames.ts` 重构成**领域状态机**：派生 `stage`(idle/search/verify/order/payment) + 各阶段数据 + `notice`(写操作失败提示)。「最新成功的领域工具」决定当前阶段（重搜会回落到结果表）。
- **验价卡 `FareDetailCard`**：解析 `flight_verify_solution` → 价格拆分（总价=票面+税，含原价/折扣删除线）、行李额（carryOn/checked 中文描述）、退改规则（refund/changeDescription 现成中文）、canVoid、低余票提醒（availability≤3）、多乘客分行。CTA「继续预订」chip。
  - **怎么验的**：直接实调 travelkit `flight_search`+`flight_verify_solution`（只读）拿到真实 JSON；用真实数据喂 `derive()`，成功路径 15 项断言全过、失败路径（价格失效→notice 横幅+保留结果表）也过；`tsc --noEmit` 0 错、`vite build` 通过。
  - 关键发现：验价才返回行李/退改/余票（搜索阶段是 "baggage not returned"）；航段航班号/机场要从隐藏字段 `coreSegmentId`（`日期-DEP-ARR-航班号`）里解析，原始 id 不展示；`requiredPassengerInfos` 直接给出要收的乘客字段。

**待办 ⏳**
- 乘客表单、订单卡、支付面板、二次确认闸、幂等（任务清单见 TaskList）。
- ⚠️ **订单/支付卡片卡在结构未知**：`flight_order_list` 实查为空（无历史订单），`flight_create_order`/`flight_pay_order` 是写操作不便空跑。需要一次**人工带 test 乘客的真实端到端**（沙箱禁支付，只产生未付订单）从 DB 抓真实 frame 再精修这两张卡。
- 其它遗留：聊天气泡纯文本（markdown 表格未渲染）；单一 default 项目，无多会话/项目列表。

### M3（见 DESIGN.md 路线图）
- 退/改/发票/行程单。

---

## ⚠️ 方向调整（2026-06-04）：rebyte 优先

**决定**：本地 spawn claude 只是脚手架；正式要让 agent 跑在 **rebyte**（adits 生产那套 sandbox VM）。先连上 rebyte，再在其上迭代订单/支付等卡片。M2 已做的卡片是纯前端、解析 stream-json frames，**与后端无关，rebyte 上原样复用**。

**关键认知（读过 adits 源码 `/Users/wangfulong/src/cc/adits` 确认）**：
- rebyte 是 **relay 模型**，不是"自己在 VM 里 spawn claude"。后端把 `POST /v1/tasks`、`/v1/tasks/:id/events`(SSE) 打到 relay（`REBYTE_API_URL`，默认 `https://api.rebyte.ai/v1`，`API_KEY` 头），relay 在 sandbox VM 跑 agent、回流 stream-json 事件。
- VM 开通：`POST /agent-computers` 轮询 `sandboxId`（见 adits `rebyte/file-store.ts` createProject）。
- 文件 seed：用 `rebyte-sandbox` SDK 把 `.mcp.json`(travelkit) + `.claude/skills/travelkit` 写进 VM 的 `/code`（本地是落盘，rebyte 写进 VM）。
- 单用户精简：**不需要** adits 的 Clerk/Postgres/webhook/per-user 开通——保留 SQLite，org key 直连，靠 `/events` SSE 拿终态即可。

**已搭（编译通过，默认仍 local 不破坏现有）**：
- `server/env.ts`：加 `TRIPDESK_BACKEND`(local|rebyte) + `REBYTE_API_URL`/`REBYTE_API_KEY`/`REBYTE_CONSOLE_URL`。
- `server/rebyte/client.ts`：relay REST 客户端（`API_KEY` 头）。
- `server/rebyte/provision.ts`：`ensureDefaultAgentComputer()` 开 VM + 配置落 `DATA_DIR/rebyte-project.json`。
- 依赖：`rebyte-sandbox` 锁到 adits 同款 git ref（`github:ReByteAI/sandbox-sdk#84b6849`，0.3.1）。

**key**：现用**用户自己的 org key**（`rbk_…`，在 `travelkit/.env.local`，gitignore，**勿写进任何提交文件**）+ `.env.local` 里 `TRIPDESK_BACKEND=rebyte`。relay = `api.rebyte.ai/v1`。早期 spike 的 PASS 是临时借 adits 的 partner key 跑的（仅诊断对比，adits key 仍在 `adits/server/.env.local`）。换 org 时已清掉旧 VM 缓存 `DATA_DIR/rebyte-project.json`（会重新开 VM）。

### ✅ SPIKE 跑通（2026-06-04，task #9 PASS）

端到端验证：provision VM → seed 18 文件进 /code → relay `POST /tasks` → 流 `/events` → **agent 在 /code 里加载 travelkit skill + 调到 `mcp__travelkit__flight_search`，返回 displayOptions（结构与本地解析一致）→ text 回复 → done**。脚本：`server/rebyte/{spike,peek,raw,eprobe}.ts`（诊断用，可留作回归）。跑：`node --env-file=.env.local --import tsx server/rebyte/spike.ts`。

**两个关键坑（务必记住）**：
1. `POST /tasks` **必须带 `executor`（+`model`）**，否则 relay 直接 no-op（submittedAt==completedAt、0 事件、`executor:null`）。取值见 adits `packages/shared/executors.ts`：executor `claude|gemini|codex`；claude 的 model `claude-sonnet-4.6`/`claude-opus-4.7`/`deepseek-v4-pro`。
2. `/events` 要 **`Accept: text/event-stream`** 头；且连太早会立刻空 `done`(`lastSeq:-1`)——**空 done 要短延迟重连**，relay 对活跃 task 会从 seq 0 回放。事件**不持久化**到 `/content`（完成后 events=[]），所以必须实时消费 `/events` 并自己落库。

**relay 事件契约**（信封 `{seq,timestamp,promptId,eventType,payload}`）：
| eventType | payload | 映射到本地 stream-json |
|---|---|---|
| `init` | {session_id,model,cwd:/code} | 跳过 |
| `thinking` | {content,thinking} | 跳过（或 muted） |
| `tool_use` | {id/tool_id, name/tool_name, input/params} | `{type:assistant,message:{content:[{type:tool_use,id,name,input}]}}` |
| `tool_result` | {id/tool_id, output(JSON字符串)} | `{type:user,message:{content:[{type:tool_result,tool_use_id:id,content:[{type:text,text:output}]}]}}` |
| `text` | {content} 最终回复 | `{type:assistant,message:{content:[{type:text,text}]}}` |
| `result` | {status,result,duration_ms,usage}/{provider,status} | 跳过 |
| SSE `event:done` | {status,lastSeq,finalResult} | finishPrompt(status) |

**下一步（task #10）**：写 `server/rebyte/task-runner.ts`——`POST /tasks`(带 executor) + 重连消费 `/events` + 按上表转换灌进现有 `frames` 表；加后端选择器让 routes 按 `TRIPDESK_BACKEND` 选 local/rebyte。这样 routes SSE + 前端卡片**零改动**复用。`tasks` 表加 `relay_task_id` 映射。

### 🔧 当前状态（2026-06-04 末）—— 重启从这里看

**一句话**：连通 rebyte 的所有机制都通了（开 VM、seed、建 task、事件流），唯独**用 org key 通过公开 API 把 agent 回复取回来这一步断了**——"能发过去，消息回不来"。**用户已确认这是他最近改 agent-loop 引入的 rebyte 侧回归，正在 Rayline session 修 rebyte。** TripDesk 这边等修好再接 task-runner。

**正确根因（前面几版"没额度/org 没 provision"的结论是错的，已废弃）**：
- rebyte 本身正常：控制台 UI 上 agent 正常回复（如 "我是 Rebyte 托管的云端智能助手…"）。**额度没问题**：org 是 Team plan + 4704 credits（用户截图确认）。
- 问题是**公开 org-key API 取不回回复**：
  - manager 直接回答型任务（"介绍自己"，task `117d5c89`）：UI 有回复，但 `/content` `response:null`+`events:[]`、`/events` 立即 done 0 事件、`/messages|/result|/output` 404（`getresp.ts` 全打过）。
  - A/B：换 adits partner key 跑同句（`4eeda8b4`）**也 0 事件** → 不是某 key/某 org 的设置差别，是 agent-loop 路径本身。
  - VM 探针（`vmprobe.ts`）证明沙箱侧没问题：seed 完好、`claude` v2.1.158 在、`claude mcp list` 能看到 travelkit（**磁盘 .mcp.json auto-load 生效**）。（"Not logged in" 只是我手动 shell 没注入 creds 的红鲱鱼，relay 运行时才注入。）
- 机制结论（subagent 读 cctools/relay 源码）：公开 `/v1/tasks/:id/events` **只装沙箱 coding agent 的事件**；**manager 自己的回复不进任何 org-key 公开端点**（只走 UI 的 Clerk 通道）。委派沙箱的任务事件能出来，但有 org 的订票任务里沙箱子 agent 收到 0 input token → 空 → 父 prompt failed。涉及文件 file:line 全列在 `REBYTE-API-HANDOFF.md`。

**已交接给用户修 rebyte**：完整前因后果 prompt 在 **`REBYTE-API-HANDOFF.md`**（对话里也贴了）；org key 在对话里单独贴给 Rayline（**未入库**，repo 里只在 gitignore 的 `.env.local`）。目标：让公开 API 能返回 agent 回复（`/events` 上发 `text`/`result`，或回填 `/content` 的 `prompts[].response`）+ 委派沙箱时透传 `mcpServers`/子 agent 收到 prompt。

**rebyte 修好后怎么续**：
1. 验回路：`node --env-file=.env.local --import tsx server/rebyte/hello.ts "请用一句话介绍你自己"`；或 `getresp.ts <taskId>` 看回复落在哪个字段/事件。
2. 据"回复落在哪"写 `server/rebyte/task-runner.ts`：`POST /v1/tasks` + 重连消费 `/events`（Accept 头）+ 按上面**事件契约表**转换灌进现有 `frames` 表；`tasks` 表加 `relay_task_id`。
3. 加后端选择器：routes 按 `TRIPDESK_BACKEND` 选 local/rebyte（参考 adits `server/backend/index.ts`）。**前端/卡片零改动**复用。
4. 订票任务要确保**委派到沙箱 coding agent**（travelkit 在沙箱 /code），事件才从公开 API 出来。
5. 回 M2：在 rebyte 上真实跑 验价→下单→支付，抓 `flight_create_order`/`flight_pay_order` 真实 frame，精修订单卡(#5)/支付面板(#6)。

**诊断脚本（都在 `server/rebyte/`，留作回归）**：`hello.ts`(最简往返)、`getresp.ts`(探响应落点)、`spike.ts`(全链路)、`peek.ts`/`raw.ts`(看 task content)、`eprobe.ts`(原始 /events)、`vmprobe.ts`(连进 VM 跑 shell)。

> 备选（若 rebyte 短期修不了、又想先跑通）：bring-your-own-key bypass——`GET /v1/sandbox/api-key` 直连 VM、自跑 `claude -p --mcp-config /code/.mcp.json --output-format stream-json`，拿和本地一样的 stream-json，绕开 manager。需要一把模型 key（Anthropic 或 org LiteLLM）。用户当前倾向先修 rebyte，不走这条。

---

## 已完成 ✅（skill 安装阶段）

- `git init` + 首次提交
- 安装 skill 到 `.claude/skills/travelkit/`（`SKILL.md` + 15 个 references）
- `README.md`、`.gitignore`（已忽略 `.env`、`*.key`，防止 API key 进 git）
- 开了 tmux session `travelkit`，在本目录启动了 `claude`

## 待办 ⏳（需要 API key 才能继续）

1. 用户提供 `TRAVELKIT_API_KEY`
2. 写进 `.env`（不进 git，不打印到任何输出）
3. 配置 MCP server，二选一：
   - **项目级**（只这个 repo 用）
   - **全局**（所有项目可用）
4. 验证连接 + 跑一次 `flight_search` 试水

## MCP 连接信息（来自 skill README）

- Endpoint: `https://mcp.travelkit.ai/mcp` （Streamable HTTP）
- Auth: `Authorization: Bearer ${TRAVELKIT_API_KEY}`
- Headers: `Content-Type: application/json`，`Accept: application/json, text/event-stream`

## skill 的几条核心红线（用的时候注意）

- 先搜索 → 再实时验价 → 验价过了才收集乘客证件信息
- 写操作（下单/支付/取消/退票/改签）每次都要用户**明确确认**才执行
- 内部字段（`solutionId`、`orderKey`、`PNR`、票号、API key 等）绝不能出现在给用户的回复里
- 接口没返回的数据（行李额、退改规则等）如实说"未返回"，不要编
- 默认简体中文回复
