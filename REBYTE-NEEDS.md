# 需要 rebyte 平台支持的能力（开放项）

> 这些是 TripDesk 目前靠「临时旁路」绕过、但本该由 rebyte 沙箱平台**原生支持**的能力。
> 旁路都收敛在我们自己的层（`worker/seed.ts`、UI），未改动 vendored 的 travelkit skill 主体
> （仅在 `SKILL.md` Credentials 段加了一句指引，见下）。
> 另见 `REBYTE-ISSUE.md`（agent-loop 结构化结果无法到达父任务，是独立的另一个问题）。

---

## 1. 沙箱 env 注入：`.claude/settings.json` 的 `env` 不进 agent 的 shell

**现象**：我们把每用户的 Simplifly 凭证写进沙箱 `/code/.claude/settings.json` 的 `env` 块，
期望无头 Claude Code 把 `SIMPLIFLY_BASE_URL` / `SIMPLIFLY_AUTH_TOKEN` 注入到 agent 的 bash 环境。
实跑发现**根本没注入**——子 agent `env | grep SIMPLIFLY` 为空，于是它到处翻 `.env*` / home
目录都找不到、放弃，导致整条机票流程拿不到 token 跑不起来。

**当前旁路（临时）**：`worker/seed.ts` 额外写一个可 `source` 的 `/code/.simplifly.env`，并在
vendored skill 的 `SKILL.md` Credentials 段加一句，指引 agent「调 API 前先
`set -a; source /code/.simplifly.env; set +a`」。`settings.json` 的 `env` 保留作镜像。

**期望 rebyte 支持**：沙箱能把每用户的 env（provision / seed 时传入）真正注入到 agent 运行时
环境变量里——这样凭证就是标准 env var，skill 无需任何特殊指引，也不必落地明文 env 文件。

---

## 2. skill 更新：已 provision 的沙箱里干净替换 skill — 已解决 ✅

**原以为的现象**：skill 搬运进沙箱 `/code/.claude/skills/...`，上游一变老沙箱拿不到新版，
因为 envd 的 **REST 文件 API `/files` 没有 DELETE（405，`allow: GET,HEAD,POST`）**，re-seed
只能「覆盖同名文件」，废弃的旧文件（如 MCP 时代的 reference 文档）残留。

**真相**：REST `/files` 确实没 DELETE，但 envd 另外暴露了 **gRPC-Web Filesystem 服务**
`filesystem.Filesystem/Remove`，它**能真删**，且接受和写入相同的鉴权（`X-API-KEY` +
`Authorization: Basic base64("user:")`，无需 JWT/team_id）。对一台 live 沙箱实测：写→200、
`Remove`→`grpc-status:0`、再 GET→404；删不存在的文件→`grpc-status:5`（当幂等成功）。

**现在的做法**：`worker/seed.ts` 的 `removeFile()` 手搓一个 gRPC-Web 一元调用（纯 fetch、零依赖、
Workers 原生，和 `writeFile` 同构）。`removeStaleArtifacts()` 改成对 `STALE_FILES` 真删，re-seed
（`seed_version` bump）时自动清理废弃文件。**不再需要**覆写 inert，也不必靠「新 VM」按钮换沙箱。
探针：`server/rebyte/removeprobe.ts`。

**为什么不用 SDK 的 `files.remove`**：rebyte-sandbox SDK 跑不进 Worker（Template 模块静态
`import fs/tar`），即便拆出 fs-free 子入口，其 gRPC ransport 还会附带 `Rebyte-Sandbox-Id` /
mint 出来的 `X-Access-Token` 等网关头，在 rebyte envd 上**反而 401**（实测）；其 REST `write`
也因响应体结构不符报错。结论：rebyte envd 网关只认我们这套 raw 鉴权，手搓比 SDK 更可靠。

**残留的小建议（非阻塞）**：若 rebyte 想让 SDK 可用，可① 给 envd 网关的 gRPC 路同样接受
`X-API-KEY`（或修正 `X-Access-Token` minting 不需 team_id）；② SDK 拆一个不含 Template 的
fs-free 入口。但 TripDesk 侧已无需求。
