# specs/ — 任务级 spec & todo 文档

放**有生命周期的、针对某件「要做的事」**的需求/设计/todo 文档：开工前写清楚要做什么、怎么验收，
开工后当 checklist，做完归档。每篇一个 kebab-case 文件。

> 与**根级常驻文档**区分:`CLAUDE.md` / `PRODUCT.md` / `DESIGN.md` / `REBYTE-ISSUE.md` / `REBYTE-NEEDS.md`
> 是「长期为真」的参考(且被按文件名引用,别挪);`specs/` 是「这件事要做」的任务 spec,做完可标 Done / 归档。

## 当前

| 文档 | 状态 | 摘要 |
|---|---|---|
| [composer-attachments.md](composer-attachments.md) | In progress | 输入框升级 + 图片/文件上传:从 app-kit 移植(📎/粘贴/拖拽→即时上传→staged `/code`+vision auto-delegate→气泡缩略图/Lightbox);适配 TripDesk 的 embed 鉴权(图片 URL 走 query)+ domain `frames.ts`/卡片 `ChatPanel`。**代码完成**(typecheck/单测/build/迁移全绿),待 dev relay e2e |
| [skill-eval-gate.md](skill-eval-gate.md) | TODO | skill 迭代验收:评分版 eval harness（`server/rebyte/eval.ts`）+ pre-deploy 手动门控,关键红线全绿才 promote 新 skill |
| [chat-stream-cards.md](chat-stream-cards.md) | In progress | 单列纯聊天已落地:搜索卡(L1)+验价卡+写流全内联、删左右分栏(L2);交互UI选型砍 R1(`ask_user_question` api 来源不可用);待接 下单/支付卡 + R2(HTML报告→PDF 北极星) |

> **模版相关 spec 已移出**（2026-06-15）：`template-layering` / `streaming-experience-contract` / `rebyte-edge-sdk` / `rebyte-protocol-asks` / `rebyte-workspace-config-v1` 已转移到模板仓 **`rebyteai-template/rebyte-app-kit`** 的 `specs/`（kit 是这些「Rebyte 交互 / 分层」契约的 upstream 源）。本目录只留 TripDesk 的 domain 篇。

## 约定
- 新增一篇 = 建 `specs/<kebab-name>.md` + 在上表加一行。
- 顶部带 meta:**状态**(TODO / In progress / Done / Archived)、**创建日期**、**相关**(代码路径 / 其它 spec / 记忆)。
- 做完后把状态改 Done;长期不再相关的标 Archived(或移 `specs/archive/`)。
