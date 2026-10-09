# 使用统计模块 · 功能对齐方案

> 对比基准：`C:/guodevelop/demo/cc-switch`（参考，下称 **REF**）
> 对齐目标：`C:/guodevelop/ccg-switch`（当前，下称 **CUR**）
> 分析日期：2026-10-06　　范围：数据采集、统计维度、计算逻辑、展示方式、配置

---

## 0.1 ⚠️ 重大修正：数据来源的真实差异

**初版分析判断有误**：「两项目都只靠代理记账，不解析 JSONL」。实际排查数据库后发现：

| | REF | CUR（修正前） |
|---|---|---|
| `proxy_request_logs.data_source` | `session_log` 732 条 / `codex_session` 264 条 | **无此列** |
| `latency_ms` / `first_token_ms` | 全部 `0` / `NULL`（会话文件里没有延迟） | 代理实测值 |
| 实际来源 | **100% 解析本地会话 JSONL** | 100% 代理记账 |

**结论：两个项目的数据来源完全不同，此前互不可比。** REF 的 996 条记录全部来自
`~/.claude/projects/**/*.jsonl` 与 `~/.codex/sessions/**/*.jsonl`，
`provider_id = '_session'` / `'_codex_session'`。

实测验证（今天 15:42 的记录）：

| 来源 | JSONL 字段 | REF DB |
|---|---|---|
| `~/.claude/projects/.../381cd3a3-*.jsonl` | ts=07:42:00 UTC in=28441 out=195 | 15:42:00 in=28441 out=195 ✓ |
| `~/.claude/projects/.../092abae4-*.jsonl` | ts=07:35:07 UTC in=6165 out=13 | 15:35:07 in=6165 out=13 ✓ |

同一 `requestId` 在会话文件里出现两次且 token 完全相同（流式分片），
REF DB 里**只存一条** —— 本项目按 `requestId` 去重的行为与 REF 一致。

>注：REF 当前源码中已无 `session_log` 字面量与 `data_source` 列定义，
> 这些记录由其早期版本写入，属历史数据。但这不影响结论——
> 它的用户日常用量确实靠会话文件记账，而 CUR 只会因代理没开而全是 0。

---

## 0. 实施状态（第一~三阶段已完成）

> **实施原则：以 cc-switch 为准，不自创形态。** 超出参考项目的发挥一律回退，
> 只有「补齐参考项目已有但未接线的能力」和「修参考项目也存在的死配置」才保留。

| ID | 项目| 状态 | 说明 |
|---|---|---|---|
| **N-1** | **会话文件采集通道** | ✅ 已完成 | 新增 `services/session_usage_scanner.rs`，解析 Claude Code / Codex 本地 JSONL 入库；`data_source` 列区分来源；进页面自动扫 + 2 分钟轮询 + 手动按钮 |
| G-1 | 请求详情面板 | ✅ 已完成 | 照REF `RequestDetailPanel.tsx` 实现并接线（REF 该组件存在但未被引用） |
| G-2 | 统计表时间范围 | ✅ 已完成 | provider/model 聚合接受 `start_date/end_date`，抽 `time_where` 统一四处口径 |
| G-3 | 配额限额体系 | ✅ 已完成 | 后端 command + dao 已补齐；UI 挂在 `UsageFooter`（REF 只有 api+hook 未接 UI，按其设计意图接上） |
| G-4 | 定价面板多App 显示 | ✅ 已完成 | 每 app 独立取数，修掉三行显示同一倍率的误导 |
| M-1 | 自动刷新间隔 | ✅ 已完成 | 默认 30s，0/5/10/30/60s 循环切换（与 REF 一致） |
| M-2 | 滚动/固定双时间模式 | ✅ 已完成 | 24h 滚动窗口每 30s 重算、草稿/生效分离、3 条校验 |
| M-4 | 价格种子覆盖 | ✅ 已完成 | 补 GPT-5.x effort 变体 + 国内模型（deepseek/kimi/glm/qwen） |
| M-5 | 脚本测试写缓存 | ✅ 已完成 | `setQueryData(['usage', providerId, appType])` |
| E-5 | 后端负值校验 | ✅ 已完成 | 负价格/负倍率在 command 层拦截 |
| E-8 | 日志开关门控 | ✅ 已完成 | `enable_logging` 在 REF 与 CUR 都是死配置，本项目将其落库并真正门控 |
| L-2 | 补算倍率链 | ✅ 已完成 | 补上 `app_configs` 全局倍率层 |
| L-4 | 统计口径统一 | ✅ 已完成 | provider/model 表新增缓存 token 列，并用测试锁定 |
| L-3 | 死代码清理（部分） | ✅ 已完成 | 删除无调用方的限额常量/ key函数；孤儿 dashboard 组件待决策 |

**回退的自创发挥**（用户明确要求对齐 REF 后移除）：
- ❌ 空态引导横幅 + `emptyTitle`/`emptyHint`/`goToProxy` —— REF 无任何代理引导
- ❌ `LimitAlertBanner` 组件 + `usage.limit.*` 文案 —— 改为挂在 `UsageFooter`
- ❌ `list_exceeded_limits` command —— REF 无此聚合查询
- ❌ `usage.detail.*` / `usage.logs.*` 自造嵌套 i18n —— 改为 REF 的平铺键
- ❌ 定价配置从Tab 改为独立 Tab —— 改为 REF 的**折叠面板且默认收起**

