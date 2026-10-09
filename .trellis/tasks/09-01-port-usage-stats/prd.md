# 移植 cc-switch 使用统计模块并重构仪表盘

## Goal

把 `C:\guodevelop\demo\cc-switch` 的完整「使用统计」模块原样移植进 ccg-switch，让代理请求的
token / 成本 / 延迟 / 状态码在应用内可见可查；并按 cc-switch 的信息层级思路整体重构 Dashboard。

## Background

### 现状缺陷（已在源码中核实）

1. **采集链路是死代码。** `src-tauri/src/proxy/usage/{logger,parser,calculator}.rs` 全部标注
   `#![allow(dead_code)]`，全仓搜索 `init_logger` / `log_event` 仅命中定义处，无任何调用方。
2. **因此 UsagePage 恒空。** `proxy/handlers.rs:287` 的 `relay_response` 直接
   `Body::from_stream(upstream.bytes_stream())` 纯透传，不解析响应体、不落任何记录。
   `usage_service.rs` 读 `~/.ccg-switch/proxy/logs/YYYY-MM-DD.jsonl`，该文件永不被写入。
3. **能力深度差距。** ccg 现有 usage 只有 `{requests, inputTokens, outputTokens, costUsd}` 四个字段，
   无缓存 token、无请求级明细、无成功率、无延迟、无定价配置、成本用 f64 且定价表硬编码 10 个前缀。

### 参照实现规模

| 层 | cc-switch | ccg-switch 现状 |
|---|---|---|
| 采集 | `proxy/usage/` 1498 行（parser 881 行，覆盖 Claude/OpenAI/Codex/Gemini × 流式/非流式） | 202 行死代码 |
| 存储 | SQLite `proxy_request_logs` + `model_pricing`（5 索引，22 条预置定价） | JSONL 文件（无写入方） |
| 查询 | `services/usage_stats.rs` 984 行 | `usage_service.rs` 122 行 |
| 命令 | `commands/usage.rs` 9 个命令 | 1 个命令 |
| UI | 10 个组件 2690 行 | 4 个文件 362 行 |

## Decisions（已与用户确认）

| # | 议题 | 决策 |
|---|---|---|
| D1 | UI 栈 | 引入 `recharts` + `@tanstack/react-query`。趋势图与 30s 轮询保真；shadcn/ui → DaisyUI 皮肤替换；framer-motion 不引入，用 CSS transition 替代 |
| D2 | 统计口径 | 两条源并存、分开展示。代理用量走新建 SQLite 表；会话用量保留现有 `~/.claude/projects` 解析。UI 明确标注口径，不合并 |
| D3 | 重构深度 | Dashboard 按 cc-switch 思路整体重构：顶部四张核心指标卡 → 趋势图 → Tab（请求日志 / Provider / 模型）→ 现有会话统计下沉为折叠次级区块 |
| D4 | 移植范围 | 原先判为 Non-Goal 的 4 项加回（见 R6/R7/R8 与下方核实结论）。`usage_script` 经核实 ccg 已端到端具备，确认无需移植 |

### D4 前提核实结论

| 项 | ccg 侧现状 | 结论 |
|---|---|---|
| `ModelTestConfigPanel` | `stream_check_service.rs` 有 `check_stream` / `check_provider_health`，但超时 30s / 10s **硬编码**，无配置结构、无持久化、无命令 | 真实能力缺口，移植（R6）。需自建后端配置层 |
| `check_provider_limits` | `providers.meta` 列存在，`ProviderMeta` 是 `HashMap<String,String>`，`limitDailyUsd` / `limitMonthlyUsd` 可直接落键 | 移植（R7）。但 cc-switch 侧 `useProviderLimits` 无任何组件消费 —— 必须同时补 UI，否则又是死代码 |
| `usage_script` | 后端 `usage_query_service.rs` + 命令 `query_provider_usage` / `test_usage_script` 已注册，前端 `UsageFooter.tsx` + `UsageScriptModal.tsx` 已存在 | **已完整具备，不移植**（重复移植会产生两套实现） |
| `maybe_backfill_log_costs` | 无 | 移植（R2.4） |

### D4 附带发现：计费配置链条缺失

