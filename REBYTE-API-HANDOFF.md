# Rebyte 公开 API 回归排查 — 交接 prompt

> 用途：粘到一个能访问 rebyte relay / SDK 源码（cctools/relay 那套）的调试 session 里，定位并修复"外部客户端用 org key 发任务、能发进去但回复取不回来"的回归。API key 单独给（不写进本文件，repo 安全）。

---

你在排查 **rebyte 公开 task API（org `rbk_` key）的一个回归**。一个外部客户端（不在 rebyte 代码库内，只用公开 `https://api.rebyte.ai/v1` + `API_KEY` 头）按 adits 的方式调用任务 API，现象是：**任务能发过去、rebyte 也真的跑出了 agent 回复（控制台 UI 能看到），但回复通过公开 API 一个字都取不回来。** 怀疑与最近"把 task 入口全部改走 agent_loop / manager agent"的改动有关。请定位并修复，使**公开 API 客户端能拿到 agent 的回复**。

## 客户端怎么调用的（要保持兼容的契约）
- 鉴权：`API_KEY: rbk_...` 头，base `https://api.rebyte.ai/v1`。
- 建任务：`POST /v1/tasks`，body `{ "prompt": "..." }`（也试过带 `workspaceId`/`executor:"claude"`/`model:"claude-sonnet-4.6"`，行为一致）。
- 取回复（两种都试了）：
  - 流式：`GET /v1/tasks/:id/events`，`Accept: text/event-stream`。
  - 拉取：`GET /v1/tasks/:id/content?include=events`，读 `prompts[].events` 和 `prompts[].response`。

## 症状（精确）
对 **manager 直接回答**的任务（例：prompt = "请用一句话介绍你自己"）：
- `POST /v1/tasks` → 201，`status:running`，UI 上 agent 正常回复（如"我是 Rebyte 托管的云端智能助手…"）。
- 但公开 API 取不到这条回复：
  - `GET /v1/tasks/:id/events`（带 Accept）→ 连上即 `event: done {status:"succeeded", lastSeq:-1, finalResult:""}`，**0 个 event**（连得稍晚则直接 done，因为只对活跃 task 回放、且 manager 事件根本不写这条流）。
  - `GET /v1/tasks/:id/content?include=events` → `prompts[].response: null`，`prompts[].events: []`。
  - 其它端点 `/tasks/:id/messages`、`/result`、`/output` → 404。
- **复现 task（org key）**：`117d5c89-d3d1-46c7-af58-ab2b5d57ef7a`（UI 有回复，API 空）。
- **A/B**：换另一个 org 的 key 跑同一 prompt（task `4eeda8b4-2edb-4854-9a16-a2830a3e2d05`）→ **同样 0 event**。说明不是某把 key/某 org 的设置问题，是 agent_loop 路径本身。

对 **委派到沙箱 coding agent** 的任务，沙箱子 agent 的事件**能**从 `/events` 出来（`{seq,eventType,payload}`，eventType ∈ init/thinking/tool_use/tool_result/text/result，末尾 `done{finalResult}`）。但：
- 一个 org 的订票任务里，沙箱子 agent 起来了（`/events` 上有 `init{cwd:"/code"}`）但 **`result.usage.input_tokens:0`、`result:""`**（子 agent 收到空输入）→ 之后父 prompt 被标 failed。对照另一个 org 同样 seed 的同类任务能跑出完整结果。复现：org 订票任务 `52c61cbf-215d-475f-9bc8-c248b2525937` / `10d1134d-99b2-44f3-a78b-69df3910db1c`（空）；可跑通的对照 `3f8e7018-edbb-415c-a4f7-0ad0b83a5c5a`（完整 travelkit 输出）。

