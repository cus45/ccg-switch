# 技术设计：使用统计模块移植

## 1. 架构总览

```
Claude Code / Codex / Gemini
        │  HTTP
        ▼
proxy/handlers.rs  proxy_handler
        │
        ├─ 已有：detect_app_type → resolve_candidates → 故障转移 → forward_request
        │
        └─ 【新】response_processor::process_response(resp, ctx, db)
                 │
                 ├─ is_sse_response? ──yes──► handle_streaming
                 │                              tee 流：转发字节 ⊕ 切帧解析 SSE
                 │                              流末 SseUsageCollector::finish()
                 │                                   └─ tokio::spawn ─┐
                 └─ no ──► handle_non_streaming                       │
                              读全 body → parser → spawn ─────────────┤
                                                                      ▼
                                                        proxy/usage/logger.rs
                                                        UsageLogger::log_with_calculation
                                                          ├─ find_model_pricing_row (model_pricing)
                                                          ├─ CostCalculator::calculate (rust_decimal)
                                                          └─ INSERT proxy_request_logs
                                                                      │
                                              services/usage_stats.rs  │ 聚合查询
                                                                      ▼
                                              commands/usage.rs (9 命令)
                                                                      │ invoke
                                                                      ▼
                                    hooks/query/usage.ts (react-query, 30s 轮询)
                                                                      ▼
                                    Dashboard / components/usage/*
```

关键约束：**采集必须旁路。** 转发路径上只做「切帧 + 内存累积」，所有 DB 写入在
`tokio::spawn` 里做，日志失败仅 `tracing::warn!`，绝不影响响应。

## 2. 数据层

### 2.1 `proxy_request_logs`

落位 `src-tauri/src/database/schema.rs::create_tables`（`CREATE TABLE IF NOT EXISTS`）。

```sql
CREATE TABLE IF NOT EXISTS proxy_request_logs (
    request_id TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL,
    app_type TEXT NOT NULL,
    model TEXT NOT NULL,
    request_model TEXT,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens INTEGER NOT NULL DEFAULT 0,
    cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
    input_cost_usd TEXT NOT NULL DEFAULT '0',
    output_cost_usd TEXT NOT NULL DEFAULT '0',
    cache_read_cost_usd TEXT NOT NULL DEFAULT '0',
    cache_creation_cost_usd TEXT NOT NULL DEFAULT '0',
    total_cost_usd TEXT NOT NULL DEFAULT '0',
    latency_ms INTEGER NOT NULL,
    first_token_ms INTEGER,
    duration_ms INTEGER,
    status_code INTEGER NOT NULL,
    error_message TEXT,
    session_id TEXT,
    provider_type TEXT,
    is_streaming INTEGER NOT NULL DEFAULT 0,
    cost_multiplier TEXT NOT NULL DEFAULT '1.0',
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_request_logs_provider   ON proxy_request_logs(provider_id, app_type);
CREATE INDEX IF NOT EXISTS idx_request_logs_created_at ON proxy_request_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_request_logs_model      ON proxy_request_logs(model);
CREATE INDEX IF NOT EXISTS idx_request_logs_session    ON proxy_request_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_request_logs_status     ON proxy_request_logs(status_code);
```

**为什么成本用 TEXT：** `rust_decimal::Decimal` 的字符串表示能无损往返，
避免 `f64` 在长期累加下的精度漂移。聚合时才 `CAST(... AS REAL)`。

### 2.2 `model_pricing`

```sql
CREATE TABLE IF NOT EXISTS model_pricing (
    model_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    input_cost_per_million TEXT NOT NULL DEFAULT '0',
    output_cost_per_million TEXT NOT NULL DEFAULT '0',
    cache_read_cost_per_million TEXT NOT NULL DEFAULT '0',
    cache_creation_cost_per_million TEXT NOT NULL DEFAULT '0'
);
```

Seed 用 `INSERT OR IGNORE`（幂等，不覆盖用户编辑）。数据从 cc-switch
`schema.rs::seed_model_pricing` 原样搬（Claude 4.6/4.5/4/3.7/3.5 + GPT-5.x + Gemini，22 条）。

### 2.3 DAO 落位

ccg 约定 DAO 按表分文件。新增 `database/dao/usage_logs.rs`：写入 + 分页查询 + 聚合。
cc-switch 把聚合查询用 `impl Database` 挂在 `services/usage_stats.rs`；ccg 遵循自身约定，
**SQL 全部收在 DAO，`services/usage_stats.rs` 只做类型定义与调用编排。**

## 3. 采集层

### 3.1 模块结构