写 design 时核实 `resolve_pricing_config` 才发现 —— cc-switch 的 `cost_multiplier` 不是常量，
它有一条完整解析链：`provider.meta.costMultiplier` → 全局 `app_config` 默认值 → `"1"`；
另有 `pricingModelSource`（`"response" | "request"`）决定定价查表用响应模型名还是请求模型名。
cc-switch 在 `ProviderAdvancedConfig.tsx` 有对应 UI。

不移植这条链，`proxy_request_logs.cost_multiplier` 就只能恒为 `1.0`，calculator 里的倍率参数
形同虚设。故一并移植（R8）。

## Requirements

### R1 采集链路（后端，必须先通）

- R1.1 新建 `proxy_request_logs` 表，字段与 cc-switch 对齐：请求标识、provider、app_type、
  model / request_model、四类 token（input / output / cache_read / cache_creation）、
  五项成本（四项分项 + total，TEXT 存高精度十进制）、`latency_ms`、`first_token_ms`、
  `duration_ms`、`status_code`、`error_message`、`session_id`、`is_streaming`、
  `cost_multiplier`、`created_at`。建 provider / created_at / model / status 索引。
- R1.2 新建 `model_pricing` 表并预置定价（Claude 4.6/4.5/4/3.x 全系 + GPT + Gemini），
  首次启动 seed，已存在则不覆盖用户改动。
- R1.3 移植 `parser.rs` 全部解析器：Claude 非流式 / Claude SSE 事件流 / OpenAI / Codex /
  Gemini，含 Codex 的 `_adjusted` 与 `_auto` 变体。
- R1.4 移植 `calculator.rs`：改用 `rust_decimal` 做定点计算。计费口径按 cc-switch —— input 侧
  按 `input_tokens - cache_read_tokens` 计费避免缓存部分重复计价，倍率只作用于最终总价。
- R1.5 改造 `relay_response`：SSE 响应改为 tee 流（边转发边按 `\n\n` 切帧解析 `data:` JSON，
  流结束后异步落库）；非流式响应读全 body 后解析。**透传语义与延迟不得退化**，
  日志失败只 warn 不影响响应。
- R1.6 模型名清洗后匹配定价：去 `/` 前缀、去 `:` 后缀、`@` → `-`；未命中记 0 成本并 warn。

### R2 查询与命令（后端）

- R2.1 移植 9 个命令：`get_usage_summary`、`get_usage_trends`、`get_provider_stats`、
  `get_model_stats`、`get_request_logs`、`get_request_detail`、`get_model_pricing`、
  `update_model_pricing`、`delete_model_pricing`。
- R2.2 趋势查询保留滑动窗口分桶：窗口 ≤24h 按小时（固定 24 桶），>24h 按天；空桶补零，
  保证图表 X 轴连续。
- R2.3 请求日志分页 + 过滤（app_type / provider 模糊 / model 模糊 / status_code / 时间范围），
  provider 名通过 LEFT JOIN `providers` 带出。
- R2.4 移植 `maybe_backfill_log_costs`：查询请求日志时，若某行有 token 但成本为 0
  （落库时定价缺失），按当前定价表补算并 `UPDATE` 回写。计算口径必须与 `CostCalculator` 完全一致
  （含缓存扣减、倍率只作用总价）。带 provider / pricing 双缓存避免逐行重复查表。

### R3 前端

- R3.1 类型与 API 层：`types/usage.ts`、`services/usage.ts`（invoke 封装）、
  `hooks/query/usage.ts`（react-query hooks + queryKeys）。
- R3.2 组件移植为 DaisyUI 皮肤：`UsageSummaryCards`（4 卡：请求数 / 成本 / Tokens / 缓存，
  后两张带 input-output、write-read 分项）、`UsageTrendChart`（recharts AreaChart，双 Y 轴，
  4 条 token Area + 成本虚线，自定义 Tooltip）、`RequestLogTable`（过滤 + 分页 + 行展开详情）、
  `ProviderStatsTable`、`ModelStatsTable`、`PricingConfigPanel`（定价增删改）。
- R3.3 刷新间隔可切换：`0 / 5 / 10 / 30 / 60` 秒，`0` 表示关闭轮询；后台不轮询。
- R3.4 金额与数字格式化统一走 `format.ts`（`parseFiniteNumber` / `fmtUsd` / `fmtInt`），
  无数据显示 `--` 而非 `$0.00`。

### R4 Dashboard 重构（D3）

