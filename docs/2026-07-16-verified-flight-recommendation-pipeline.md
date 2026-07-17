# Verified flight recommendation pipeline：实施记录

Date: 2026-07-16

Repositories:

- `simplifly-flyai-skill`
- `travelkit`

Status:

- FlyAI 推荐管线和入口契约已经提交并推送到远端 `main`。
- TravelKit 消费端已经在 `feat/verified-flight-recommendations-v2` 工作区实现，尚未作为独立提交进入 TravelKit `main`。
- 普通推荐的主链路已经从“Agent 拼多张搜索表”改为“一次完整 Intent → 一次 `recommend` → 一个权威 `flight.recommendations` 结果 → TravelKit 原样渲染”。

本文不再作为待实施计划使用。它记录原始故障、已经落地的设计、两个仓库当前的责任边界、验证证据和仍未完成的工作。当前代码事实优先于本文中的历史背景。

## 最终结果

系统现在有一个明确的最终推荐领域结果：`flight-recommendations/v1`。

它由 FlyAI 代码生成，而不是由用户提供，也不是由 Agent 从多张表中拼出来。一个结果可以包含多个完整方案；每个方案同时包含：

- 所有 requested journeys；
- 所有 passenger/cabin groups；
- 同一物理行程上的混舱匹配；
- ticket groups 及其 journey coverage；
- 准确人数的验价结果；
- `verifiedFareTotal` 和可用时的 `customerQuoteTotal`；
- `copyText`、validity 和 capabilities。

TravelKit 不再承担推荐算法。它只校验这个契约是否安全、完整，然后按 Skill 返回的顺序和内容渲染。

## 原始生产故障

参考 run：

- `https://app.rebyte.ai/run/bfeec421-a249-414d-8bf5-184443497c3e`

原请求同时包含：

- 8 月 14 日，北京到墨尔本；
- 8 月 24 日，悉尼到香港；
- 每个 journey 都需要 1 人商务舱和 3 人经济舱。

旧 Agent 把它拆成四次独立搜索：去程商务、去程经济、另一航线商务、另一航线经济。随后 Agent 从四份结果里分别挑低价。商务舱和经济舱可能来自不同物理航班，因此文字结论并不是一个合法客户方案。

该 run 只有四个 `flight.search` 中间结果，没有结构化最终推荐。TravelKit 只能展示四张搜索表，无法判断 Agent prose 中的组合是否完整、同航班或已验价。

根因不是 UI 排版，而是系统没有一个代码层拥有“从召回结果生成完整客户方案”的责任。

## 当前架构

```text
用户自然语言请求
→ Agent 编译 flight-recommendation-request/v1
→ 一次 recommend 调用接收包含全部 journeys 的完整 Intent
→ FlyAI 召回、组合、验价、修复和选择方案
→ FlyAI 输出一个 flight-recommendations/v1
→ Rebyte 回放结构化 tool_result
→ TravelKit 校验契约并原样渲染
```

Agent 是语言入口，不是票价组合器。FlyAI 是推荐结果生产者。TravelKit 是严格消费者。

## 已完成：FlyAI 推荐生产者

FlyAI 的核心实现位于：

- `skills/simplifly-flyai-skill/scripts/lib/recommendation.ts`
- `skills/simplifly-flyai-skill/scripts/flight.ts`
- `skills/simplifly-flyai-skill/references/recommend.md`
- `skills/simplifly-flyai-skill/SKILL.md`

### 输入和调用边界

- 增加 `flight-recommendation-request/v1`。
- 增加显式 `recommend --request-file` 命令，没有改变 `search`、`verify` 或 `proposal` 的旧含义。
- 一个用户推荐请求的全部航线必须放进同一个 `journeys[]`，只能调用一次 `recommend`。
- Agent 只能填写 journeys、passenger groups、支持的 hard constraints、soft preference 和 requested result count。
- Agent 不能填写 searches、`coverKey`、solutionId、verification shortlist 或运行预算。
- 地点保留用户表达粒度：城市使用 `city`，明确机场使用 `airport`。例如“北京”是 `BJS/city`，“首都机场”是 `PEK/airport`。
- 普通推荐追问重新编译一个完整 Intent；`refine` 只适用于旧 `search` session。

### 召回和完整方案生成