```
src-tauri/src/proxy/
├── usage/
│   ├── mod.rs
│   ├── parser.rs       ← 重写（原 62 行 → ~500 行，移植 cc-switch 881 行的解析器部分）
│   ├── calculator.rs   ← 重写（f64 → rust_decimal）
│   └── logger.rs       ← 重写（JSONL → SQLite）
└── response_processor.rs  ← 新建
```

### 3.2 `parser.rs`

```rust
#[derive(Debug, Clone, Default)]
pub struct TokenUsage {
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub cache_read_tokens: u32,
    pub cache_creation_tokens: u32,
    pub model: Option<String>,   // 响应里自带的真实模型名，优先于请求模型
}
```

移植的解析器（与源项目同名，便于对照）：

| 方法 | 输入形态 |
|---|---|
| `from_claude_response` | 非流式 `{usage:{input_tokens,output_tokens,cache_read_input_tokens,cache_creation_input_tokens}}` |
| `from_claude_stream_events` | SSE：`message_start` 拿 input/cache，`message_delta` 累积 output |
| `from_openrouter_response` / `from_openai_response` | `{usage:{prompt_tokens,completion_tokens}}` |
| `from_openai_stream_events` | SSE 末帧 usage |
| `from_codex_response` / `_adjusted` / `_auto` | Codex `response.usage`，`_adjusted` 处理 cached_tokens 是否已含在 input 内的差异 |
| `from_codex_stream_events` / `_auto` | Codex SSE |
| `from_gemini_response` / `from_gemini_stream_chunks` | `usageMetadata.{promptTokenCount,candidatesTokenCount,cachedContentTokenCount}` |

**parser 配置表**（对齐 cc-switch `handler_config.rs`，按 app_type 选解析器）：

```rust
pub struct UsageParserConfig {
    pub app_type_str: &'static str,
    pub stream_parser:   fn(&[Value]) -> Option<TokenUsage>,
    pub response_parser: fn(&Value)   -> Option<TokenUsage>,
    pub model_extractor: fn(&[Value], &str) -> String,
}
pub const CLAUDE_PARSER_CONFIG: UsageParserConfig = ...;
pub const CODEX_PARSER_CONFIG:  UsageParserConfig = ...;
pub const GEMINI_PARSER_CONFIG: UsageParserConfig = ...;
```

`AppType → &'static UsageParserConfig` 一个 match 即可，无需 trait 对象。

### 3.2b 计费配置解析（R8）

`cost_multiplier` 不是常量，落库前要解析一条链：

```rust
// logger.rs
pub async fn resolve_pricing_config(&self, provider_id: &str, app_type: &str)
    -> (Decimal, String)   // (倍率, 定价模型来源)
```

```
倍率:  provider.meta["costMultiplier"] → app_configs["default_cost_multiplier:{app_type}"] → "1"
来源:  provider.meta["pricingModelSource"] → app_configs["pricing_model_source:{app_type}"] → "response"
       合法值仅 "response" | "request"，非法值 warn 后回落
```

`pricing_model_source` 决定定价查表用哪个模型名：

```rust
let pricing_model = if source == "request" { request_model } else { model };
```

存储：ccg 的 `ProviderMeta` 是 `Option<HashMap<String, String>>`（扁平字符串映射），
`costMultiplier` / `pricingModelSource` / `limitDailyUsd` / `limitMonthlyUsd` 全部作为字符串键直接落，
**无需改 provider 模型结构**。全局默认值复用现有 `get_app_config` / `set_app_config`。

倍率为字符串而非 f64：与成本字段同理，`Decimal::from_str` 无损。

### 3.3 `calculator.rs`

```rust
pub fn calculate(usage: &TokenUsage, pricing: &ModelPricing, multiplier: Decimal) -> CostBreakdown
```

计费口径（与 cc-switch 完全一致，是**语义要点不是实现细节**）：

```
billable_input   = input_tokens.saturating_sub(cache_read_tokens)
input_cost       = billable_input        × input_price        / 1e6
output_cost      = output_tokens         × output_price       / 1e6
cache_read_cost  = cache_read_tokens     × cache_read_price   / 1e6
cache_creat_cost = cache_creation_tokens × cache_creat_price  / 1e6
total = (四项之和) × multiplier          ← 倍率只作用于总价，分项存基础价
```

`input_tokens` 减去 `cache_read_tokens` 是因为 Anthropic 的 `input_tokens` 已包含缓存命中部分，
不减会双重计费。

### 3.4 `response_processor.rs`（核心改造）

