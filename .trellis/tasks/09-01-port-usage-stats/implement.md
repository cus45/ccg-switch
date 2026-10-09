# 执行计划：使用统计模块移植

分 9 个 Stage。**S1→S3 是采集链路，必须按序做完并验证通过再动前端** —— 前端做得再全，
采集不通就仍然是空页面（这正是当前的 bug）。每个 Stage 结束都是一个可回滚点。

S8（限额）与 S9（健康检查配置）在 S3 之后即可独立进行，与 S4–S7 无依赖，
但 S8 的超限标记 UI 依赖 S6 的 `ProviderStatsTable`。

源项目只读参照：`C:\guodevelop\demo\cc-switch`

---

## S1 数据层（后端）

- [ ] S1.1 `Cargo.toml` 加 `rust_decimal = "1"`、`async-stream = "0.3"`
- [ ] S1.2 `database/schema.rs::create_tables` 追加 `proxy_request_logs` 建表 + 5 个索引
      （字段见 design §2.1）
- [ ] S1.3 追加 `model_pricing` 建表
- [ ] S1.4 新增 `seed_model_pricing`（`INSERT OR IGNORE`），22 条定价从
      `cc-switch/src-tauri/src/database/schema.rs:920+` 原样搬；在 `create_tables` 末尾调用
- [ ] S1.5 新建 `database/dao/usage_logs.rs`：`insert_log`、`find_model_pricing_row`
      （模型名清洗：去 `/` 前缀 → 去 `:` 后缀 → `@`→`-` → 精确匹配，未命中 warn）
- [ ] S1.6 `dao/mod.rs` 注册新模块

**验证**：`cargo build`；删掉本地 DB 重启一次确认建表与 seed 生效；再启一次确认幂等不重复插入。

---

## S2 采集核心（后端，纯函数优先）

- [ ] S2.1 重写 `proxy/usage/parser.rs`：`TokenUsage` 结构 + 全部解析器
      （参照 `cc-switch/src-tauri/src/proxy/usage/parser.rs`，映射表见 design §3.2）
- [ ] S2.2 新增 `proxy/usage/parser_config.rs`：`UsageParserConfig` +
      `CLAUDE_/CODEX_/GEMINI_PARSER_CONFIG` + `AppType → &config` 的 match
- [ ] S2.3 重写 `proxy/usage/calculator.rs`：`Decimal` 版 `CostBreakdown` / `ModelPricing` /
      `CostCalculator::calculate`（计费口径见 design §3.3，**缓存扣减与倍率位置不能改**）
- [ ] S2.4 重写 `proxy/usage/logger.rs`：`RequestLog` 结构 + `UsageLogger::log_with_calculation`
      + `log_error`，写 `proxy_request_logs`
- [ ] S2.4b `UsageLogger::resolve_pricing_config`（R8.1）：倍率与计费来源的两级回落
      （provider.meta → app_configs 全局 → 硬默认）；`pricingModelSource == "request"` 时
      定价查表改用请求模型名（design §3.2b）
- [ ] S2.5 移除 JSONL 相关：`logger.rs` 旧实现、`services/usage_service.rs`、
      `models/usage.rs` 里仅 JSONL 用到的类型
- [ ] S2.6 补单测：calculator（缓存扣减 / 倍率只作用总价 / 未知模型返回 None /
      Decimal 精度）、parser（Claude 非流式 + Claude SSE + Gemini + Codex）、
      模型名清洗匹配、倍率解析链回落顺序（provider → 全局 → 1）

**验证**：`cargo test`，S2.6 全部用例通过。此阶段不接线，风险为零。

---

## S3 采集接线（后端，风险最高）

- [ ] S3.1 新建 `proxy/response_processor.rs`：`is_sse_response`、`UsageContext`、
      `SseUsageCollector`（`Arc<Inner>` + `AtomicBool` 幂等 finish）、
      `handle_non_streaming`、`handle_streaming`、`process_response`、`spawn_log_usage`
- [ ] S3.2 **先只接非流式**：`handlers.rs` 成功分支改调 `process_response`，
      内部流式分支暂时直接走原 `relay_response` 逻辑
- [ ] S3.3 验证非流式 → 通过后再启用 tee 流式分支（design §3.4）
- [ ] S3.4 失败分支接 `log_error`（故障转移用尽 / 非 2xx），满足 AC4
- [ ] S3.5 `proxy/mod.rs` 注册 `response_processor`

**验证（必须实机，逐条过）**：
1. `curl` 非流式 `/v1/messages`（`stream:false`）→ 查 `proxy_request_logs` 有行，
   token 与成本非零，`total_cost_usd` == 分项之和 × 倍率 → **AC2**