- 代码从 Intent 展开适用的 one-way、round-trip、joint/open-jaw 查询。
- 所有 passenger/cabin groups 使用准确人数查询。
- 物理行程身份由航段、航班、日期、机场和时间确定，不包含舱等。
- 不同 passenger groups 只有匹配同一物理行程时才能组成一个 plan。
- 每个 passenger group 对每个 journey 必须恰好覆盖一次。
- ticket group 明确记录 `fareSource` 和 covered journeys；多程票价不会被伪造拆成逐段价格。
- 混合币种方案在排序和输出前拒绝。
- city request 可以匹配同城机场；airport request 必须保持指定机场精确性，修复了 `PEK/PKX ↔ BJS` 混淆。

### 选择策略

- 价格在可比较的候选类别内决定优先级，不做一个全局价格列表后简单截断。
- 直飞、一次中转、journey 时间窗和停留次数组合都有机会保留各自的低价代表。
- 未设置 `directOnly` 时，直飞是必须参与比较的软偏好类别；它不会因为中转更便宜而在候选截断前全部消失。
- 只有用户明确要求直飞时，Agent 才设置 `directOnly`。
- `requestedResultCount` 是效果目标，不是必须凑满的硬约束；代码上限已经从原计划的 5 调整为 10。
- 少于请求数量时返回有效方案的剩余集合，不生成相似、未验价或不完整的填充方案。

### 验价、修复和状态

- 验价使用每个 passenger group 的准确人数。
- 相同 solution 和人数上下文共享验价结果。
- 验价失败会淘汰所有依赖该 solution 的 plans，并从 reserve 中继续补位。
- repricing 被视为成功验价：更新依赖价格后重新排序，不把旧价格继续展示。
- 当前保护上限包括 500 个 candidate plans、30 次验价尝试和 120 秒验价 wall-clock budget。
- 输出包含 `status`、`coverageStatus`、`budgetStatus`、missing fare constructions 和 diagnostics。
- 推荐 session 会保存 `recommendation-intent.json`、`recommendation-result.json` 和 `recommendation-trace.json`。

### 输出契约

FlyAI 输出：

```text
schemaVersion: flight-recommendations/v1
resultType: flight.recommendations
status: success | partial | empty | fatal_error
coverageStatus: complete | partial | failed
budgetStatus: within_budget | exhausted
plans: 0..10 complete verified plans
```

每个 plan 自带稳定 `planId`、journeys、windows、passenger groups、ticket groups、验价总额、validity、`copyText` 和 capabilities。

### Skill 入口契约

FlyAI Skill 入口已经同步：

- 自然语言查机票、比价和推荐默认走 `recommend`。
- `search`、`refine`、`pricing`、`verify`、`quote` 和 `proposal` 只保留为诊断、证据或显式旧流程命令。
- 普通推荐直接使用 `flight.recommendations`，不再套 `output-formats.md`，不再转成 legacy `quote` 或 `proposal`。
- Agent 不组合 offers、不计算总价、不修复验价失败、不改写代码生成的 transactional facts。
- `empty` 或 `fatal_error` 后也不能拆分原 Intent，再从多个结果中手工组合。

FlyAI 已推送到远端 `main`，相关提交为：

- `109ecf4 feat(flight): add verified recommendation pipeline`
- `4767f66 fix(flight): preserve direct and diverse recommendations`
- `f5589f6 fix(flight): distinguish metro and airport endpoints`
- `2ac7c86 fix(skill): require one complete recommendation intent`
- `9c1102f fix(skill): clarify recommendation routing`

## 已完成：TravelKit 严格消费者

TravelKit 的核心实现位于：

- `src/frames.ts`
- `src/components/FlightRecommendations.tsx`
- `src/components/ChatPanel.tsx`
- `server/frames.test.ts`
- `server/flight-recommendations.test.ts`

### 契约解析和安全校验

TravelKit 按 `schemaVersion` 和 `resultType` 识别最终推荐，并校验：

- status、coverage 和 budget 枚举；
- plan 数量不超过 10，且 `planId` 唯一；
- journey、segment、window 和 passenger group 字段完整；
- ticket group 引用有效 passenger group 和 journey indexes；
- 每个 passenger group 对全部 journeys 恰好覆盖一次；
- exact passenger count 与 passenger group 一致；
- ticket-group currency 与 plan total 一致；
- ticket-group verified prices 之和等于 `verifiedFareTotal`；
- verification/validity 时间关系有效；
- Copy、Reverify 等 capability 与 validity/copyText 一致。