**超出 REF 的保留项**（经评估为净收益）：
- **E-6 数据保留策略** —— REF 无此能力，但日志表无节制增长是真实问题
- **E-8 日志开关** —— REF 同样有 `enable_logging` 死配置，本项目将其接通

**验证**：`cargo test` 279 passed / 0 failed；`npx tsc --noEmit` 无错误；command清单与 REF 对齐。

### 0.2 四维对齐收尾（2026-10-08）

> 范围：页面结构与交互 / UI 视觉与布局 / i18n / 数据加载与渲染性能。

| ID | 项目 | 状态 | 说明 |
|---|---|---|---|
| U-1 | 趋势图 tooltip 重构收尾 | ✅ | `TrendTooltip` 提升到模块作用域后仍引用已删除的 `CustomTooltip`，`tsc` 断点（2 错误）修复 |
| U-2 | 图表懒拆包 | ✅ | `UsageTrendChart` 改 `React.lazy` + `UsageChartSkeleton` 兜底；recharts 独立 chunk 349.8 kB（gzip 93 kB），不再进 /usage 首屏包 |
| U-3 | 图表深色模式取色 | ✅ | 轴/网格/游标改 `currentColor` + `text-base-content/60`，替换 recharts 默认 `#ccc` / `#666`（design §5.3 遗留决策，已写入 spec/frontend） |
| U-4 | UsageFooter 交互补齐 | ✅ | 相对时间（刚刚 / N 分钟前 / N 小时前 / N 天前）+ 总额显示（`total === -1 → ∞`）+ `usage_script.*` 5 个新键（zh/en 对称） |
| U-5 | ProvidersPage 测试修复 | ✅ | UsageFooter 引入 `useProviderLimits` 后测试缺 `QueryClientProvider`，4 个用例恢复通过 |
| U-6 | i18n 收口 | ✅ | 全量审计：代码引用的 123 个 usage 键在 zh/en 中全部存在；清理 22 处冗余内联中文默认值（PricingConfigPanel / PricingEditModal / RequestDetailPanel）；删除 5 个零引用键（timeRange / statusCode / queryFailed / refreshUsage / loadPricingError）；`template_*` 为动态拼接键，保留 |

**验证**：`npx tsc --noEmit` 0 错误；`vitest` 916 passed / 0 failed（95 文件）；`npm run build` 成功；`cargo check` 通过。

**本轮遗留（需产品决策）**：
- E-1 脚本编辑器 Monaco + Prettier（依赖 +约 2MB，REF 有、CUR 仍为 textarea）
- E-2 脚本凭证按 app 特化提取（CUR 已有 `provider.api_key/url` 兜底；REF 额外做 codex TOML 解析等）
- ProxyUsageCard 孤儿组件（无消费方；REF 无对应物，接线或删除待定）
- E-7 Schema 迁移框架（`user_version` + usage 表 ALTER）


### 0.3 加载性能专项（2026-10-08）

> 用户反馈「加载很慢、体验差」。根因不在前端渲染，在后端线程模型与扫描算法：

| 根因 | 影响 | 处理 |
|---|---|---|
| 用量命令全部是同步 `fn`，Tauri 同步 command 跑在主线程 | 扫描 / 聚合期间整个窗口冻结 | 13 个用量命令 + 扫描 + 保留策略命令全部改 `async` + `spawn_blocking`（`run_blocking`） |
| 会话扫描器每次 `read_to_string` 全量读入并逐行解 JSON（本机 Codex 755 文件 887 MB + Claude 38 文件 36 MB） | 进页面与每 2 分钟一次的全量重扫 | 文件级增量：`session_scan_files` 记 (size, mtime, offset)，没变不打开、变了续读尾部；行级字面量预筛选；流式 `BufReader`，不整文件进内存 |
| 每行一次自动提交、无 WAL | 每行一次 fsync | 一文件一事务（行 + 进度原子提交，`INSERT OR IGNORE`）；`journal_mode=WAL` + `synchronous=NORMAL` + `busy_timeout` |
| 每次扫描先 `SELECT request_id` 全表进 HashSet（两遍） | 随日志表增长线性变慢 | 删除，去重交给主键 |
| 首页 6 个统计命令同步，`get_project_token_stats` 启动时逐行解析全部会话 JSONL | 应用启动即卡主线程 | 6 个命令异步化（`run_fs_blocking`）；`sum_session_tokens` 加 `"usage"`+`"assistant"` 预筛选，并按文件 (size, mtime) 记忆化 |
| 进页面立刻触发扫描，与首屏 3 个查询抢数据库锁 | 首屏变慢 | 首次扫描延后 1 s |

**基准**（release，真实目录只读、写内存库，`bench_real_session_dirs`）：

| 场景 | 耗时 | 结果 |
|---|---|---|
| 首次全量扫描 | 1.20 s | 793 文件 / 923 MB，入库 40,557 行 |
| 稳态增量扫描 | 32.5 ms | 全部文件 stat 命中缓存，0 次打开 |

**验证**：`cargo test` 294 passed / 0 failed（新增 6 个增量扫描用例：追加续读、截断重扫、半行等待、久未修改文件收尾行、预筛选超集、幂等）；`npx tsc --noEmit` 0 错误；`vitest` 916 passed；`npm run build` 成功。约定已写入 `.trellis/spec/backend/async-patterns.md`。

