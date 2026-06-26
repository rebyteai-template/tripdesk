# composer-attachments — 输入框升级 + 图片/文件上传

> **状态**: In progress — 代码完成（2026-06-26）；`typecheck` + 17 单测 + `pnpm build` + 本地 D1 迁移(0005)全绿。待人工 e2e（dev relay，烧额度）。
> **创建日期**: 2026-06-25
> **相关**: app-kit `rebyteai-template/rebyte-app-kit`（upstream，本能力源）· `src/components/Composer.tsx` · `src/components/ChatPanel.tsx` · `src/frames.ts` · `server/routes.ts` · `worker/task-do.ts` · `worker/index.ts` · `server/store-d1.ts` · 记忆 [[rebyte-app-kit-template]] [[tripdesk-sandbox-credential]]

把 **rebyte-app-kit** 已验证的「输入框升级 + 图片/文件上传」能力搬进 TripDesk。app-kit 是这套 Rebyte 交互骨架的 upstream，TripDesk 是它的垂直派生，前后端骨架同构（jotai+RQ / `useSendMessage` / `Store` / 每任务 DO / `rebyteJSON`），所以这是一次**有适配的移植**，不是从零写。

## app-kit 里的来源（5 个提交）

- `cef082b` 图片/文件上传 → staged 进 `/code` + vision auto-delegate（管线主体）
- `9f297c9` composer 拖拽附件（onDragOver/onDrop + 高亮）
- `8c03182` 图片附件 → 即时上传、气泡缩略图 + lightbox
- `4a4ea58` composer + chat 布局打磨（圆角 shell、📎、自增长 textarea、图标按钮）
- `1d727f9` 文件附件 → 30MB 上限 + 一个可复用 `FileCard`

## 端到端流程（移植后 TripDesk 的样子）

1. **Composer**：📎 选择 / 粘贴 / 拖拽 → 每个附件**即时上传**（先出本地预览 + loading；上传完成前 send 禁用），图片在浏览器用 `<canvas>` 压成两张 WebP（thumb 512 / large 2048，均 <~250KB）。
2. **上传** `POST /api/app/files`（multipart：原文件 + thumb + large）：worker 用 relay 公有文件 API `createFile`（签名 URL）+ 服务端 PUT 原始字节到对象存储 → 返回 `{id, filename}`（= relay FileRef）；同时把两张 WebP 渲染件按 `fileId` 存进 D1（`attachments` 表）。
3. **发送**：`useSendMessage(text, atts)` → `createTask`/`followup` 带 `files:[{id,filename}]` → `routes` `linkPromptFiles`（气泡展示用）→ DO `TurnState.files` → relay `createTask`/`addPrompt` 带 `files` → **relay 把每个文件 stage 到沙箱 `/code/<filename>`**。
4. **给 manager 一行 nudge**：本轮带文件时，wire prompt（发给 relay、绝不进 UI 文本）= 用户文本 + 一行 `attachmentPromptSuffix`（点名 staged 路径 `/code/<file>`、让 manager 用 coding_agent 开+Read）。relay 只 stage 文件、给路径、不喂像素、不声明文件存在，故需这句把它正向引到沙箱去读，否则误路由（OCR /「看不到图」）。纯图发 text='' → wire 就是这一行（见适配 §7）。
5. **展示**：用户气泡上方渲染图片缩略图（点击 → Lightbox 大图）/ 非图片渲染 `FileCard`。图片字节由**鉴权过的** worker 路由 `GET /api/app/files/:id?size=thumb|large` 提供。

## TripDesk 适配 deltas（≠ 照抄 app-kit 的关键点）

1. **分租身份的载体不同（最关键）**。不是「有没有 cookie」，而是「给数据分租的身份在不在 cookie 里」。app-kit 的身份 = CF Access 用户（`authedEmail` 读 `Cf-Access-Jwt-Assertion`），它**自带在 Access cookie 里**，浏览器对同源每个请求（含 `<img src>`）都自动带 → 裸 `<img src=/api/app/files/:id>` 即可。**TripDesk 的身份 = embed handoff 的 `org/uid/token`**（iframe URL fragment 进来、SPA 转成 `X-Tenant-*` 头），**不在任何 cookie 里**——CF Access 的 cookie 即便在，也只证明「过了 OTP 网关」，不知道你是哪个 `org/uid`。而 `<img src>`/`EventSource` 设不了自定义头。好在 `worker/index.ts` 中间件**对发不了头的请求已支持 query 兜底**（`c.req.query('uid')` 等，SSE 就是这么干的）。所以：
   - 前端 `fileUrl()` 必须用 **`withAuthQuery`**（拼 `uid/org/token/k` 进 query），不是 app-kit 的裸 `fileUrl`。
   - 数据 scope 用 **tenant=`org:uid`**（即现有 `userEmail` 值），`attachments.user_email` 列存的就是它；`GET /files/:id` 校验 `att.userEmail === c.var.userEmail`。
   - `POST /files` 走 multipart，header 鉴权照常（`authHeaders`，不设 content-type 让浏览器带 boundary）。