显式 `flight.recommendations` 如果版本未知或字段非法，会 fail closed 为 `fatal_error`。TravelKit 不会退回 search table 或 Agent Markdown，把中间证据冒充最终结果。

### 一个轮次只能有一个最终推荐集合

- 同一用户轮次只有一个 plan-bearing `flight.recommendations` 可以成为最终结果。
- 如果 Agent 把原请求拆成多次 `recommend`，并返回多个不同的 plan-bearing result，TravelKit 会 fail closed，不会采用最后一个，也不会在 UI 合并。
- Rebyte 对同一个结构化结果的重复回放会按相同 plan signature 去重，不算协议冲突。

这层校验是协议安全边界，不是推荐算法。拆分调用的根因仍应在 FlyAI Skill/Agent 调用契约中修复。

### 权威性和渲染

- `flight.recommendations` 与 search、verify 或 legacy proposal 同时出现时，最终推荐始终优先，不依赖 frame 顺序。
- 旧 search results 仅作为折叠、只读的中间证据保留。
- Agent Markdown 中的表格不会覆盖或重复最终推荐。
- TravelKit 按 Skill 给出的 plan 顺序全部渲染；相同时间窗的不同 plans 不会被合并。
- 所有 plans 在同一张高密度对比表中按 Skill 顺序渲染；一个物理 segment 一行，方案、ticket group 和 journey 事实只在各自覆盖范围的第一行出现。
- 每个 journey 的物理航班只显示一次；商务和经济等 passenger group 使用 ticket group 的 `segmentFacts` 展示精确分段舱位和行李。某段数据缺失时显示 `未返回`，不使用 ticket 或 journey 汇总字段兜底。
- ticket groups 在查询 / 票价列中单独显示 fare source、covered journeys、渠道和总价；往返或联合票价格不会拆写到单个 journey。
- Copy 只使用 plan 自带的 `copyText`，并由 `capabilities.canCopy` 控制。
- UI 不按价格、经停、时间窗或本地时钟删除、合并、重排方案。
- UI 不根据 `partial` 或 `budgetStatus` 自行生成“不是最低价”等业务说明；只有 Skill 明确提供 `message` 或 `reason` 时才展示说明。

## 两个仓库的最终责任边界

### Agent 负责

- 把自然语言编译成一个完整 Recommendation Intent。
- 缺少会实质改变召回的字段时向用户确认。
- 解释 Skill 已生成的完整方案之间的主观差异。
- 只引用已有 `planId`，不改写 itinerary、ticket group、price、coverage 或 validity。

### FlyAI Skill 负责

- 召回、归一化、同物理行程匹配和完整方案组合。
- 直飞、中转、时间窗与价格的候选选择。
- exact-count verification、失败补位、repricing 和最终排序。
- `flight.recommendations`、diagnostics、`copyText` 和 capabilities。

### TravelKit 负责

- 版本、字段和跨字段不变量校验。
- 非法或冲突最终结果 fail closed。
- 按 Skill 输出原样展示所有合法方案。
- 提供 Copy、Retry 等 capability 授权的交互。
- 把 search/verify 降为只读证据。

### TravelKit 不负责

- 判断推荐是否“好”；
- 补直飞、删中转、重新按价格排序；
- 合并多个 `recommend` 结果；
- 从 Agent prose 或 tool event 顺序推断客户方案；
- 使用本地时间把 verified plan 改成 expired；
- 生成 Skill 没有给出的业务 warning。

方案质量问题必须回到 FlyAI Skill 修复。TravelKit 出现的契约拒绝、重复最终结果或渲染缺字段，才属于 TravelKit 问题。

## 已验证场景

FlyAI 自动化测试覆盖：

- Intent 版本和 Agent 禁填执行字段；
- requested result count 上限 10；
- one-way、round-trip、joint/open-jaw query expansion；
- mixed-cabin same-itinerary matching；
- mismatched itinerary 和 mixed currency 拒绝；
- city/airport endpoint 语义；
- repricing 后物理行程变化拒绝；
- 直飞、一次中转、时间窗和停留次数多样性；
- candidate limit 之前保留直飞和一次中转类别；
- exact-count verification、失败修复和多方案输出。