### 0.4 视觉重做（2026-10-08）

> 用户反馈组件 / 列表 / 按钮「太丑」。对照 ProvidersPage / Dashboard 提取项目既有视觉语言后统一重做，交互逻辑零改动。

| 问题 | 处理 |
|---|---|
| 容器边框用 `border-base-300`：深色主题里 base-300 是最深的页面底色，边框等于消失；浅色下又比项目惯用的 gray-100 重 | 统一为项目约定 `border-gray-100 dark:border-base-200`，抽到 `components/usage/styles.ts` |
| 时间范围用默认灰色 `btn-group`，标签页用 `tabs-boxed`，两套形态不一致 | 统一为分段控件（浅灰槽 + 白色滑块），`segmentItem(active, large)` 两档尺寸 |
| 状态 / 用时用实心 `badge-success` 等高饱和色块，一行三个很吵 | 改软色徽章 `chip(tone)`：10% 底色 + 同色系文字，深色主题独立配色 |
| 汇总卡图标为平面色块，加载态是四个转圈的空盒 | 渐变图标块（与页头同语言）、分项前加与趋势图同色的小色点、`skeleton` 骨架 |
| 筛选栏控件无标签、时间模式是两个小单选 | 栅格布局 + 可点击字段标签、滚动 / 固定改分段控件、校验错误改为带图标的软红提示条 |
| 分页是默认 `join` 按钮组 | 左侧「共 N 条 · 第 x / y 页」，右侧圆角页码，当前页深色实心 |
| 日志行可点击但无视觉线索 | 行尾加 ChevronRight，悬浮浅底 + pointer |
| 详情面板关闭按钮是文本「✕」，区块边框同样用 base-300 | 换 lucide X 图标，区块改浅灰底 + 合计行加粗，入场复用 `animate-fadeIn`，遮罩加模糊 |
| 定价面板主按钮 `btn-primary` 实心蓝，与全局渐变主按钮不一致 | 统一 `primaryBtn` 渐变；编辑弹窗改带图标头部 + 两列价格输入（$ 前缀） |
| 页头无图标块，与其它页面不一致 | 补渐变图标块 + 标题 + 副标题 |

新增 i18n：`usage.fixedRange` / `usage.timeRange` / `usage.statusCode` / `usage.pageOf` / `usage.scan.button`（zh/en 对称）。

**验证**：`npx tsc --noEmit` 0 错误；`vitest` 916 passed / 95 文件；`npm run build` 成功；用量模块引用的 111 个 i18n 键在 zh/en 中全部存在；无 `border-base-300` / 实心 `badge-*` / `btn-group` / `tabs-boxed` 残留。

### 0.5 缓存命中率 + 供应商统计对齐上游新版（2026-10-09）

> 本地参考仓库停在 2026-02-25（`47435bd6`），用户本机装的 CC Switch 是新版。已 `git fetch` 上游到 `889b797d`（2026-10-09）对照。

| 差距 | 上游新版 | 处理 |
|---|---|---|
| 无缓存命中率 | `UsageHero` 指标卡：命中 ÷（新鲜输入 + 写入 + 命中） | 后端 `UsageSummary` 新增 `cacheHitRate` / `realTotalTokens`；前端加第 5 张卡（百分比 + 进度条 + 命中 / 可缓存输入） |
| 输入口径跨应用不一致 | `fresh_input_sql`：Codex / Gemini 的输入含缓存，聚合前先扣 | 照搬为 `fresh_input_sql` / `real_total_tokens_sql`，汇总、趋势、供应商、模型统一走它 |
| 计费公式对 Claude 误扣缓存 | `calculate_for_app` 按应用语义 | `CACHE_INCLUSIVE_APP_TYPES = [codex, gemini]` 作为计费与统计共用的单一来源；实时记账、会话扫描、补算三处都改用 `calculate_for_app` |
| 会话导入的行显示「未知供应商」 | `provider_name_coalesce`：`_session` → `Claude (Session)` 等，前端翻译为「Claude · 会话日志」 | 照搬；供应商表、日志表、详情面板、供应商筛选共用；被删供应商回落到 provider_id |
| 供应商表列 | 供应商 / 请求数 / Tokens（真实消耗）/ 成本 / 成功率 / 速度，按请求数排序 | 对齐；速度 = Σ输出 ÷ Σ(总耗时 − 首字)，只统计经代理、输出 ≥100 token 的流式请求，会话日志行显示「—」 |
| 汇总「总 Token」不含缓存，与表格之和对不上 | 「真实消耗 Tokens」 | 第 3 张卡改为真实消耗（分项：新增输入 / 输出），供应商、模型表各行之和等于它 |

**真实数据核对**（本机两个库只读查询，同一时间窗口）：

| 窗口 | ccg-switch | cc-switch |
|---|---|---|
| 24 小时 | 83.8% | 83.2% |
| 7 天 | 84.9% | 84.5% |
| 30 天 | 81.5% | 80.9% |

差值来自 cc-switch 多记了一条请求的缓存写入（约 51 万 token），口径一致。

**未照搬**：上游的会话日志估算速度（≈，依赖导入时按日志时间戳估算的耗时，本项目会话行无耗时数据）；日汇总表 `usage_daily_rollups` 与 `input_token_semantics` 列；指标区「更多指标」折叠。

