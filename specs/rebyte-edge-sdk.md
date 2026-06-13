# Spec：Rebyte edge-native SDK —— 两个 client（relay 控制面 / sandbox 基质面）

| | |
|---|---|
| **状态** | TODO（需求/设计；主体改 **cctools**，travelkit 侧只做"接入点"准备） |
| **创建** | 2026-06-12 |
| **相关** | 锚 [template-layering](template-layering.md)；现有手搓实现 `travelkit/server/rebyte/{client,sse}.ts` + `travelkit/worker/seed.ts`；平台行为侧 [rebyte-protocol-asks](rebyte-protocol-asks.md) |

> **为什么**：现在 travelkit **两个 client 都手搓**——① relay 没有 typed client，② `rebyte-sandbox` SDK 跑不进 workerd（node 运行时 / gRPC 依赖），所以裸 fetch。要让 `rebyte-app-kit` 各行业快速复制，这俩该收成**官方 edge-native SDK**。反直觉好处：正因被逼裸搓，我们的实现已经是 Web-标准的，**可直接 upstream 成参考实现**。

## 已锁定决策
- **拆成两个包**，别叫一个含糊的"rebyte SDK"：`@rebyte/relay`（控制面）+ `@rebyte/sandbox`（基质面）。
- **edge-native 是硬门槛**（见 checklist）；命根子两条：**注入 fetch** + **可续迭代器**。
- **typed 判别联合事件**，取代 `{eventType:string, payload:any}`。
- SDK 只管"怎么跟 Rebyte 说话"；**不含 streaming 体验**（那是 kit，见 [streaming-experience-contract](streaming-experience-contract.md)）。

## 接口（草图——travelkit 现有实现就是底稿）

`@rebyte/relay`（控制面）
```ts
const relay = createRelayClient({ apiKey, baseUrl, fetch })   // 注入 fetch
const task  = await relay.createTask({ prompt, workspaceId }) // {id}
await relay.addPrompt(task.id, { prompt })                    // 续轮
await relay.getTask(task.id)                                  // {status, finalResult?}
for await (const ev of relay.streamEvents(task.id, { afterSeq }))  // 可续/去重/无竞态/typed
await relay.getContent(task.id)                               // 刷新重建(typed)
await relay.getPromptEvents(task.id, subPromptId)             // 子会话(理想是不用它,见 asks#1)
```

`@rebyte/sandbox`（基质面，= 把 `worker/seed.ts` 裸搓的那套官方化）
```ts
const sb = createSandboxClient({ apiKey, baseUrl, fetch })
const vm = await sb.provision({ label })            // {id, baseUrl, apiKey}
await sb.putFiles(vm, [{ path, content }])          // envd over fetch, 不是 node-gRPC
await sb.removeFiles(vm, [path])                     // 真删(现 envd 无 DELETE = 痛, 见 asks#4)
await sb.setEnv(vm, { KEY: val })                   // 真注进 agent shell(现不生效→seed .env 兜底, 见 asks#3)
```

## 现有底稿 → SDK 方法映射（upstream 时照搬，别重写）