2. **Composer 要合并，不是替换**。TripDesk 的 Composer 有 `forwardRef`+`useImperativeHandle` 的 **`fill` 句柄**（建议 chip 往输入框塞文字，`App.pickSuggestion`）。移植 = app-kit 的附件 Composer **保留** `fill` 句柄 + `ComposerHandle`。`onSend` 签名变 `(text, atts?)`。
3. **`frames.ts`（domain 状态机），不是 app-kit 的通用 `chat.ts`**。
   - `ChatBubble` 加 `attachments?: Attachment[]`；`PromptContent` 加 `attachments?: Attachment[]`。
   - `derive()` 里用户气泡 `chat.push({ key:`u-${p.id}`, role:'user', text:p.prompt, ...(p.attachments?.length ? {attachments} : {}) })`（仅非空才带 key，保 I0：乐观轮与刷新轮逐字节一致）。
   - 去重逻辑别误删带附件的气泡：现有 guard 已护 `cards`/`fare`，再加 `!b.attachments`。
4. **`ChatPanel` 渲染卡片，不是通用气泡**。在现有 `runUrl` / `cards|fare` / 普通气泡分支外，加一个**用户气泡附件分支**：图片 → `msg-thumb`（点击 setLightbox(largeUrl)）/ 非图片 → `FileCard`；附件块独立渲染（不进 accent 气泡），有文字则气泡跟在下面（ChatGPT 式）。新增 `Lightbox` 状态 + 组件。
5. **共享常量落点**。TripDesk 无 `domain/` 目录（app-kit 的 `domain/agent.ts` 在 TripDesk 没有对位）。把 `MAX_UPLOAD_BYTES`(30MB) + `attachmentPromptSuffix()` 放 **`server/attachments.ts`**（纯模块、无 secret、tsconfig 已含 `server`），routes.ts（同层）+ Composer（`../../server/attachments.ts`，纯常量/纯函数，vite 可打包）共用——**单一来源**满足两侧 defense-in-depth（前端先挡、服务端 413 再挡）。
6. **relay 客户端是函数式 `rebyteJSON`/`rebyteFetch`**，不是 app-kit 的 client class。
   - 上传：在 `server/rebyte/client.ts` 加 `uploadFileToRelay(config, {name,type,bytes})` 辅助（`createFile` 拿签名 URL → `fetch(uploadUrl, {method:'PUT', body:bytes})`），worker/index.ts 注入为 `uploadFile` RouteVar。
   - `task-do.ts`：relay `createTask` body 从 `{prompt, workspaceId}` → 带 `files`；`addPrompt` body 从 `{prompt}` → 带 `files`（**首轮和续轮都要带**——首轮 create、续轮 addPrompt）。
7. **附件 wire 指令 = 一行正向 nudge（2026-06-26 两次纠正收敛，对齐 app-kit `c421d97`）**。曾照搬 app-kit 的 4 句说教 suffix（让 manager 用 coding_agent 开 Read、别说看不到图、别反问）→ 用户嫌多余 → 一度**删光**只留路径 → 实测删光也不行:manager 只拿 `/code/X` 路径、**拿不到图像像素**，会误路由（OCR /「我看不到图」）。终态 = app-kit 最新一行版:`attachmentPromptSuffix(files)` 返 `\n\n[附注] 用户上传了 /code/<file>，用 coding_agent 打开并 Read（能直接看图）后回答。`，routes 里 `wirePrompt = text + attachmentPromptSuffix(files)`（纯图发 text=''→wire 就是这一行,非空 relay 收）。**一行正向、不堆 anti-X 防御、也不删光**（见 [[no-verbose-prompt-injection]]）。能不能真「看到」图是上游模型/沙箱多模态能力,prompt 补不了。skill 红线仍在:接口/文件没有的别编、写操作要 `ConfirmGate`。

## 改动清单

**新增文件**
- `server/attachments.ts` — `MAX_UPLOAD_BYTES` + `attachmentPromptSuffix(files)`（两侧共用；后者一行 nudge，见适配 §7）。
- `src/components/FileCard.tsx` — 非图片附件卡（composer 带 status/remove，气泡静态），单一来源。从 app-kit 照搬。
- `src/components/Lightbox.tsx` — 点击缩略图的大图浮层（Esc/点击关闭）。照搬。
- `src/lib/thumbnail.ts` — `makeRenditions(file)`：`<canvas>` 压两张 WebP（图片才有，否则 null）。照搬。
- `migrations/0005_attachments.sql` — `attachments` + `prompt_files` 两表（同 app-kit `0003`）。
- 测试脚本（可选）：`server/rebyte/` 下加一个上传 e2e 探针，沿用现有 probe 风格。