**验证**：`cargo test` 300 passed（新增：Claude 不扣缓存、Codex 扣缓存、命中率归一、会话占位名、速度口径、日志名表达式防漂移）；`tsc` 0 错误；`vitest` 916 passed；`npm run build` 成功。

**注意**：已入库的历史行成本按旧公式算，不会自动重算；新记录按新口径。Claude 历史行的差异只是新鲜输入那部分（通常每条几十到几千 token），影响很小。

### 0.6 「今天」筛选 + 时间范围全页联动 + 思考强度（2026-10-09）

| 问题 | 根因 | 处理 |
|---|---|---|
| 没有「当天」选项 | 只有 24 小时 / 7 天 / 30 天三个滚动窗口 | 新增「今天」：本地 0 点至今，趋势按小时（0–23 点）；`getTimeWindow` 与范围文案收进 `services/usage.ts` 共用 |
| 切换时间范围列表不动 | 汇总、趋势、供应商、模型都跟着范围走，唯独请求日志表固定「最近 24 小时」 | 日志表接收页面范围，「跟随」模式窗口 = 页面范围；切换范围时自动回到跟随、清掉自定义时间、回到第 1 页 |
| 没有思考强度 | 未采集 | 新增 `reasoning_effort` 列；日志表与详情面板显示徽章，值原样保留并按档位着色 |

**思考强度的来源**：

| 来源 | 字段 | 说明 |
|---|---|---|
| Claude Code 会话 | 每条 assistant 记录顶层 `effort`，缺省退到 `perTurnEffort` | 逐行自带 |
| Codex 会话 | `turn_context.payload.effort`（旧版在 `collaboration_mode.settings.reasoning_effort`） | 每轮开头声明，本轮后续用量行沿用；增量续读从中途开始，所以扫描进度表新增 `last_effort` 记住上次的值 |
| 代理请求体 | Anthropic `output_config.effort`；OpenAI Responses `reasoning.effort`；Chat Completions `reasoning_effort`；Gemini `thinkingConfig.thinkingLevel` | 实时记账时提取 |

**历史数据回填**：迁移补列时清空 `session_scan_files`，下次进入用量页会重扫全部会话文件（本机约 1.3 秒，后台线程）。插入仍按主键忽略重复，只对已存在且思考强度为空的行回填，不会重复记账，也不计入「已导入 N 条」。

**真实数据**（本机 790 个会话文件）：Claude 3,445 条全部采集到（xhigh 3,301 / medium 144）；Codex 36,812 条中 36,604 条采集到（xhigh / high / ultra / medium / low），208 条来自没有该字段的老版本会话文件，显示「—」。扫描性能不变：首次 1.26 秒，稳态 33 毫秒。

**验证**：`cargo test` 306 passed（新增：迁移补列并重置扫描进度且幂等、旧库无扫描表不崩、思考强度读写与回填不覆盖、Claude 逐行取值、Codex 跨轮与跨增量续读沿用、代理四种请求体提取）；`vitest` 920 passed（新增「今天」窗口与分桶判断）；`tsc` 0 错误；`npm run build` 成功。

---

## 一、结论速览

### 1.1 整体判断

当前项目的**代理计费主干（体系 A）已与参考项目基本持平**，部分关键实现甚至优于参考（成本回填复用、定价前缀兜底、SSE 字节级透传）。真正的差距集中在**三块**：

| 差距面 | 严重度 | 一句话结论 |
|---|---|---|
| **① 请求详情链路断裂** | 高 | 后端 command + react-query hook 齐备，**只差一个 UI 组件**，导致 5 项成本明细 / TTFT / 错误信息全部无法查看 |
| **② 供应商限额体系整体缺失** | 高 | REF 有 `check_provider_limits` + 4 个 limit 配置键；CUR 只有 `ProviderLimitStatus` 结构体（标 `dead_code`），**无 command、无查询、无 UI** |
| **③ 交互与配置能力落后** | 中 | 自动刷新（REF 可配 0/5/10/30/60s，CUR 硬编码 0）、滚动/固定双时间模式、模型测试配置、脚本编辑体验（Monaco+Prettier vs 12行 textarea） |

### 1.2 代码量对比

| 层 | REF | CUR | 差值 |
|---|---|---|---|
| Rust 采集层（proxy/usage） | 1513 行 | ~1400 行 | 基本持平 |
| Rust 统计服务 | 984 行 `usage_stats.rs` | 500 + 304 行 | CUR 拆分为两文件 |
| Rust 命令层 | 179 行 / 10 个 cmd | 182 行 / 13 个 cmd | CUR 更多 |
| 前端组件 | 2642 行 / 10 个组件 | 1601 行 / 7 个组件 | **CUR 少 3 个组件、约 1000 行** |
| 前端 API/hooks | 327 行（api + react-query） | 268 行（service + hooks） | 持平 |

### 1.3 已超越参考项目的点（应保留，不要动）