```rust
pub fn is_sse_response(resp: &reqwest::Response) -> bool  // content-type 含 text/event-stream

pub async fn process_response(
    resp: reqwest::Response,
    ctx: &UsageContext,      // provider_id / app_type / request_model / start_time / session_id
    db: Arc<Database>,
) -> Result<Response, ProxyError>
```

**非流式**：`resp.bytes().await` → `serde_json::from_slice` → `response_parser` →
`spawn_log_usage` → `Body::from(bytes)` 返回。

**流式（tee）**：

```rust
async_stream::stream! {
    let mut buffer = String::new();
    tokio::pin!(stream);
    while let Some(chunk) = stream.next().await {
        match chunk {
            Ok(bytes) => {
                buffer.push_str(&String::from_utf8_lossy(&bytes));
                while let Some(pos) = buffer.find("\n\n") {
                    let event = buffer[..pos].to_string();
                    buffer = buffer[pos + 2..].to_string();
                    for line in event.lines() {
                        if let Some(data) = line.strip_prefix("data: ") {
                            if data.trim() != "[DONE]" {
                                if let Ok(v) = serde_json::from_str::<Value>(data) {
                                    collector.push(v).await;   // 仅内存累积
                                }
                            }
                        }
                    }
                }
                yield Ok(bytes);        // ← 原样转发，字节不变
            }
            Err(e) => { yield Err(...); break; }
        }
    }
    collector.finish().await;           // 触发回调 → tokio::spawn 落库
}
```

设计要点：
- **yield 的是原始 `bytes`**，不是重新序列化的结果 —— 保证透传字节级一致。
- 解析用一个 `String` buffer 按 `\n\n` 切帧，处理跨 chunk 的半帧。
- `SseUsageCollector` 用 `Arc<Inner>` + `AtomicBool finished` 保证 `finish()` 幂等
  （流正常结束与客户端断开都会走到）。
- `first_token_ms` = 首个 SSE 事件时间 − 请求起始时间。
- 不移植 cc-switch 的 `StreamingTimeoutConfig`（ccg 无对应配置项，流式本就不设总超时），
  保持现状。

### 3.5 `handlers.rs` 接入点

现状 `handlers.rs:164-176`：

```rust
if status.is_success() || is_last {
    server::increment_request_count();
    return relay_response(resp);          // ← 纯透传
}
```

改为：

```rust
if status.is_success() || is_last {
    server::increment_request_count();
    let ctx = UsageContext { provider_id: provider.id.clone(), app_type,
                             request_model, start_time, session_id };
    return response_processor::process_response(resp, &ctx, db.clone()).await;
}
```

失败分支（故障转移用尽、非 2xx）额外调 `UsageLogger::log_error` 落错误行，满足 AC4。
`relay_response` 保留给不需要采集的路径（如非 JSON 请求）。

## 4. 查询层

`services/usage_stats.rs` 类型（`#[serde(rename_all = "camelCase")]`）：
`UsageSummary` / `DailyStats` / `ProviderStats` / `ModelStats` / `LogFilters` /
`PaginatedLogs` / `RequestLogDetail`，字段与 cc-switch 一致（前端类型直接复用）。

**趋势分桶算法**（原样移植，是保证图表 X 轴连续的关键）：

```
end_ts   = end_date  ?? now
start_ts = start_date ?? end_ts - 86400        // start >= end 时兜底回退 24h
duration = end_ts - start_ts
bucket_seconds = duration <= 86400 ? 3600 : 86400
bucket_count   = ceil(duration / bucket_seconds)
if bucket_seconds == 3600 { bucket_count = 24 } // 固定 24 桶，规避浮点误差
SQL: GROUP BY CAST((created_at - start_ts) / bucket_seconds AS INTEGER)
然后 0..bucket_count 遍历补零，date 用 RFC3339
```

其余聚合 SQL 见 PRD R2；`get_provider_stats` / `get_request_logs`
用 `LEFT JOIN providers p ON l.provider_id = p.id AND l.app_type = p.app_type` 带出 provider 名
（provider 被删后为 NULL → 显示 `Unknown`，不丢历史记录）。

**`maybe_backfill_log_costs`（R2.4）**：在 `get_request_logs` 逐行组装后调用。

```
触发条件: total_cost_usd == 0 且 (input|output|cache_read|cache_creation) 任一 > 0
          → 即「落库时定价缺失」的行
命中后:   按当前定价表 + 当前倍率重算五项 → 改写内存中的 log → UPDATE 回写 DB
缓存:     provider_cache: HashMap<(provider_id, app_type), Decimal>
          pricing_cache:  HashMap<model, PricingInfo>
          → 一页 20 行不会重复查 20 次定价表
```