- R4.1 顶部：代理用量四张核心指标卡（口径标注「代理用量」）。
- R4.2 中部：用量趋势图。
- R4.3 下部：Tab 切换请求日志 / Provider 统计 / 模型统计。
- R4.4 现有会话统计（启动次数、会话数、项目数、历史数、活跃度时钟图、Token 饼图、项目列表）
  下沉为折叠次级区块，口径标注「会话用量（来自 ~/.claude/projects）」。**功能不删。**
- R4.5 `ProxyUsageCard` 升级：接真实用量数据，不再只显示 requestCount。

### R5 迁移与兼容

- R5.1 删除死代码 `proxy/usage/logger.rs` 的 JSONL 实现与 `usage_service.rs` 的 JSONL 读取路径；
  `get_usage_summaries` 命令改为读 SQLite 或移除（该命令当前恒返回空，无真实调用价值）。
- R5.2 i18n `zh.json` / `en.json` 同步补齐全部新增文案。
- R5.3 DB 变更走 `CREATE TABLE IF NOT EXISTS` + 幂等 seed，老库升级不丢数据。

### R6 流式健康检查配置（ModelTestConfigPanel）

- R6.1 后端新增 `StreamCheckConfig`：`timeoutSecs` / `maxRetries` / `degradedThresholdMs` /
  `claudeModel` / `codexModel` / `geminiModel` / `testPrompt`，带 `Default` 实现。
- R6.2 持久化到现有 `app_configs` 表（复用 `get_app_config` / `set_app_config`，JSON 字符串存单键）。
- R6.3 新增命令 `get_stream_check_config` / `save_stream_check_config`。
- R6.4 **把配置接进现有 `check_stream` / `check_provider_health`** —— 当前 30s / 10s 是硬编码，
  接完才算真正生效。`maxRetries` 控制重试次数，`degradedThresholdMs` 决定
  `operational` / `degraded` 判定，`testPrompt` 与三个模型名替换现有硬编码值。
- R6.5 前端 `ModelTestConfigPanel` 组件（DaisyUI 皮肤），数字输入框允许清空（用字符串态承载）。
  挂到 Settings 页。

### R7 Provider 限额（check_provider_limits）

- R7.1 移植 `check_provider_limits`：读 `providers.meta` 的 `limitDailyUsd` / `limitMonthlyUsd`，
  按 `localtime` 聚合当日 / 当月成本，返回 `ProviderLimitStatus`（用量 / 限额 / 是否超限）。
- R7.2 注册命令 + 前端 `useProviderLimits` hook。
- R7.3 **补 UI（cc-switch 缺这块）**：provider 编辑表单加日限额 / 月限额输入；
  Provider 统计表对超限行加视觉标记（超限徽标 + 用量/限额文字）。
  没有 R7.3 这一项就是移植死代码 —— 与本任务修的 bug 同类，必须做。

### R8 计费配置链条（cost_multiplier / pricingModelSource）

- R8.1 移植 `resolve_pricing_config`：`provider.meta.costMultiplier` → 全局默认 → `"1"`；
  `provider.meta.pricingModelSource` → 全局默认 → `"response"`。非法值 warn 后回退默认。
- R8.2 全局默认值存 `app_configs`，按 app_type 分键；新增 4 个命令
  （`get`/`set_default_cost_multiplier`、`get`/`set_pricing_model_source`）。
- R8.3 `pricingModelSource == "request"` 时定价查表用请求模型名，否则用响应模型名。
- R8.4 前端：provider 编辑表单加「成本倍率」输入 + 「计费模型来源」选择；
  全局默认值放 Settings。

## Non-Goals

- **不移植 `usage_script`（供应商余额查询脚本）** —— 经核实 ccg 已端到端具备：
  后端 `usage_query_service.rs`、命令 `query_provider_usage` / `test_usage_script`、
  前端 `UsageFooter.tsx` / `UsageScriptModal.tsx`。重复移植会产生两套实现。
- 不做历史数据回填：统计从本次上线后的请求开始（R2.4 的 backfill 只补成本，不造 token 记录）。
- 不合并两条统计口径为单一数字。
- 不移植 cc-switch 的 `StreamingTimeoutConfig`（代理流式总超时）—— ccg 流式本就不设总超时，
  与 R6 的健康检查超时是两回事，不要混淆。

## Acceptance Criteria

- [ ] AC1 `cargo build` 与 `cargo test` 全绿；`npm run build`（tsc + vite）无错误。
- [ ] AC2 启动代理后发一次**非流式** Claude 请求，`proxy_request_logs` 新增一行，
      四类 token 与五项成本非零且 `total_cost_usd` 等于分项之和 × 倍率。