| # | 能力 | CUR 位置 | REF 对应 |
|---|---|---|---|
| 1 | **成本回填复用同一 `calculate`**，测试断言两条路径结果一致 | `dao/usage_logs.rs:710-766` | REF `usage_stats.rs:706-724` **手工复制了第二份公式**，注释明确承认 |
| 2 | **定价查表：精确优先 + 最长前缀兜底** | `dao/usage_logs.rs:132-181` | REF `usage_stats.rs:817-857` **仅精确匹配**，无前缀兜底 |
| 3 | 定价表 schema 注释解释了「同代不同档价差 3 倍，必须写全 id」 | `database/schema.rs:196-198` | REF 无此说明 |
| 4 | `update_model_pricing` 后端 `Decimal::from_str_exact` **提前校验** | `usage_commands.rs:100-109` | REF 无校验 |
| 5 | SSE tee **先切帧再原样 yield bytes**，字节级透传保真 | `response_processor.rs:415-420` | — |
| 6 | Claude 前缀兜底价格种子（`claude-opus-4` 等 6 条） | `database/schema.rs` | REF **无前缀种子**，模型名一变即计 0 成本 |

> **重要**：这 6 点意味着 CUR 的**计费内核已超越 REF**。对齐工作的重点**不是重写采集/计算层**，而是补齐 REF 的**交互层、限额层、详情层**。

---

## 二、模块全景对比

### 2.1 数据采集链路

```
                         ┌───────────── REF ─────────────┐┌───────────── CUR ─────────────┐
采集入口                 │ proxy/response_processor.rs   ││ proxy/response_processor.rs   │≈ 同
  ├ 非流式JSON           │ handle_non_streaming         ││ handle_non_streaming         │
  └ 流式 SSE             │ SseUsageCollector + AtomicBool││ SseUsageCollector + AtomicBool│≈ 同
解析器路由               │ handler_config.rs 静态配置表  ││ response_processor.rs:60-88   │⚠ 差异
                         │ (4 个 const + 函数指针)        ││ (按 AppType 硬编码 if/else)   │
Token 解析器数           │ 14 个方法 / 5 种 API 格式     ││ 14 个方法 / 5 种 API 格式     │≈ 同
落库                     │ proxy_request_logs (23 列)    ││ proxy_request_logs (23 列)    │≈ 同
日志开关门控             │ ❌ 未使用（死配置）            ││ ❌ 未使用（死配置）           │⚠ 共同问题
保留策略                 │ ❌ 无                         ││ ❌ 无                         │⚠ 共同问题
```

**关键澄清**：两个项目的用量数据**唯一来源都是本地代理转发的上游 API 响应**，均**不解析 JSONL 日志**。CUR 额外存在一套独立的 JSONL 统计（`stats_service.rs`，见 2.4），但它**不产出成本、不进 SQLite**，与代理计费完全隔离。

### 2.2 数据库表对比

| 表 | REF | CUR | 差异 |
|---|---|---|---|
| `proxy_request_logs` | 23 列 | 23 列 | **字段级完全一致** ✅ |
| `model_pricing` | 6 列 | 6 列 | 一致 ✅ |
| `proxy_config` | 按 app_type 存 3 个计费列 | `app_configs` KV 存 3 个计费键 | 结构不同，**功能等价** |
| `limit_daily_usd` / `limit_monthly_usd` | `proxy_config` 列 | `app_configs` 键（**无 command**）| ⚠ CUR 未接线 |
| Schema 版本管理 | `SCHEMA_VERSION = 5` + 迁移 | `user_version` **未使用**，迁移只管 `sort_order` | ⚠ CUR 缺迁移框架 |
| 价格种子 | ~40 条（GPT-5.2 全 10 变体） | ~30 条（含 6 条前缀兜底）| REF 变体覆盖更全 |

**CUR 已有的价格前缀兜底是优势**，但**模型变体覆盖不足**：REF 预置 `gpt-5.1-minimal`、`gpt-5-low/medium/high/minimal`、`gpt-5-codex-low`、`deepseek-v3`、`kimi-k2-0905`、`glm-4.7/4.6` 等，CUR 缺失。由于 CUR 有前缀兜底，`gpt-5-low` 会命中 `gpt-5` 前缀（可行），但 `deepseek-v3` / `glm-4.6` / `kimi-k2-0905` 等**国产模型完全无价格** → 计 0 成本。

### 2.3 统计维度对比

| 维度 | REF | CUR | 差异 |
|---|---|---|---|
| 时间窗口 | summary/trends 支持 start/end | 同 | ✅ |
| 趋势分桶 | ≤24h→24 个小时桶；>24h→天桶；Rust 侧补零 | 同 | ✅ |
| 按 provider | `provider_id + app_type` 分组 + LEFT JOIN 取名 | 同 | ✅ |
| 按模型 | `model` 分组 | 同 | ✅ |
| **provider/model 时间过滤** | ❌ 也不支持 | ❌ 不支持 | ⚠ **两项目共同缺陷**（见 G-2） |
| 请求明细筛选 | 6 维 + 分页 | 6 维 + 分页 | ✅ |
| 成功率 | 2xx 比例 | 同 | ✅ |
| 平均延迟 | AVG(latency_ms) | 同 | ✅ |
| **请求详情（单条全字段）** | `get_request_detail` + **UI 面板** | command 有、**UI 缺** | ❌ **核心缺口** |
| **配额检查（日/月限额）** | `check_provider_limits` | ❌ 无 | ❌ **核心缺口** |
| 缓存命中率 | ❌ | ❌ | 双方缺 |
| TTFT 聚合（P95 等） | ❌ | ❌ | 双方缺（都只落库不聚合） |

### 2.4 CUR 独有的第三套体系（需决策是否整合）

`stats_service.rs` + `dashboard_service.rs` 提供 JSONL 统计：`totalSessions` / `hourCounts` / `modelUsage` / `projectTokenStats` / `activityHistory`。