计算口径必须与 `CostCalculator::calculate` 逐字一致（缓存扣减 + 倍率只作用总价）。
这是**两处实现同一公式**的地方，是最容易长期漂移的隐患 —— 单测要对两条路径做同输入等价断言。

回写失败只 warn，不影响查询返回。

## 5. 前端

### 5.1 分层

```
src/types/usage.ts              类型（对齐后端 camelCase）
src/services/usage.ts           invoke 封装（usageApi 对象）
src/hooks/query/usage.ts        react-query hooks + usageKeys
src/components/usage/
  ├── format.ts                 parseFiniteNumber / fmtUsd / fmtInt / getLocaleFromLanguage
  ├── UsageSummaryCards.tsx
  ├── UsageTrendChart.tsx       recharts
  ├── RequestLogTable.tsx
  ├── ProviderStatsTable.tsx    含 R7 超限标记
  ├── ModelStatsTable.tsx
  ├── PricingConfigPanel.tsx
  └── ModelTestConfigPanel.tsx  R6，挂 Settings
```

R7/R8 的 provider 级字段（限额、倍率、计费来源）落在现有 provider 编辑表单里，
不新建组件 —— 那是 provider 的配置，不是 usage 的组件。

`main.tsx` 需包一层 `QueryClientProvider`。

### 5.2 组件映射（shadcn → DaisyUI）

| cc-switch | ccg 替代 |
|---|---|
| `Tabs/TabsList/TabsTrigger` | DaisyUI `tabs tabs-boxed` |
| `Card/CardContent` | 项目卡片规范 `bg-white dark:bg-base-100 rounded-xl shadow-sm border` |
| `Table/*` | DaisyUI `table` |
| `Select/*` | DaisyUI `select select-sm` |
| `Accordion/*` | DaisyUI `collapse collapse-arrow` |
| `Button` | DaisyUI `btn` |
| `framer-motion` `motion.div` | CSS `transition-all` + `animate-*`（不引 framer-motion） |
| `sonner` toast | 项目现有提示方式 |

### 5.3 趋势图

recharts `AreaChart`，双 Y 轴：左轴 tokens（`k` 单位），右轴成本（`$`）。
4 条 Area：input `#3b82f6` / output `#22c55e` / cacheCreation `#f97316` / cacheRead `#a855f7`，
各带 `linearGradient` 渐变填充；成本用 `#f43f5e` 虚线（`strokeDasharray="4 4"`，`fill="none"`）。
X 轴标签：`days===1` 显示「月-日 时:分」，否则「月-日」。自定义 Tooltip 按 `dataKey === "cost"`
选 `fmtUsd(v, 6)` 或 `fmtInt(v)`。

**深色模式**：cc-switch 用 `hsl(var(--border))` 这类 shadcn CSS 变量，ccg 无这些变量。
改用 DaisyUI 的 `--fallback-bc` / 具体 Tailwind 色值，或读 `document.documentElement`
的主题态传色。这是移植中唯一需要重新决定取色来源的地方。

### 5.4 react-query 边界

仅 usage 用 react-query，其余保持 Zustand。`usageKeys` 命名空间 `["usage", ...]`，
mutation（改/删定价）成功后 `invalidateQueries({queryKey: usageKeys.pricing()})`。
轮询：`refetchInterval: interval > 0 ? interval : false`，
`refetchIntervalInBackground: false`（满足 AC12）。

## 5.5 流式健康检查配置（R6）

ccg 现状：`stream_check_service.rs` 里 `Client::builder().timeout(Duration::from_secs(30))`
与首包等待 10s 全是硬编码，测试 prompt 与模型名同样硬编码在 `build_request` 里。

```rust
// services/stream_check_service.rs
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StreamCheckConfig {
    pub timeout_secs: u64,            // 默认 30 —— 与当前硬编码一致
    pub max_retries: u32,             // 默认 2
    pub degraded_threshold_ms: u64,   // 默认 6000
    pub claude_model: String,
    pub codex_model: String,
    pub gemini_model: String,
    pub test_prompt: String,
}
```

持久化：`app_configs` 单键 `"stream_check_config"`，值为 JSON 字符串。读不到就 `Default`。

**接线是这项的重点**（只存不用等于没做，见 AC14）：
- `check_stream` 增加 `config: &StreamCheckConfig` 参数，`timeout_secs` 替换硬编码 30s
- `max_retries` 在 `check_provider_health` 外层做重试循环
- `degraded_threshold_ms` 决定 `operational` / `degraded`：响应时间超阈值即 `degraded`
- 三个模型名与 `test_prompt` 替换 `build_request` 里的硬编码