2. 真实 Claude Code 发起流式对话 → 逐字输出流畅、内容完整无截断 → **AC3 上半**
3. 上述流式请求结束后查表 → 新增行，`is_streaming=1`、`first_token_ms` 有值 → **AC3 下半**
4. 故意配错 API Key → 落 401 行且 `error_message` 有内容 → **AC4**
5. 定价表里删掉当前模型 → 请求正常返回，成本记 0，日志有 warn → **AC11**
6. provider.meta 手工塞 `costMultiplier = "2"` → 新请求 `cost_multiplier=2`、
   总价 = 分项之和 × 2、分项本身不含倍率 → **AC17**；清空后回落全局 / 硬默认 → **AC18**

任一条不过就停下修，不要进 S4。回滚点：`handlers.rs` 改回 `relay_response(resp)`。

---

## S4 查询与命令（后端）

- [ ] S4.1 重写 `services/usage_stats.rs`：7 个类型定义（design §4）
- [ ] S4.2 `dao/usage_logs.rs` 补聚合查询：`get_usage_summary`、`get_daily_trends`
      （分桶算法见 design §4，**空桶补零逻辑照搬**）、`get_provider_stats`、
      `get_model_stats`、`get_request_logs`（分页 + 6 种过滤）、`get_request_detail`
- [ ] S4.2b `maybe_backfill_log_costs`（R2.4）：在 `get_request_logs` 组装后逐行调用，
      带 provider / pricing 双缓存；口径与 `CostCalculator` 一致（design §4）
- [ ] S4.3 新建 `commands/usage.rs`：9 个 `#[tauri::command]`
- [ ] S4.4 `lib.rs` 的 `generate_handler!` 注册 9 个命令；移除失效的 `get_usage_summaries`
- [ ] S4.4b R8.2 的 4 个全局计费配置命令（`get`/`set_default_cost_multiplier`、
      `get`/`set_pricing_model_source`），存 `app_configs` 按 app_type 分键，一并注册
- [ ] S4.5 补单测：趋势分桶（24h → 24 桶 / 7d → 7 桶 / 空桶为 0）、
      日志过滤与分页、provider 被删后显示 Unknown、
      **backfill 与 `CostCalculator` 同输入等价断言**（防两处公式漂移）

**验证**：`cargo test`；用 S3 落的真实数据手工 invoke 各命令核对数字。

---

## S5 前端基础设施

- [ ] S5.1 `npm i recharts @tanstack/react-query`
- [ ] S5.2 `main.tsx` 包 `QueryClientProvider`
- [ ] S5.3 `types/usage.ts`（照搬 `cc-switch/src/types/usage.ts`，去掉
      `ProviderLimitStatus` / `StatsFilters`）
- [ ] S5.4 `services/usage.ts`：`usageApi` invoke 封装（去掉 limits / script 相关方法）
- [ ] S5.5 `hooks/query/usage.ts`：`usageKeys` + 8 个 hooks + 2 个 mutation
      （照搬 `cc-switch/src/lib/query/usage.ts`）
- [ ] S5.6 `components/usage/format.ts` 照搬

**验证**：`npx tsc --noEmit` 无错误。

---

## S6 前端组件

- [ ] S6.1 `UsageSummaryCards.tsx` —— 4 卡，后两张带分项；DaisyUI 皮肤，
      loading 用 `skeleton`，无数据显示 `--`
- [ ] S6.2 `UsageTrendChart.tsx` —— recharts AreaChart，双 Y 轴，4 Area + 成本虚线，
      自定义 Tooltip；**深色模式取色改用 DaisyUI 色值**（design §5.3）
- [ ] S6.3 `ProviderStatsTable.tsx`、`ModelStatsTable.tsx` —— DaisyUI table
- [ ] S6.4 `RequestLogTable.tsx` —— 过滤（app_type / provider / model / status
      / rolling+fixed 时间模式）+ 分页 + 行展开成本分项
- [ ] S6.5 `PricingConfigPanel.tsx` —— 定价列表 + 编辑弹窗 + 删除
- [ ] S6.6 i18n：`zh.json` / `en.json` 补齐全部 `usage.*` 键

**验证**：`npm run build`；页面手点过一遍 —— **AC6 / AC7 / AC8 / AC12**。

---

## S7 Dashboard 重构

- [ ] S7.1 Dashboard 顶部插入代理用量区（SummaryCards + TrendChart + 3 Tab），
      区块标题标注口径「代理用量 · 经内置代理的请求」
- [ ] S7.2 现有会话统计 JSX **整段移入** DaisyUI `collapse collapse-arrow`，
      标题标注「会话用量 · 来自 ~/.claude/projects」；辅助函数与 store 调用零改动
- [ ] S7.3 `ProxyUsageCard` 接 `get_usage_summary`，展示运行态 + 今日请求数/成本
- [ ] S7.4 `UsagePage` 改为复用新组件（与 Dashboard 共用，不重复实现）
- [ ] S7.5 i18n 补口径标注文案