**问题**：
- `ModelUsage.cost_usd` 字段存在但**从不写入** → Dashboard 成本图恒为 0
- `DailyActivity.session_count` **从不写入** → 恒为 0
- `longest_session` **从不写入**
- `projectTokenStats` 只累加 input+output，**忽略缓存**，**无成本**
- `cost_usd` 用 `f64`，与体系 A 的 Decimal 原则相反
- 与体系 A **数据完全隔离**，无法回答「这个项目这个月花了多少钱」

> REF 无此体系。这是 CUR 的**架构负债**，不是对齐缺口。

---

## 三、差异清单与优先级

>优先级：**P0** 阻塞性/数据错误 → **P1** 核心功能缺失 → **P2** 体验与健壮性 → **P3** 优化项

### P0 — 必须修复（存在数据错误或功能完全不可用）

| ID | 项目 | 差异描述 | REF 位置 | CUR 位置 | 工作量 |
|---|---|---|---|---|---|
| **G-1** | 请求详情面板 | 后端 `get_request_detail` + 前端 `useRequestDetail` hook 均已就绪，但**无任何 UI 组件调用**，`RequestLogTable` 行**不可点击**（`<tr>` 无 onClick）。导致 `input_cost` / `output_cost` / `cache_read_cost` / `cache_creation_cost` 五项成本明细、`first_token_ms`、`error_message`、`session_id` **全部无法查看** | `RequestDetailPanel.tsx`（285 行，已存在但**同样未被引用**——REF 也是死代码） | 需**新建** `src/components/usage/RequestDetailPanel.tsx` + `RequestLogTable` 加行点击 | 3h |
| **G-2** | provider/model 统计的时间范围失效 | `get_provider_stats` / `get_model_stats` **不接受 start_date/end_date**，但 UI 把它们放在「1d/7d/30d」切换器的 Tabs 内。用户切时间范围，这两张表数据**完全不变**——静默错误结果 | REF 同样有此缺陷 | `usage_commands.rs:36,42` + `dao/usage_logs.rs:472,525` | 2h |
| **G-3** | 配额限额体系整体缺失 | REF 有 `check_provider_limits`（读 `providers.meta.limitDailyUsd/limitMonthlyUsd`，按本地时区 `date()` / `strftime('%Y-%m')` 判今日/本月，超限返回 `exceeded`）。CUR 只有 `ProviderLimitStatus` 结构体（`models/usage.rs:141`，标 `#[allow(dead_code)]`，注释写「消费方在 S8 接入」——S8 未实现），`logger.rs` 里 `META_LIMIT_DAILY/MONTHLY`、`limit_keys()`、2 个全局键**全部无调用方** | `usage_stats.rs:578-650`、`commands/usage.rs:145` | 需补：command + dao 查询 + ProviderLimitStatus 接线 + UI 预警条 | 5h |
| **G-4** | `PricingConfigPanel` 多 App 显示同一值 | `config` 只对应 `selectedApp`，但非选中行也渲染 `config?.multiplier` → **三个 app 行显示同一个倍率**，UI 强误导 | REF 是 3 行独立 `<table>`，每行独立 state，**无此 bug** | `PricingConfigPanel.tsx:167,192` | 1.5h |

### P1 — 核心功能缺失

| ID | 项目 | 差异描述 | REF | CUR | 工作量 |
|---|---|---|---|---|---|
| **M-1** | 自动刷新间隔可配置 | CUR `UsagePage.tsx:18` `const refreshMs = 0` **硬编码不刷新**，只能手点。REF 有 0/5/10/30/60s 循环切换器（点刷新图标循环）+ `invalidateQueries` 整树失效 + UI 显示 `--`（0 时） | `UsageDashboard.tsx:36-45` | `UsagePage.tsx:18` + 4 个组件传参 | 2h |
| **M-2** | 滚动/固定双时间模式 | REF 日志表默认 **24h 滚动窗口**（每 30s 重算），手动选时间自动切「固定」，带草稿/生效分离（改筛选不立即查询，点「搜索」才生效）+ 3 条前端校验（起止完整、start≤end、跨度 ≤30 天）。CUR 仅固定时间 | `RequestLogTable.tsx:44-163` | 需补 rolling 逻辑 + 校验 | 4h |
| **M-3** | 模型测试配置面板 | REF 有 `ModelTestConfigPanel`（7 字段 `StreamCheckConfig`：timeoutSecs/maxRetries/degradedThresholdMs/三个 app 的测试模型/testPrompt）+ `get/save_stream_check_config` command。**注：REF 该面板已被注释掉（`SettingsPage.tsx:42`），当前无引用** | `ModelTestConfigPanel.tsx`(230) + `commands` | **完全无**，`model_api_service.rs` 只有 `fetch_models` | 4h（若需要）|
| **M-4** | 价格种子覆盖度 | CUR 缺 `deepseek-v3`、`glm-4.6/4.7`、`kimi-k2-0905`、`gpt-5.1-minimal`、`gpt-5-low/medium/high/minimal`、`gpt-5-codex-low` 等。虽有前缀兜底，但国产模型无任何价格键 → **恒计 0 成本** | `schema.rs:920-1276`(~40 条) | `schema.rs:196-398`(~30 条) | 1h |
| **M-5** | 脚本测试结果写缓存 | REF 测试成功后 `setQueryData(["usage",providerId,appId], result)` 立即刷新卡片。CUR 测试后需等下次轮询 | — | `UsageScriptModal.tsx` | 0.5h |

