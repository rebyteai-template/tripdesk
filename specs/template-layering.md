# Spec：模板分层 & 三条已定结论（其余 3 篇的定位锚）

| | |
|---|---|
| **状态** | 决策记录（Reference；锚定本目录另 3 篇 todo，本篇无 todo） |
| **创建** | 2026-06-12 |
| **相关** | `CLAUDE.md`、`REBYTE-ISSUE.md`、`REBYTE-NEEDS.md`；记忆 `rebyte-app-kit-template` / `tripdesk-template-positioning`；姊妹篇 [rebyte-edge-sdk](rebyte-edge-sdk.md) · [rebyte-protocol-asks](rebyte-protocol-asks.md) · [streaming-experience-contract](streaming-experience-contract.md) |

> **为什么**：把"和 Rebyte 交互层（尤其 streaming）抽成可复制模板（`rebyte-app-kit`）、各行业 ToB 快速铺开"这件事，先把**层 & 拥有权**钉死，免得后面把"该催 Rebyte 的"和"我们自己攥死的"混着改。本篇是定位锚，具体动手见另 3 篇。

## 三条已定结论（讨论已收敛）

**① AI SDK 不做 streaming 地基。** Vercel AI SDK 的引力中心是"你自己的服务器调模型 + 抹平 provider"。模板是 **relay 的客户端、不调模型**：`streamText` 用不上；它最大卖点（provider 归一）冗余（relay 已归一成一个 `{seq,eventType,payload}` 信封）；`useChat` 接不了 relay 自定义信封，要接得自己写 `relay→UIMessage` 适配器（= 要标准化的活本身，SDK 只给目标格式不做翻译）；agent-loop 的难点（子 agent 委派 / `subPromptId` / 可续 DO 生命周期）它无原生概念，且 `useChat` 的"一次 fetch = 一个 turn"与可续设计冲突。**唯一可选位置** = 想白嫖生态渲染组件（AI Elements / assistant-ui）时，把 canonical message 形状对齐 `UIMessage`，在浏览器最边缘只借类型 + 组件。cctools 前端自己也没用 AI SDK（只在 relay 的"调模型"层用 `streamText`），印证。

**② streaming 没和 DO 绑死——缝在 `RouteVars`。** 证据（`travelkit/server/routes.ts`）：文件头注释自承 handlers *"don't know whether … the runner is a Durable Object"*；live SSE（`/prompts/:id/stream`，`:128-160`）整段不碰 DO，就是循环 `store.framesSince(seq)` 推增量；`/content` 重建同理。DO 只以注入的 `runTurn`/`cancelTurn`/`recoverPrompt` **函数指针**出现。**绑死 streaming 的是 `Store`，不是 DO；DO 只是写 frame 的"执行腿"。** 20s 窗口 / alarm / 续跑是 **Workers 驱逐税**，换长生命周期运行时（容器 / Node job / Temporal——cctools relay 自己就跑 Temporal）反而更简单。搬云只重写执行腿（1 文件）+ Store driver + SSE 承载；streaming 契约一行不动。

**③ "rebyte SDK" ≠ "kit"。** SDK = 怎么跟 Rebyte 说话，且是**两个**：控制面（relay）+ 基质面（sandbox）。kit = 开箱即用的 agent-native app 壳，*用*这俩 SDK，叠上 store / auth / **streaming 体验** / `domain/` 缝。别混——混了就会问"streaming 该不该进 SDK"（不，它是 kit 的事）。

## 分层 & 拥有权

| 层 | 是什么 | 拥有 | 平台耦合 | 垂直差异 |
|---|---|---|---|---|
| 登录 | IdP 网关 + 租户 handoff（org/uid/token） | 网关=部署选择；handoff=kit | 换 IdP 改 `worker/auth.ts` | 0 |
| 存储 | tasks/prompts/frames + `Store` 接口 | kit | 0（接口+driver） | 0 |
| relay 交互① | task/prompt/events/content client | **应是 Rebyte SDK**；现 kit 手搓 | 0（纯 fetch） | 0 |
| sandbox 交互② | provision/seed/文件/凭证 | **应是 Rebyte SDK**（要 edge-native）；现 kit 裸搓 | 被迫去耦 → 更可移植 | 机制 0 / 种子内容 → `domain/seed` |
| turn-runner | 长跑执行 + 续跑 + 单写者 | kit（唯一 CF 焊死，未来 `TurnRunner` 接口） | 高（就这一处） | 0 |
| **streaming 体验** | translate→frames→store→tail/rebuild→derive | **kit 皇冠** | 契约 0；承载随平台 | 框架 0 / 卡片映射→app |
| domain | prompt / skill / 卡片 / UI 右栏 | app | — | 100% |

## 三档拥有权（收口）
- **Rebyte 平台** → relay-client + sandbox-client 两个 edge SDK + 吸收协议痛：[rebyte-edge-sdk](rebyte-edge-sdk.md) · [rebyte-protocol-asks](rebyte-protocol-asks.md)
- **你的 kit** → handoff / store / turn-runner / **streaming 体验**：[streaming-experience-contract](streaming-experience-contract.md)
- **垂直 app** → 只有 `domain/`

## 明确不做（本次）
- 不现在抽 `TurnRunner` 接口：对"CF 上快速复制"它是共享 backbone，没人碰；接口只对"换云"有意义，而那已证明是 1 文件重写，**等第一个非-CF 客户真出现再抽**（YAGNI）。
- 不引入 `ai` 包。

## 跨仓
实现时 travelkit 与 cctools 同改：本篇结论 ②③ 落 **travelkit/kit**；姊妹篇 SDK / asks 落 **cctools**。
