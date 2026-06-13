# Spec：streaming 体验契约（kit 皇冠层）—— 可测不变量 + 硬化 todo

| | |
|---|---|
| **状态** | TODO（契约 + 硬化；改 **travelkit/kit**，标注 cctools 依赖） |
| **创建** | 2026-06-12 |
| **相关** | 锚 [template-layering](template-layering.md)；平台侧 [rebyte-protocol-asks](rebyte-protocol-asks.md)；kit `references/streaming-contract.md`、`references/known-constraints.md` |

> **为什么**：streaming 体验是 kit 最该攥死、最不该让任何垂直团队重写的"皇冠"——它的可靠性（刷新不丢、可续、消息不漏）来自一组**不变量**，不来自任何库。把这些写成**可测契约 + 现状索引**，未来直接从本篇开工：照"现状速查"跳到代码，照"验收"写测试，照"硬化 TODO"收口。

## 核心心智（一句话）
**流的源头是数据库，不是连接。** 前端无状态、是 `Store` 的一个视图；SSE 不是"连 agent"，是 **tail D1**；agent 在后端独立跑、状态全落库，所以"跑一半刷新"天然不丢。

## 现状速查（每条契约/race → 现在住在哪 → 平台还债后退不退）
| 项 | 代码位置（travelkit） | 还债后 |
|---|---|---|
| I0 frames 为源 | 3 表 schema + `server/store.ts` 接口 / `server/store-d1.ts` | 永存 |
| I1 live = tail | `server/routes.ts:128-160`（`framesSince` 轮询） | 永存 |
| I2 refresh = 重建 | `server/routes.ts:107-126` + `worker/task-do.ts:recoverPrompt:327` | 永存 |
| I3 可续 | `server/routes.ts:135`（`fromSeq`/`Last-Event-ID`）+ `src/api.ts:110-124`（EventSource `lastEventId` 自动重连） | 永存 |
| I4 后端独立跑 | `worker/task-do.ts`（DO `alarm()`/20s 窗口） | 永存（执行腿可换，见锚篇结论②） |
| R1 空-done | `worker/task-do.ts:streamWindow:523-528`（`rawCount===0` 守卫 + 800ms backoff） | [asks#2](rebyte-protocol-asks.md) 退 |
| R2 terminal-drain | `worker/turn-finalize.ts:shouldDrainTerminal:58`（纯）+ 调用点 `task-do.ts:456` | [asks#2](rebyte-protocol-asks.md) 退 |
| R3 result self-heal | `server/frame-text.ts:unrenderedResultTexts:49`（纯）+ `routes.ts:120` + `task-do.ts:recoverPrompt:327` | [asks#2](rebyte-protocol-asks.md) 部分退 |
| R4 subPromptId 回流 | `worker/task-do.ts:replaySubPrompt:204` | [asks#1](rebyte-protocol-asks.md) 退 |

> ⚠️ I0–I4 是**平台无关契约**；CF 只提供 I4"执行腿"的一种实现。搬云这 5 条一行不改，只重写执行腿 + Store driver + SSE 承载。

## 不变量 I0–I4（每条带验收 + 测试草图）

**I0 — frames 是唯一真相源。** frame 按 `(promptId, seq)` 落 `Store`；所有读路径（live + refresh）都从 store 出，不直连 relay。
- ✅ 测（纯函数，不烧额度）：构造一组 frames → 分别"逐条顺序喂"(模拟 live) 与 "批量喂"(模拟 `loadContent`) 进 `src/frames.ts:derive()` → 断言两个 `DerivedView` 全等。

**I1 — live = tail store by seq（不连 agent）。** `/prompts/:id/stream` 循环 `store.framesSince(promptId, lastSeq)` 推增量，status≠running 即 `done`。
- ✅ 测：fake `Store` 返回递增 frames + fake `stream.write` → 断言按 seq 顺序写出、**不触达 rebyte**。（前置硬化：把 `routes.ts:136-159` 的 tail 循环抽成可测函数 `tailFrames(store, promptId, fromSeq, write, isAlive)`。）

**I2 — refresh = 从 store 重建（+ self-heal）。** `/tasks/:id/content` = `listPrompts` + `framesSince`；终态但答案缺失/未渲染的，`recoverPrompt` 回填再重读。
- ✅ 测：跑完一轮（或灌好 D1）→ `/content` → `derive()` 与 live 收尾一致；再人为只留 `__relay:"result"` frame、删 assistant text → 断言 `/content` 经 `unrenderedResultTexts` 回填出答案（见 R3）。

**I3 — 可续。** 带 `Last-Event-ID`/`fromSeq` → 只发 `seq>cursor`，不重不漏。
- ✅ 测：`framesSince(promptId, N)` 仅返回 `seq>N`（Store 行为，直接断言）；`api.ts:124` 注释即 EventSource 自带 Last-Event-ID 重连。

**I4 — turn 后端独立跑。** 执行腿按窗口推进、每条 frame 落库；关页面照跑。
- ✅ 测（集成，烧额度）：`runTurn` 起 → 不连 SSE → 轮询 D1 断言 frames 持续增长 → 重开流追上。

## load-bearing races R1–R4（别 simplify；现状 + 验收 + 何时退）
> 多来自 relay 行为；对应平台修复见 [rebyte-protocol-asks](rebyte-protocol-asks.md)。**平台改好、回归绿之前不许删。**

**R1 空-done 竞态** — 连太早 → 无前置事件的 `done`（`lastSeq:-1`）= 重放竞态非终止。守：`task-do.ts:523-528`，`rawCount===0` 时 return `{terminal:false}` + 800ms backoff。
- ✅ 测：模拟 SSE 先发 `done` 且零事件 → 断言**不**判终止。 · 退于 [asks#2](rebyte-protocol-asks.md)（干净终止符）。

**R2 terminal-drain** — 委派 turn 状态翻 terminal **早于**尾部 text+`done`；裸 finalize 吞答案。守：纯函数 `turn-finalize.ts:shouldDrainTerminal:58`（`!haveAnswer && drains<4 && now<deadline`），调用点 `task-do.ts:456`。
- ✅ 测：纯函数直接覆盖真值表；+ 一个"status 先 terminal、finalResult 后到"集成断言尾部不丢。 · 退于 [asks#2](rebyte-protocol-asks.md)（terminal 时 finalResult 已就绪）。

**R3 result-channel self-heal** — 最终答案有时只落 `result` 通道 / 完全没落；刷新只读 store 故需回填。守：纯函数 `frame-text.ts:unrenderedResultTexts:49`（含 `resultFrameText` 认 `__relay:"result"`）；`routes.ts:120` 判 needsHeal → `task-do.ts:recoverPrompt:327` case1 `backfillText`。
- ✅ 测：纯函数——`__relay:"result"` 有文本但无 assistant text → 返回该文本；已渲染 → 返回 `[]`。 · 部分退于 [asks#2](rebyte-protocol-asks.md)。

**R4 subPromptId 回流** — 子会话结构化 `flight_*` `tool_result` 不在父流 → `replaySubPrompt:204` 拉回 replay 进 frames（每个 subPromptId 一次，`fetchedSubPrompts` 去重）。
- ✅ 测：真链路 `server/rebyte/subprobe.ts`（已存在）三步全绿 → 断言 `derive().search` 非空、含 `displayOptions`。 · 退于 [asks#1](rebyte-protocol-asks.md)（结构化结果回父任务）。

## 硬化 TODO

### 1) 收敛重复的 `translate()` + 流式循环 → `turn-driver.ts`（最高优先）
现存 **3 处** + 待建 1 处：
- `worker/task-do.ts:153`（方法版，副作用 emit 进 D1，含 R4 触发）
- `server/rebyte/cardprobe.ts:30`、`server/rebyte/subprobe.ts:34`（`():void` 副作用版，push 进 module `frames[]`；subprobe 注释自称 "Faithful mirror of task-do.ts translate()"）
- 待建 `server/rebyte/eval.ts`（[skill-eval-gate](skill-eval-gate.md) 的 TODO 要"纯函数版 translate"——直接用本项产物，别再抄第 4 份）
- （`multiturn.ts` 只收文本不建 frames，不在此列）

做法：
- [ ] 抽 **纯函数** `translate(ev): Frame[]`（返回值版，无副作用、无 I/O）——把"产 frames"与"replaySubPrompt 的子会话 fetch（I/O）"分离：纯 translate 产 frames 并**标出 `subPromptId`**，由驱动层决定要不要 replay。
- [ ] 抽**共享流式驱动** `driveTurn(...)`：连/续传/seq 去重/R1 空-done 守卫**只此一份**；DO 注入 "emit→D1" sink，探针注入 "push→array" sink。
- [ ] DO 与 cardprobe/subprobe/(eval) 全切到它 → 漂移归零。drain 常量仍 `import from worker/turn-finalize.ts`（跨 worker/ import 已是既有模式，见 `server/rebyte/seed.ts`），别再硬编。

### 2) 把 `replaySubPrompt` + R4 write-back 进 kit
kit 现把"子结构化结果到不了父任务"只记成 `references/known-constraints.md` 的**已知限制**；travelkit 已在 `task-do.ts:204` 解决。
- [ ] 把 `replaySubPrompt` 逻辑 + R4 验收搬进 `rebyte-app-kit` backbone（通用感悟回流，符合模板"upstream 真源"约定）。

### 3) 锁死契约文档（kit 侧）
- [ ] kit `references/streaming-contract.md` 现只列了 3 个 gotcha → 升级成 I0–I4 + R1–R4 的 "do-not-simplify" 清单，与本篇双向链接；`known-constraints.md` 在 R4 处指回 [asks#1](rebyte-protocol-asks.md)。

### 4) 验证
- [ ] travelkit `pnpm typecheck` 绿。
- [ ] **纯函数层（不烧额度，先做）**：I0 一致性、R2 `shouldDrainTerminal`、R3 `unrenderedResultTexts` 各一组单测。
- [ ] **真链路层（烧额度，与现 multiturn 同量级）**：R4 走 `subprobe.ts`；I2/I4 走 `multiturn.ts`/未来 `eval.ts` 各打一勾。

## 明确不做（本次）
- 不引入 AI SDK / `useChat`（见 [template-layering](template-layering.md) 结论①）。
- 不删任何 R1–R4 的 workaround——等 [rebyte-protocol-asks](rebyte-protocol-asks.md) 对应项上线、回归绿。
- 不现在抽 `TurnRunner` 接口（YAGNI，同锚篇）。

## 备注
- **I 段永存、R 段临时**：I0–I4 是"为什么刷新不丢"的完整答案；R1–R4 是"为什么现在还需要那堆体操"的临时账——平台还债后 R 段会瘦。
- 这层是 kit 的 IP：哪怕 Rebyte 把 [edge-sdk](rebyte-edge-sdk.md) 做到完美，"frames 为源 + 可续 + 不漏"仍是 kit 的活，不是 SDK 的。
- 硬化 #1 的 `turn-driver.ts` 与 [skill-eval-gate](skill-eval-gate.md) 的 eval harness 是**同一块抽取**——先做本项，eval 直接复用，别两头抄。
