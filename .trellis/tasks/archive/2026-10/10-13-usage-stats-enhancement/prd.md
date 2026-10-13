# 10-13-usage-stats-enhancement

## Goal
增强 CCG-Switch 的使用统计模块：
1. 实现从 models.dev 一键导入模型定价（支持获取主流模型定价，支持覆盖/增量更新模式）。
2. 实现过去一年的 GitHub 风格日历贡献热力图（Yearly Contribution Heatmap），展示每日调用频次、Token 用量与成本，支持指标切换、深色/浅色主题、日期悬停 Tooltip。

## Requirements

### 1. models.dev 模型定价导入
- **后端命令**: `import_models_dev_pricing(overwrite_existing: bool) -> Result<ImportPricingResult, String>`
- **数据来源**: `https://models.dev/api.json?type=all`
- **数据映射**:
  - `model_id`: 模型 ID (从 models.dev 模型字典中提取，忽略无 cost 数据或无效格式项)
  - `display_name`: 模型名称 (若无则使用 model_id)
  - `input_cost_per_million`: `cost.input` 转字符串
  - `output_cost_per_million`: `cost.output` 转字符串
  - `cache_read_cost_per_million`: `cost.cache_read` (默认 0)
  - `cache_creation_cost_per_million`: `cost.cache_write` (默认 0)
- **更新策略**:
  - `overwrite_existing = false`: 仅当 `model_pricing` 表中不存在该 `model_id` 时插入 (INSERT OR IGNORE)
  - `overwrite_existing = true`: 存在则更新，不存在则插入 (INSERT OR REPLACE)
- **前端交互**:
  - 在 `PricingConfigPanel.tsx` 的模型定价区右上角增加「从 models.dev 导入」按钮
  - 点击弹出确认对话框，允许勾选「覆盖已有同名模型定价」
  - 导入期间展示 loading 状态，完成后展示 toast 提示「成功导入 X 个模型定价 (更新 Y 个)」并刷新列表

### 2. 全年使用热力图 (Yearly Contribution Heatmap)
- **后端命令**: `get_yearly_heatmap(app_type: Option<String>, provider_name: Option<String>, model: Option<String>) -> Result<Vec<HeatmapDay>, String>`
- **统计区间**: 从当前日期的 364 天前到今天 (涵盖 52~53 周，按本地日期 `YYYY-MM-DD` 聚合)
- **统计字段**:
  - `date`: `YYYY-MM-DD`
  - `request_count`: 当日请求数
  - `total_tokens`: 当日消耗 Token 总数 (优先 `real_total_tokens`，兜底 `input_tokens + output_tokens`)
  - `total_cost`: 当日花费成本 (USD 格式化两位/四位小数)
- **前端组件**: `YearlyHeatmap.tsx`
  - 渲染类似 GitHub Contribution 的 7行 × 53列格子矩阵
  - 左侧标注星期（Mon, Wed, Fri 等），上方标注月份（Jan, Feb, ...）
  - 右上角提供指标切换：按「请求数」(Requests) / 「Token 用量」(Tokens) / 「费用」(Cost) 调整格子颜色强度
  - 颜色分阶：5 级阶梯（0 = 无数据，1~4 级按分位数或区间递增上色，完美适配 light / dark 主题）
  - 悬停浮层 Tooltip：展示具体日期、请求数、Token 消耗量和花费成本
  - 右下角展示「少 / Less ▢▢▢▢▢ 多 / More」图例
  - 集成在 `UsagePage.tsx` 中（在汇总卡与趋势图之间或紧跟趋势图）

## Acceptance Criteria
- [x] 后端 `import_models_dev_pricing` 命令正常解析 `models.dev` API 并存入 `model_pricing` 表。
- [x] 单元测试覆盖导入逻辑、定价去重与覆盖/忽略分支。
- [x] 前端 `PricingConfigPanel` 成功集成导入按钮与确认弹窗，调用后列表即时刷新。
- [x] 后端 `get_yearly_heatmap` 命令正确统计 365 天每日数据（含空天补零）。
- [x] 前端 `YearlyHeatmap` 组件在 Light/Dark 模式下视觉优雅，Tooltip 与图例正常工作。
- [x] `npm test` 与 `npm run build` 均编译通过并全部通过测试。
- [x] i18n 多语言字典完整支持新功能中英文。