`@rebyte/relay` ← `travelkit/server/rebyte/{client,sse}.ts`
| SDK 方法 | 现有底稿 | 包的 relay 端点 |
|---|---|---|
| `createRelayClient({apiKey,fetch})` | `rebyteJSON`/`rebyteFetch` + `RebyteConfig`（`API_KEY` 头，非 Bearer） | — |
| `createTask` | `rebyteJSON('/tasks', POST)` | `POST /v1/tasks {prompt, workspaceId}`（relay void 掉 model/executor） |
| `addPrompt` | `rebyteJSON('/tasks/:id/prompts', POST)` | `POST /v1/tasks/:id/prompts {prompt}` |
| `getTask` | `rebyteJSON('/tasks/:id')` | `GET /v1/tasks/:id` → status/finalResult |
| `streamEvents` | `rebyteFetch('/tasks/:id/events', SSE)` + `parseSSE` | `GET /v1/tasks/:id/events`（Accept: text/event-stream） |
| `getContent` | `rebyteJSON('/tasks/:id/content?include=events')` | `GET /v1/tasks/:id/content` |
| `getPromptEvents` | `task-do.ts:replaySubPrompt` 里的 `/tasks/:id/prompts/:sid/events` | `GET /v1/tasks/:id/prompts/:promptId/events`（子会话，见 [asks#1](rebyte-protocol-asks.md)） |

`@rebyte/sandbox` ← `travelkit/worker/seed.ts`
| SDK 方法 | 现有底稿 | 备注 |
|---|---|---|
| `provision` | `provisionComputer()` | — |
| `putFiles` | `seedSandbox` / `pushSeedFiles` | envd gRPC-Web |
| `removeFiles` | `removeStaleArtifacts` | envd Remove，现是脆路（见 [asks#4](rebyte-protocol-asks.md)） |
| `setEnv` | `applyCredential` | 现走 seed `/code/.simplifly.env` dotenv，**非真注入**（见 [asks#3](rebyte-protocol-asks.md)） |
| 版本 | `SEED_VERSION` | 种子树变 → 就地 re-seed |

> `parseSSE` 的空-done 守卫 + seq 去重应内化进 `streamEvents`（详见 [streaming-experience-contract](streaming-experience-contract.md) R1）。

## edge-native checklist（递给 cctools 的硬要求 = 对 Web 标准写，别对 Node 写）
- [ ] ❌ 任何 `node:*`（`crypto`/`stream`/`buffer`/`net`/`http`）→ ✅ WebCrypto / Web Streams / fetch / `Uint8Array`+`TextEncoder`
- [ ] ❌ 原生 gRPC / 长连 TCP → ✅ **gRPC-Web over fetch** 或 HTTP+JSON（workerd 只有 fetch/WebSocket）
- [ ] ❌ 假设全局 node-fetch/undici → ✅ **注入 `fetch`**（构造时传入）
- [ ] ❌ 动态 `require` / CJS 副作用 → ✅ ESM-only、tree-shakeable、无 import 副作用
- [ ] ⚠️ **可续是硬要求不是锦上添花**：workerd 有 CPU/连接时长上限，`streamEvents({afterSeq})` 必须支持"连 20s → 断 → 从 afterSeq 续"（= 现在 DO+alarm 窗口的形状）。不支持续传 = 在 CF 上根本没法用。
- [ ] 一套构建跑通 workerd / Node22 / Bun / Deno。

## typed 事件（判别联合，取代 `payload:any`）
```ts
type RelayEvent =
  | { seq; type:'text'; text; channel:'assistant'|'result' }   // channel 标好→省 kit 手动 dedupe
  | { seq; type:'thinking'; text }
  | { seq; type:'tool_use'; id; name; input }
  | { seq; type:'tool_result'; id; output; subPromptId? }      // 子会话句柄显式
  | { seq; type:'delegate'; subPromptId; subTaskId; tool }     // 委派显式化
type Terminal = { type:'done'; status; finalResult?; lastSeq }
```
`streamEvents` 内部消化**空-done 竞态**（刚连上即 done 且零事件 = 没终止，自动重连）——kit 不该看见（详见 [streaming-experience-contract](streaming-experience-contract.md) 的 race 三条）。

## TODO
### cctools（主体）
- [ ] 立 `@rebyte/relay` + `@rebyte/sandbox` 两个包，按上方接口 + checklist；事件用 typed 联合
- [ ] `streamEvents` 内建：afterSeq 续传 + seq 去重 + 空-done 自愈 + done 干净终止
- [ ] 可直接拿 travelkit 现有实现当底稿（`client.ts`/`sse.ts`/`seed.ts`）upstream
### travelkit / kit（接入点准备，不等 SDK 也能先做）
- [ ] 确认 relay/sandbox 调用都已收在**一个薄模块**后（`server/rebyte/*`、`worker/seed.ts`），未来 SDK 到位即"换 import"——现状基本满足，补齐遗漏的直连点即可
- [ ] 记一条迁移注记：SDK ready 后 `server/rebyte/client.ts` → `import { createRelayClient }`

## 明确不做（本次）
- 不在 travelkit 里造一个"伪 SDK 包"自嗨——SDK 的家是 cctools；travelkit 这边只保持"接入点干净"。
- 不动 streaming 体验逻辑（那是另一篇）。

## 备注
- **战略**：两个 client 我们都写好了 → 把 `server/rebyte/*` + `worker/seed.ts` upstream，**我们就是 Rebyte edge SDK 的事实作者**（FDE 极强位置：既用平台、又定义平台客户端长相）。
- SDK 能修的有限：`setEnv` 真生效、`removeFiles` 真删、子结构化结果回流，这些是 **relay/sandbox 行为**，得配 [rebyte-protocol-asks](rebyte-protocol-asks.md) 一起。