**验证**：
- `npm run build` + `npm test`（现有 vitest 全绿）
- Dashboard 四卡数字 vs `sqlite3` 直查聚合结果一致 → **AC5**
- 折叠区逐项点过：启动次数 / 会话数 / 项目数 / 历史数 / 活跃度时钟图 / Token 饼图 /
  项目列表 → **AC9**
- 两处口径文案清晰 → **AC10**
- `git diff --stat src/pages/Dashboard.tsx` 复核会话统计部分是纯移动 → **AC9 交叉验证**

---

## S8 Provider 限额（R7）

依赖：S4（DAO）完成；S8.3 依赖 S6.3 的 `ProviderStatsTable`。

- [ ] S8.1 `dao/usage_logs.rs` 加 `check_provider_limits`：读 `providers.meta` 的
      `limitDailyUsd` / `limitMonthlyUsd`，按 `localtime` 聚合当日 / 当月成本
      （SQL 见 design §5.6）；未设限额时 `exceeded = false`
- [ ] S8.2 命令 `check_provider_limits` + 注册；前端 `useProviderLimits` hook
- [ ] S8.3 **UI 闭环**：provider 编辑表单加日/月限额输入（可空 = 不限）；
      `ProviderStatsTable` 超限行加 `badge-error` + `已用 / 限额` 文字
- [ ] S8.4 i18n 补限额相关文案

**验证**：设日限额 → 累计成本超过 → 表格出现标记且命令返回 `dailyExceeded: true` → **AC16**。
只验命令返回值不算通过 —— 必须看到 UI 上的标记，否则就是又搬了一份死代码。

---

## S9 流式健康检查配置（R6）

与 usage 采集链路无耦合，可独立进行。但它改的是**已在用**的健康检查路径，需谨慎。

- [ ] S9.1 `services/stream_check_service.rs` 加 `StreamCheckConfig` 结构 + `Default`
      （**默认值必须等于当前硬编码值**：`timeoutSecs = 30`，见 design §5.5）
- [ ] S9.2 DAO 读写：`app_configs` 单键 `"stream_check_config"` 存 JSON；读不到返回 `Default`
- [ ] S9.3 命令 `get_stream_check_config` / `save_stream_check_config` + 注册
- [ ] S9.4 **接线（这项的重点）**：`check_stream` 加 `config` 参数替换硬编码 30s；
      `max_retries` 在 `check_provider_health` 外层做重试；`degraded_threshold_ms` 决定
      `operational` / `degraded`；三个模型名与 `test_prompt` 替换 `build_request` 硬编码
- [ ] S9.5 同步改两个现有调用方签名：`provider_commands::check_provider_health`、
      `utility_commands::check_stream_connectivity`（内部读配置，前端契约不变）
- [ ] S9.6 前端 `ModelTestConfigPanel.tsx`（DaisyUI），数字输入用字符串态承载以允许清空；
      挂 Settings 页 + i18n

**验证**：
- `timeoutSecs` 改 3 秒 → 对慢供应商跑健康检查，3 秒即超时 → **AC14**
  （只存不用是这项最容易犯的错，必须验到超时真的变了）
- `degradedThresholdMs` 改小 → 正常供应商被判 `degraded` → **AC15**
- **不配置任何值** → 健康检查行为与改动前完全一致（回归验证）

---

## 全局验证命令

```bash
cd src-tauri && cargo build && cargo test    # 后端
cd .. && npx tsc --noEmit && npm run build   # 前端类型 + 构建
npm test                                     # 现有 vitest 不回归
```

## 回滚点

| Stage | 回滚方式 | 影响面 |
|---|---|---|
| S1 | 建表是 IF NOT EXISTS，留空表无副作用 | 无 |
| S2 | 新代码无调用方，`git revert` 即可 | 无 |
| S3 | `handlers.rs` 改回 `relay_response(resp)` 一行 | 代理功能不受影响 |
| S4 | 命令从 `generate_handler!` 摘掉 | 前端报 invoke 失败 |
| S5-S6 | 路由摘掉 usage 组件 | 页面回到旧 UsagePage |
| S7 | `git checkout src/pages/Dashboard.tsx` | Dashboard 回旧版 |
| S8 | 命令摘掉 + 表单字段隐藏 | 限额不生效，其余无影响 |
| S9 | 配置默认值 = 原硬编码值，不保存配置即等价于改动前 | 健康检查行为不变 |

## 记录约定

- S3 的实机验证结果（尤其流式是否卡顿）写进 journal —— 这是本任务唯一无法靠单测覆盖的风险点。
- 深色模式取色方案定下来后补进 `.trellis/spec/frontend/`，后续图表组件复用。
- S9 改动前先记下当前硬编码值（30s / 10s / 模型名 / prompt），作为默认值的依据与回归基线。
- 「移植的命令必须有 UI 消费」这条约束（S8.3 / R7.3）写进 `.trellis/spec/` ——
  本任务的起因就是采集链路无调用方，同类错误不该再犯第二次。