### P2 — 体验与健壮性

| ID | 项目 | 差异描述 | 工作量 |
|---|---|---|---|
| **E-1** | 脚本编辑器体验 | CUR 是 12 行 `<textarea>`；REF 是 Monaco（`JsonEditor` language=javascript, height=480）+ Prettier 格式化按钮 + 密钥 Eye/EyeOff 显隐 + 变量预览（`{{apiKey}}` 打码 `••••••••`）+ 帮助区（8 字段说明 + 3 条 tips）。CUR **依赖里也没有 monaco/prettier** | 6h |
| **E-2** | 脚本凭证自动继承 | REF 按 app 自动从 provider 提取凭证（claude: `ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_BASE_URL`；codex: TOML 解析 baseUrl；gemini: `GEMINI_API_KEY`），脚本内留空则回落 | 3h |
| **E-3** | `UsageFooter` 布局形态 | CUR 仅标准模式；REF 有 inline 紧凑模式 + `UsagePlanItem` 三栏布局 + `total===-1 → ∞` + 相对时间（刚刚/N分钟前/N小时前/N天前）+ 失效态双样式 | 3h |
| **E-4** | i18n 内联兜底泄漏 | `PricingConfigPanel` / `PricingEditModal` 大量 `t(key, '中文默认值')`，默认值**未进 locale 文件** → 英文界面**显示中文**。CUR usage 命名空间 80 键，REF 85 键 | 2h |
| **E-5** | 后端负值校验 | `update_model_pricing` 允许负价格、`set_default_cost_multiplier` 允许负倍率，**仅前端校验** → 绕过 UI 可写入负值产生负成本。REF 前端正则同样允许负（`/^-?\d+(?:\.\d+)?$/`），两边都需补后端校验 | 1h |
| **E-6** | 数据保留策略 | 两项目均**无任何清理/VACUUM**，`proxy_request_logs` 只增不减 | 2h |
| **E-7** | Schema 迁移框架 | CUR `migrate()` 只补 `providers.sort_order`，**无 usage 表 ALTER 逻辑**，早期版本创建的缺列表升级后不会补齐；无 `user_version` PRAGMA 管理。REF 有 `SCHEMA_VERSION=5` + `add_column_if_missing` | 3h |
| **E-8** | 日志开关门控 | 两项目 `enable_logging` 均为死配置，proxy 采集路径不检查 → 代理在跑就无条件记录 | 1h |

### P3 — 优化项

| ID | 项目 | 说明 |
|---|---|---|
| **L-1** | 解析器路由解耦 | REF 用 `handler_config.rs` 静态配置表（4 个 const + 函数指针），新增 AI 服务 = 加一个 const。CUR 是 `response_processor.rs:60-88` 按 `AppType` 硬编码 if/else |
| **L-2** | 补算倍率链对齐 | `lookup_multiplier_cached`（`usage_logs.rs:808-839`）只读 `provider.meta.costMultiplier` → 1，**不读 `app_configs` 全局倍率** → 补算结果可能与实时计费不一致，且**无测试覆盖** |
| **L-3** | 死代码清理 | `provider_type` 全程写死 `None`；`duration_ms = latency_ms` 完全冗余；`DailyActivity.session_count` / `longest_session` 从不写入；`#![allow(dead_code)]` 掩盖（`usage_logs.rs:1`、`token_service.rs:1`、`models/usage.rs:138`）；3 个 dashboard 组件零引用（`MultiAppStatsCard`/`ProxyUsageCard`/`QuickActions`）；4 个 i18n 键零引用；`schema.rs:276` 过期注释引用不存在的 `builtin_pricing` |
| **L-4** | 统计口径统一 | `UsageSummary` 分列 cache，但 `ProviderStats.total_tokens`（`usage_logs.rs:479`）和 `ModelStats.total_tokens`（L531）**只算 input+output 不含缓存** → 卡片与表格数字矛盾 |
| **L-5** | 成本聚合精度 | 金额 TEXT 存 Decimal 是对的，但聚合 `CAST(total_cost_usd AS REAL)` 退化为 f64。长期建议：加 `total_cost_micros INTEGER` 列做精确聚合，TEXT 仅作展示 |
| **L-6** | 新增指标 | 缓存命中率、TTFT P50/P95、按 `is_streaming` 分组、错误分类（4xx/5xx/timeout）、环比、CSV 导出、日志表虚拟滚动 |
| **L-7** | 命名统一 | CUR 有 4 套命名指向混淆概念：`models/usage.rs`（代理计费）、`usage_query_service.rs`（余额查询，名字像统计查询其实不是）、`usageScript`（余额脚本）、`token`（三义：API Key 凭证 / TokenUsage / ModelUsage） |

---

## 四、推荐实施路线

### 阶段一：修复错误与断链（1.5 天）

```
G-1  RequestDetailPanel 新建 + RequestLogTable 行点击
      → 后端已就绪，纯 UI 工作，收益最高
G-2  get_provider_stats / get_model_stats 增加 start_date/end_date 参数
      → 改动 dao SQL 的 WHERE 条件 + command 签名 + 前端传参
G-4  PricingConfigPanel 改为每 app 独立 state（或参照 REF 用独立 table）
G-3  配额限额体系：command + dao + UI 预警条（后端结构体已备，工作量最大）
```