**编辑**
- `src/api.ts` — 加 `AttachmentMeta`/`Attachment`/`SentAttachment`/`FileRef` 类型、`fileUrl`(用 `withAuthQuery`)、`toAttachment`、`uploadFile()`；`createTask`/`followup` 加 `files?` 入参；`loadContent` 把 `attachments` 经 `toAttachment` 映射；`PromptContent` 加 `attachments?`。
- `src/components/Composer.tsx` — 合并附件能力（📎/粘贴/拖拽/即时上传/预览/删除/send 门控）**且保留** `fill` 句柄；`onSend(text, atts?)`。
- `src/hooks/useSendMessage.ts` — 加 `atts?: SentAttachment[]`，built 乐观 `attachments`（`toAttachment`）+ `refs`，透传给 `createTask`/`followup`/`addTurn`。
- `src/App.tsx` — `send` 已经传给 Composer，签名兼容；无大改（`pickSuggestion` 经 `fill` 不变）。
- `src/components/ChatPanel.tsx` — 加用户气泡附件分支 + Lightbox。
- `src/frames.ts` — `ChatBubble.attachments` + `derive()` 挂附件 + 去重 guard。
- `src/styles.css`（+ 必要时 `src/kami-tokens.css`）— 移植 composer-shell/icon-btn/attachment-card/file-card/msg-thumb/lightbox 样式，套 TripDesk kami token。token 基本齐，**仅缺 `--radius-xl`**（加一行）。
- `server/routes.ts` — `RouteVars` 加 `uploadFile` + `runTurn` 带 `files`；`POST /files`（413 上限）；`GET /files/:id`（鉴权 serve WebP）；`/tasks` 与 `/tasks/:id/prompts` 加 `linkPromptFiles` + `wirePrompt = text + attachmentPromptSuffix(files)`（空文字+有附件放行,纯图发 wire=那行 nudge），把 `files` 透传 `runTurn`（UI 文本仍存原 `text`）。
- `server/store.ts` + `server/store-d1.ts` — 加 `saveAttachment`/`getAttachment`/`linkPromptFiles`/`listPromptAttachments`（照搬 app-kit，注意 D1 BLOB → number[]/ArrayBuffer 兼容那段）。
- `worker/index.ts` — 注入 `uploadFile` RouteVar（构 relay config + `uploadFileToRelay`）；`runTurn` 闭包透传 `files` 到 DO。
- `worker/task-do.ts` — `TurnState.files`；`runTurn(...,files)`；relay create/addPrompt body 带 `files`。
- `server/rebyte/client.ts` — `uploadFileToRelay` 辅助。

## 不做 / 风险

- **不**做「上传证件 → 自动回填 `PassengerForm`」的域联动（图片进 `/code` + manager 能读已够；回填是后续）。
- **不**碰 vendored skill（[[skill-is-vendored-dont-edit]]）；附件靠 relay 原生 `files` stage + suffix 指路，不改 skill。
- 上限 30MB 是 app-kit 默认；若 relay 文件 API 上限不同，按实际调 `MAX_UPLOAD_BYTES`。
- WebP 渲染走浏览器 `<canvas>`，避开 Worker CPU；非图片只存元数据、渲染成 chip。
- `src → server` 的跨层 import（Composer 引 `server/attachments.ts`）是有意为之的单一来源；若不接受，退路是新建 `domain/` 并加进 tsconfig `include`。

## 验收

- [x] `pnpm typecheck` 过。
- [x] `pnpm test`（17 单测）+ `pnpm build`（vite，cross-layer `server/attachments.ts` 进 client bundle OK）+ `pnpm db:migrate:local`（0005）全绿。
- [ ] 本地 `pnpm dev`（带 `#org=dev&token=dev` handoff，见 [[tripdesk-browser-testing]]）：📎/粘贴/拖拽出附件 → 上传转圈 → ready → 发送 → 用户气泡见缩略图 → 点击 Lightbox；刷新页面附件仍在（`loadContent` 映射 + 鉴权 serve）。*注：附件即时上传走真 relay 文件 API（便宜，非 agent 额度）；只「发送」才烧 agent 额度，故缩略图/Lightbox 可不发送即测。*
- [ ] dev relay e2e（烧额度，慎跑）：发一张图问「这是什么」→ manager 委派沙箱 `Read` `/code/<file>` → 基于真实内容作答，不出现「我看不到图」。
- [ ] 鉴权：未带 `k`/`token` 的 `/files/:id` 请求 → 404/401；他人 `fileId` → 404。