TravelKit 自动化测试覆盖：

- 推荐结果不受 frame 顺序影响；
- 推荐结果压过 legacy proposal 和 search/verify evidence；
- 非法 schema、重复 planId、超过 10 个 plans、coverage/count/currency/copyText 错误 fail closed；
- 同一轮次多个不同结果 fail closed；
- 相同结果重复回放去重；
- 相同 time window 的不同 plans 保留原顺序；
- loading、empty、fatal states 不恢复中间 search 为主结果；
- 不使用本地 expiry clock 修改 Skill 状态；
- 一个 physical journey 只显示一次并附多舱等价格；
- evidence 折叠只读；
- partial 只有显式 Skill 文本时才展示说明。

## 与原计划不同的最终决策

原 TODO 中以下内容已经被后续讨论修正：

1. **方案数量不是 5 的硬约束。** 默认希望返回若干有效方案，代码最多接受 10；效果优先，不能为凑数降低正确性。
2. **直飞不是只有用户明确要求才参与。** 未设置 `directOnly` 时，直飞必须作为软偏好类别参与候选比较；只有用户明确要求时才成为硬过滤。
3. **TravelKit 不判断价格是否过期。** validity 和 Reverify capability 必须由 Skill 明确给出；消费端不读取本地时钟改变业务状态。
4. **不同航线不能分开推荐后由 UI 合并。** 一个用户请求只能产生一个包含全部 journeys 的最终 recommendation set。
5. **UI 不是推荐修复层。** 缺直飞、排序差或方案相似，修改 FlyAI；TravelKit 只做契约校验和展示。

## 尚未完成或未形成生产保证

以下事项不能从现有实现推断为完成：

- TravelKit 已支持 Skill 明确返回的 `expired` 状态和 per-plan Reverify action；但当前 FlyAI `recommend` 不会发出可 Reverify 的 expired plan，因此端到端重新验价仍未形成生产路径。
- 可选的“Agent 只返回 planId 的主观排序”还没有独立的代码校验和二次排序接口；当前正常结果由代码排序后直接输出。
- 原计划中的 exhaustive composition oracle、全量 sanitized eval corpus、代表性负载 benchmark 和 shadow/feature-flag rollout 没有形成完整发布门禁。
- `recommendation-trace.json` 已记录关键阶段信息，但还没有接入持久化生产指标或 dashboard。
- TravelKit 的推荐实现仍在功能分支工作区，必须完成提交、测试和发布后才是 TravelKit `main` 的事实。

这些剩余项不能通过在 TravelKit 增加第二套筛选或排序算法解决。

## 当前发布状态

### FlyAI

- Remote: `TravelKit-AI/simplifly-flyai-skill`
- Branch: `main`
- Current implementation commit: `9c1102f`
- Rebyte 新 session 会从远端 `main` 安装该版本。
- 本次记录更新时，Node 22 下 `npm test` 通过：117 tests，0 failures。

### TravelKit

- Branch: `feat/verified-flight-recommendations-v2`
- 推荐消费者、renderer 和测试当前存在于工作区。
- 本次记录更新时已在 Node 22 下运行并通过：

```bash
pnpm test       # 68 tests，0 failures
pnpm typecheck  # passed
pnpm build      # passed
```

## 后续修改准则

定位问题时先判断所属层：

- Agent 拆 Intent、调用多次 `recommend`、回退到 `search`：修 Skill 入口契约。
- 缺直飞、候选单一、票价构造不合理、排序不佳：修 FlyAI recommendation pipeline。
- 同航班混舱错误、journey/ticket coverage 错误、总价或验价错误：修 FlyAI，并保持 TravelKit fail closed。
- schema 不兼容、非法结果未拒绝、多个最终结果被静默采用、渲染漏字段：修 TravelKit。
- UI 仅仅“没有重新筛选方案”：这是正确行为，不是缺陷。

不要恢复以下旧路径：

- 多个独立 `search` 结果由 Agent 手工组合；
- 多个独立 `recommend` 结果由 TravelKit 合并；
- UI 根据价格、时间窗、经停或本地时钟重写 Skill 结论；
- Agent Markdown 成为最终航班事实；
- `pricing` 或 `verify` 中间结果被当作正式可复制推荐。