- [ ] AC3 发一次**流式** Claude 请求，客户端正常收到完整 SSE 流（透传无退化），
      流结束后新增一行且 `is_streaming=1`、`first_token_ms` 有值。
- [ ] AC4 上游返回非 2xx 时也落一行，`status_code` 与 `error_message` 正确。
- [ ] AC5 Dashboard 四张指标卡数字与 `proxy_request_logs` 聚合结果一致。
- [ ] AC6 趋势图：切「今天」出 24 个小时桶，切「7 天 / 30 天」出对应天数桶，无请求的桶显示为 0。
- [ ] AC7 请求日志表：过滤（app_type / provider / model / status）与分页均生效，行可展开看成本分项。
- [ ] AC8 定价面板可改某模型单价，改后新请求按新价计费；删除后该模型成本记 0 并有 warn 日志。
- [ ] AC9 Dashboard 折叠区里原有会话统计功能全部可用，无回归。
- [ ] AC10 两处口径在 UI 上有明确文字标注，不会被误读为同一数字。
- [ ] AC11 定价表未命中的模型不阻断请求，成本记 0。
- [ ] AC12 关闭轮询（间隔选 `0`）后无周期性 invoke。
- [ ] AC13 (R2.4) 手工把某行 `total_cost_usd` 改 0 且保留 token，再查请求日志 →
      该行成本被补算回来且已回写 DB，数值与 `CostCalculator` 口径一致。
- [ ] AC14 (R6) 改 `timeoutSecs` 为 3 秒并保存，对一个慢供应商跑健康检查 →
      3 秒即超时（证明配置真的接进了 `check_stream`，而非只存不用）。
- [ ] AC15 (R6) `degradedThresholdMs` 改小后，正常供应商被判为 `degraded`。
- [ ] AC16 (R7) 给某 provider 设日限额，累计成本超过后 → Provider 统计表该行出现超限标记，
      `check_provider_limits` 返回 `dailyExceeded: true`。
- [ ] AC17 (R8) provider 设 `costMultiplier = 2`，发一次请求 →
      该行 `cost_multiplier = 2`，`total_cost_usd` = 分项之和 × 2，且分项本身不含倍率。
- [ ] AC18 (R8) 清空 provider 倍率后回落到全局默认值；全局也没设时为 `1`。
- [ ] AC19 (R8) `pricingModelSource` 切 `request` 后，定价按请求模型名查表
      （用一个「请求模型有定价、响应模型无定价」的组合验证成本非 0）。

## Risks

| 风险 | 影响 | 缓解 |
|---|---|---|
| SSE tee 实现不当导致流式对话卡顿或截断 | 高 —— 直接坏主功能 | tee 只做「切帧 + push 到收集器」，落库全部 `tokio::spawn` 异步；先跑通非流式再改流式；改动后必须实测流式对话 |
| `rust_decimal` 为新增依赖 | 中 | 仅后端；成本字段以 TEXT 存储，避免 f64 累计误差 |
| Dashboard 730 行整体重构引入回归 | 中 | 会话统计区块整段移动、不改内部实现；重构前后逐项核对 R4.4 清单 |
| react-query 与 Zustand 两套数据层并存 | 低 | 边界固定：仅 usage 相关查询用 react-query，其余一律 Zustand |
| R6 要改**已在用**的 `check_stream` / `check_provider_health` | 中 —— 会影响现有供应商健康检查 | 配置全部带默认值，默认值与当前硬编码值一致（30s/10s），未配置时行为不变；改完实测一次健康检查 |
| R7/R8 要改 provider 编辑表单（已在用的表单） | 中 | 新字段全部可选，读取时缺键即回落默认；不动表单现有字段的读写路径 |
| R2.4 backfill 让读路径产生写副作用 | 低 | 仅在「有 token 且成本为 0」时触发，命中后即回写不再重复；失败只 warn 不影响查询返回 |

## Notes

- 源项目路径：`C:\guodevelop\demo\cc-switch`（只读参照，不修改）。
- ccg 已有 `rusqlite 0.31` + `Database`（`src-tauri/src/database/`），schema 集中在 `schema.rs::create_tables`，
  DAO 按表分文件在 `database/dao/`，新表按此约定落位。