## 根因假设（基于读 cctools/relay 源码，请核对/修正）
1. **manager 输出没进公开 events 流**：`POST /v1/tasks` 现在硬编码 `executionMode='agent_loop'` 并走 `launchAgentLoopPrompt`（`relay/src/routes/v1/tasks.ts:113-132`；`executor/model` 被 `void`，`:66-71`）。manager 的消息写到 `agent_messages` + 进程内 `agentLoopBus`/`frontlineBus`，而 `GET /v1/tasks/:id/events` 读的是对象存储的 events 路径（`relay/src/services/TaskStreamEngine.ts` 的 `fetchEventsFromGcs`，事件结构 `ExecutionEvent` 在 `:45-51`）。→ manager-only 任务，公开 events 永远是空。
2. **`/content` 不回填 response/events**：`prompts[].response` 一直是 null、`events:[]`（`tasks.ts` 的 content handler，约 `:255-293`）；agent_message 的最终文本没镜像到公开 content。
3. **prompt 行 submitted==completed 是构造产物**：`AgentLoopTaskService.ts:81-89` 插入即冻结 `submitted_at=completed_at=NOW()`；真实状态靠 `applyEffectiveStatus` 从 `agent_messages` 叠加（`PromptRequestRepository.ts:92-142`）。
4. **子 agent 派发丢上下文**：agent_loop 派 coding 子 agent 时只传 prompt 相关字段，不传 `mcpServers/env/skills`（`dust-loop/workflows.ts:638-657`；`submitTask` 默认空 `task-submit.ts:608-620`），且 relay 侧 MCP 注入被禁（`rebyteaivm.ts:419`）。子 agent 还可能收到空 instruction（观测到 input_tokens:0）。空结果 → `sub_agent_dispatch.ts:335-336` 抛 "succeeded without a final result"（无重试 `workflows.ts:144-149`）→ `workflows.ts:398` catch → agent_message failed → 父 prompt failed。
5. 经典/直连路径（`/api/vm-tasks` `agentLoop:false`，会透传 mcpServers + 把 CCC 事件落到 events 流）是 **Clerk-only**（`routes/index.ts:226`），org key 够不到。

## 期望修复后的公开 API 契约（外部客户端需要的）
1. **manager 的文本回复必须能通过 org-key 公开 API 取到** —— 二选一即可：
   - 在 `GET /v1/tasks/:id/events` 上以 `text`/`result` 事件流出 manager 的回复；或
   - 把最终回复回填到 `GET /v1/tasks/:id/content` 的 `prompts[].response`。
2. `GET /v1/tasks/:id/content?include=events` 在任务完成后应返回已记录的事件（现在 `events:[]`）。
3. （订票场景需要）让客户端能把 `mcpServers`/`env`/`skills` 传给任务，并由 agent_loop **转发给沙箱子 agent**（现在被丢弃），否则子 agent 看不到我们 seed 的 MCP；并修子 agent 收到空 instruction（input_tokens:0）的问题。
4. 保持事件信封结构稳定：`{ seq, timestamp, promptId, eventType, payload }`，`eventType` ∈ `init|thinking|tool_use|tool_result|text|result`，SSE 终止 `event: done` payload `{ status, lastSeq, finalResult }`。

## 一键复现（curl）
```bash
# 1) 建任务（manager 直接回答型）
curl -sS -X POST https://api.rebyte.ai/v1/tasks \
  -H "API_KEY: $REBYTE_API_KEY" -H "Content-Type: application/json" \
  -d '{"prompt":"请用一句话介绍你自己。"}'
# 记下返回的 id

# 2) 取回复（都为空 —— 这就是 bug）
curl -sS -H "API_KEY: $REBYTE_API_KEY" \
  "https://api.rebyte.ai/v1/tasks/<id>/content?include=events"   # prompts[].response=null, events=[]
curl -sS -H "API_KEY: $REBYTE_API_KEY" -H "Accept: text/event-stream" \
  "https://api.rebyte.ai/v1/tasks/<id>/events"                    # 立即 done, 0 event
# UI 却有回复：https://app.rebyte.ai/run/<id>
```

## 一句话目标
让上面 curl 第 2 步能拿到 UI 里那条 agent 回复（流式或 content.response 任一），并让委派沙箱的任务能收到 prompt + 我们传入的 mcpServers。修完告诉外部客户端：回复从哪个字段/事件取。
