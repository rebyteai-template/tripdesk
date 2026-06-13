# Spec：递给 Rebyte 的平台/relay 行为改动（6 条，按杠杆排序）

| | |
|---|---|
| **状态** | TODO（需求清单；主体改 **cctools/relay**，每条注明 kit 删掉啥） |
| **创建** | 2026-06-12 |
| **相关** | `REBYTE-ISSUE.md`、`REBYTE-NEEDS.md`（本篇 = 它俩的"平台需求"版）；锚 [template-layering](template-layering.md)；SDK 侧 [rebyte-edge-sdk](rebyte-edge-sdk.md) |

> **为什么**：kit 里每个 hack，都是在替 relay 补窟窿。把它们列成**平台需求**——Rebyte 改一条，kit 删一段，模板就薄一截、复制就快一分。SDK（[edge-sdk](rebyte-edge-sdk.md)）只能修客户端形态；下面这些是 **relay/sandbox 行为**，SDK 一个人修不完。cctools 文件路径以源码为准（探查所得，标注供起点）。

## 排序表

| # | 痛（kit 现在的 hack） | 该谁修 | 改成啥 | 改了 kit 删掉啥 |
|---|---|---|---|---|
| 1 | 子 agent 结构化结果到不了父任务 | **relay** | 见下 | `task-do.ts:replaySubPrompt` + 整个子会话舞蹈 |
| 2 | 空-done 竞态 + terminal-drain 体操 | relay(+SDK) | 真·可续日志 + 干净终止符 | `streamWindow` 一半 race 处理 + `turn-finalize.ts` 多数分支 |
| 3 | `settings.json` 的 env 不进 agent shell | relay/sandbox | `setEnv` 真注入 | seed `/code/.simplifly.env` 兜底 + SKILL.md 那句回落 |
| 4 | envd 无 DELETE，换 skill 得覆写废弃/换 VM | sandbox | 文件真删 / 原子 skill sync | `seed.ts:removeStaleArtifacts` + `SEED_VERSION` churn |
| 5 | manager 硬编码 prompt、无 workspace 指令钩子 | **relay** | workspace 级 system 指令 | `task-do.ts:MANAGER_ROUTE_HINT` 那行路由 |
| 6 | 事件无类型（`eventType:string`/`payload:any`） | SDK | typed 判别联合 | `frames.ts` 松散 `isObj`/`String()` 走查 |

---

## 逐条

### #1 子 agent 结构化结果回父任务（决定性，最高杠杆）
- **现象**：manager 委派沙箱子 agent 调 `flight_search`，把子会话全量事件 `extractFinalResult()` 压成**一段 final text** 才返回（cctools `relay/.../coding_agent/tools/index.ts`）；公开视图又硬过滤 `parent_prompt_id IS NULL`（`AgentLoopPublicView.ts:synthesizeEvents`）→ 父任务只见散文，`solutionId` 丢失，多步流程（验价/下单）断链。
- **三选一修法**（由 Rebyte 定）：(a) 委派边界不压结构化 `tool_result`；(b) 父流透出子 `tool_use`/`tool_result` 并打 `subPromptId` 标；(c) 至少把只读端点 `GET /v1/tasks/:id/prompts/:promptId/events`（已加）做成**稳定 + 线上 GCS 凭证可靠**（`fetchEventsForPrompt` 依赖 `getGcsClient()`）。
- **kit 删**：`replaySubPrompt()` + `fetchedSubPrompts` 全套。

### #2 续传 + 干净终止（杀两类 race）
- **现象**：relay 每次 connect 从 seq 0 重放、末尾才 `done`；连太早回个无前置事件的**空 done**（非终止）；委派turn状态翻 terminal **早于**尾部 text+done 落 `/events`。kit 现靠"本连接收到过事件才算 done" + `shouldDrainTerminal` 多窗口 drain 兜。
- **修法**：可续事件日志（`afterSeq`/`Last-Event-ID` 一等公民）+ **真·终止符**（terminal 时 finalResult 已就绪，不早翻）。
- **kit 删**：`streamWindow` 的空-done 守卫、`turn-finalize.ts` 的 drain/重试多数分支。

### #3 env 注入 agent shell（REBYTE-NEEDS §1）
- **现象**：沙箱 `settings.json` 的 `env` 不进 agent 进程 → 现靠 seed 一个 `/code/.simplifly.env`（skill 原生 dotenv 读）+ SKILL.md 一句兜底。
- **修法**：`setEnv(vm, {...})` 真把 env 注进 agent 运行环境。
- **kit 删**：seed 凭证 workaround（`applyCredential` 的 dotenv 路 + 那句回落）。

### #4 envd 文件真删 / 原子 skill sync（REBYTE-NEEDS §2）
- **现象**：envd 无 DELETE，老沙箱换不干净 → 覆写废弃文件 / 换新 VM；`SEED_VERSION` bump 触发每用户就地 re-seed。
- **修法**：文件真删，或"原子替换一棵 skill 目录"。
- **kit 删**：`removeStaleArtifacts`（现走 envd gRPC-Web Remove 的脆路）+ 大半 `SEED_VERSION` 流转。

### #5 workspace 指令钩子（REBYTE-NEEDS §3）
- **现象**：front-line manager 系统提示词硬编码、无 per-workspace 指令；没它会 web_search + 编造机票 → kit 往**首条 prompt** 塞 `MANAGER_ROUTE_HINT` 路由句。
- **修法**：workspace/agent 级 system 指令字段，POST task 时带或在管理台配。
- **kit 删**：`MANAGER_ROUTE_HINT` 拼接；路由意图从"塞用户消息"变成"配 workspace"。

### #6 typed 事件
- 归 [rebyte-edge-sdk](rebyte-edge-sdk.md)（判别联合）。此处仅登记其平台前置：relay 得稳定吐这些 type/字段。

## 明确不做（本次）
- 不替 Rebyte 设计内部实现——本篇只列**现象 + 期望 + kit 收益**，方案留给平台（与 `REBYTE-ISSUE.md` 体例一致：描述现象不预设实现）。
- 不在 kit 侧提前删上述 workaround——**每条等对应平台改动上线、回归绿了再删**，否则线上即坏。

## 怎么确认每条 landed
**"kit 能删掉对应 hack 且回归仍绿"** = 该条已落地。回归勾子在 [streaming-experience-contract](streaming-experience-contract.md)：#1→R4 绿后删 `replaySubPrompt`；#2→R1/R2 绿后删空-done/drain；#3→删 `.simplifly.env` 后凭证仍通；#4→删 `removeStaleArtifacts` 后换 skill 仍干净；#5→删 `MANAGER_ROUTE_HINT` 后 manager 仍委派不 web_search（= `skill-eval-gate` 的 C1）。

## 备注
- 顺序即优先级：**#1 #2 解锁的是"结构化数据 + 流稳定"这两条产品命门**，最该先催。#3–5 是去 workaround、提复制速度。
- 全部落地后，[streaming-experience-contract](streaming-experience-contract.md) 里那几条"load-bearing race"大半会消失——契约更短、kit 更薄。