**默认值刻意等于当前硬编码值** —— 用户没配过时行为与现在完全一致，这是不回归现有健康检查的关键。

现有两个调用方 `provider_commands::check_provider_health` 与
`utility_commands::check_stream_connectivity` 需同步改签名（内部读配置，不改前端契约）。

## 5.6 Provider 限额（R7）

```rust
pub fn check_provider_limits(&self, provider_id: &str, app_type: &str)
    -> Result<ProviderLimitStatus, AppError>
```

读 `providers.meta` 的 `limitDailyUsd` / `limitMonthlyUsd`（字符串 → f64，缺键为 `None`），
按本地时区聚合成本：

```sql
-- 当日
WHERE provider_id = ? AND app_type = ?
  AND date(datetime(created_at,'unixepoch','localtime')) = date('now','localtime')
-- 当月
  AND strftime('%Y-%m', datetime(created_at,'unixepoch','localtime'))
    = strftime('%Y-%m','now','localtime')
```

未设限额时 `exceeded` 恒为 `false`（不是「超限」也不是报错）。

**UI 是必须的一半。** cc-switch 只有 `useProviderLimits` hook、零组件消费 —— 照搬就等于
搬进一份死代码，与本任务要修的 bug 同类。ccg 侧要补两处：
1. provider 编辑表单：日限额 / 月限额输入（可空 = 不限）
2. `ProviderStatsTable`：超限行加 `badge-error` 标记 + `已用 / 限额` 文字

## 6. Dashboard 重构

```
┌─ 代理用量（SQLite · 经内置代理的请求）────────────────┐
│  [请求数] [成本] [Tokens↓input/output] [缓存↓write/read] │
│  ┌────────── 用量趋势（今天/7天/30天 · 双Y轴）─────────┐ │
│  └──────────────────────────────────────────────────┘ │
│  [Tab: 请求日志 | Provider 统计 | 模型统计]              │
└──────────────────────────────────────────────────────┘
┌─ ▸ 会话用量（~/.claude/projects 会话文件）── 折叠 ─────┐
│  6 张 StatCard · 活跃度时钟图 · Token 饼图 · 项目列表   │
│  （整段搬入 collapse，内部实现零改动）                   │
└──────────────────────────────────────────────────────┘
```

重构手法：把现有 730 行里会话统计相关的 JSX **整段移动**进 `collapse` 容器，
`StatCard` / `TrendMetric` / `HourlyClockChart` / `buildDonutSegments` 等辅助函数与
`useDashboardStore` 调用全部保持原样。这样 R4.4「功能不删」可以靠 diff 检查而非人工回归验证。

`ProxyUsageCard` 改为读 `get_usage_summary`，展示运行态 + 今日请求数/成本。

## 7. 依赖变更

后端 `Cargo.toml`：
- `rust_decimal = "1"` —— 成本定点计算
- `async-stream = "0.3"` —— tee 流的 `stream!` 宏
- `uuid` 已有（v4，生成 request_id）

前端 `package.json`：
- `recharts` —— 趋势图
- `@tanstack/react-query` —— usage 查询与轮询

## 8. 兼容性与回滚

- DB 全部 `CREATE TABLE IF NOT EXISTS` + `INSERT OR IGNORE`，老库直接可用，无破坏性迁移。
- 采集是**新增旁路**：`response_processor` 出问题时，把 `handlers.rs` 的调用改回
  `relay_response(resp)` 一行即可回到当前行为，代理功能不受影响。
- Dashboard 重构与采集层解耦，可独立回滚。
- 删除的 JSONL 死代码无调用方、无用户数据（文件从未被写入），删除无风险。

## 9. 验证要点

1. `cargo test`：calculator 计费口径（含缓存扣减、倍率只作用总价）、parser 各格式、
   trends 分桶补零、pricing 模型名清洗匹配、**backfill 与 calculator 同输入等价**、
   倍率解析链回落顺序。
2. 流式实测：真实 Claude Code 对话，确认逐字输出不卡顿、内容完整。
   这一项**必须实机验证**，单测覆盖不到。
3. 非流式实测：`curl` 一次 `/v1/messages`（`stream:false`），查表核对。
4. 错误落库：故意配错 API Key，确认落 401 行。
5. R6 接线验证：`timeoutSecs` 改 3 秒后必须真的 3 秒超时 —— 证明配置接进了执行路径。
   同时验证「未配置时行为与改动前一致」（默认值 = 原硬编码值）。
6. R7 闭环验证：设限额 → 超限 → 表格出现标记。只验命令返回值不算通过。
7. R8 验证：倍率 2 → 分项不含倍率、总价 ×2；清空 → 回落全局；全局也空 → 1。