**建议顺序**：G-1 → G-2 → G-4 → G-3。G-3 独立可并行。

### 阶段二：交互对齐（1.5 天）

```
M-1  refreshMs 循环切换器（0/5/10/30/60s）+ invalidateQueries
M-2  日志表 rolling/fixed 双时间模式 + 3 条前端校验
M-4  补齐价格种子（deepseek/glm/kimi/gpt-5.x 变体）
M-5  脚本测试结果 setQueryData
```

### 阶段三：健壮性（1 天）

```
E-5  后端负值校验
E-6  数据保留策略（保留 N 天 + 定时清理 + 可配）
E-7  Schema 迁移框架（user_version + usage 表 ALTER）
E-8  enable_logging 门控（或删除该死配置）
```

### 阶段四：架构治理（2 天，需产品决策）

```
L-4  统计口径统一（total_tokens 是否含缓存，需产品定义）
L-7  命名统一（4 套 usage/token/stats 命名收敛）
L-3  死代码清理
⚠️ 决策点：stats_service（JSONL 体系）如何处理
     选项 A：删除（与代理计费重复，且无成本）
     选项 B：保留 session/project 维度，但补成本计算，与体系 A 在聚合层合并
     选项 C：保留现状，仅修 cost_usd 恒 0 的 bug
L-1  解析器路由改为配置表（可选，前瞻性）
E-1/E-2/E-3  脚本与 Footer 体验增强（可选）
```

---

## 五、需产品决策的问题

| # | 问题 | 选项 | 影响 |
|---|---|---|---|
| 1 | `stats_service`（JSONL 统计）去留？ | A 删除 / B 补成本并与代理聚合合并 / C 保持现状 | 决定 2 天工作量投向；B 最有价值（能回答「这个项目花了多少钱」）|
| 2 | `total_tokens` 是否含缓存？ | 含 / 不含 | 影响 G-2 与 L-4，需同步改卡片+表格+SQL |
| 3 | 是否需要 M-3 模型测试配置？ | 需要 / 不需要 | REF 该面板自身已被注释掉，可能是废弃功能 |
| 4 | 日志保留多久？ | 30/90/180 天 / 永久 | E-6 实现方式；也影响是否需要归档表 |
| 5 | 定价是否需按供应商差异化？ | 全局一张表 / 加 provider_id 维度 | 当前全局表，若不同供应商同模型不同价则统计失真 |
| 6 | 是否引入 E-1 Monaco 依赖？ | 引入 / 保持 textarea | package.json 增重约 2MB |

---

## 六、附录：关键实现参考

### 6.1 REF 计费公式（不可改动）

```rust
// calculator.rs:64-82 —— CUR 已一致
let billable_input = input_tokens.saturating_sub(cache_read_tokens);  // 防缓存双重计费
input_cost          = billable_input        * input_price    / 1_000_000;
output_cost         = output_tokens         * output_price   / 1_000_000;
cache_read_cost     = cache_read_tokens     * cache_read_p   / 1_000_000;
cache_creation_cost = cache_creation_tokens * cache_create_p / 1_000_000;
total_cost = (四项之和) * cost_multiplier;   // 倍率只乘总价，分项存基础价
```

**两个不可动摇的口径**：
1. ~~`input` 必须减 `cache_read`~~ **已更正（2026-10-09，见 0.5）**：按应用区分。Claude 的 `input_tokens` 是新鲜输入、不含缓存，不能扣；Codex / Gemini 的含缓存，才要扣。上游 cc-switch 新版已改为 `calculate_for_app`，旧口径会把典型 Claude 请求的新鲜输入费饱和成 0
2. 倍率**只乘总价**，四个分项成本是基础价（REF 详情页明确标注「(基础)」/「(含倍率)」）

### 6.2 REF 模型名清洗（3 步，CUR 已一致）

```
1. rsplit_once('/')  去 vendor 前缀：  moonshotai/gpt-5.2-codex → gpt-5.2-codex
2. split(':').next() 去 :free/:v2 后缀： kimi-k2-0905:exa      → kimi-k2-0905
3. replace('@', "-")               effort 记法：  gpt-5.2-codex@low → gpt-5.2-codex-low
```

CUR 在此基础上**多了最长前缀兜底**，是净优势。

### 6.3 倍率解析优先级链（两项目一致）

```
provider.meta.costMultiplier
  → app_configs["default_cost_multiplier:{app_type}"]   （CUR）
  → proxy_config.default_cost_multiplier                （REF）
  → Decimal::ONE
```

**注意 L-2**：CUR 的补算路径（`lookup_multiplier_cached`）漏了中间那层全局倍率。

### 6.4 REF 值得借鉴的三个工程细节

| 细节 | 位置 | 价值 |
|---|---|---|
| `UsageParserConfig` 静态配置表（函数指针解耦 app→解析器） | `proxy/handler_config.rs:19-132` | 新增 AI 服务零改核心流程 |
| 空桶补零在 **Rust 侧**完成，固定 24 桶规避浮点误差 | `usage_stats.rs:214-292` | 前端不能假设 SQL 返回连续桶 |
| `is_char_boundary` 安全截断 HTTP 错误预览 | `usage_script.rs:272-280` | 避免多字节字符 panic |

---

*本方案基于对两个项目共 40+ 文件的只读通读分析，所有差异点均已通过 grep/读文件二次验证。*