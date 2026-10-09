# Design — 主页统计精简为合并 KPI

## 组件拆分

```
src/components/dashboard/
  OverviewKpiRow.tsx          # 新：主页唯一统计卡片
src/components/usage/session/  # 新目录：从 Dashboard.tsx 原样拆出
  SessionStatsSection.tsx     # 组合下面几个组件 + "刷新统计"按钮
  SessionTrendChart.tsx       # 原 SVG 面积图 + hover
  ModelShareDonut.tsx         # 原环图 + buildDonutSegments
  ModelUsageTable.tsx
  HourlyClockChart.tsx        # 原同名函数组件
  ProjectList.tsx
  format.ts                   # formatCompactTokens / formatDate* / truncateText
```

拆分时保持实现不变（纯移动），这样迁移风险最小；数据仍来自 `useDashboardStore`。

## OverviewKpiRow 数据

| KPI | 来源 | 回退 |
|---|---|---|
| 请求数 | 代理汇总（`UsageSummaryCards` 当前使用的 store/invoke，range=7d） | 无数据 → "—" |
| 费用 | 同上 | "—" |
| Token | 代理 realTotal | 代理为 0 / 失败 → 本地会话近 7 天 token 之和（`tokenStats.dailyModelTokens`），并显示"本地会话"徽标 |
| 会话数 | `stats.total_sessions` | "—" |
| 活跃项目 | 近 7 天有会话的项目数（来自 `projects` 列表的最后活跃时间；如字段缺失，退化为项目总数并改标签为"项目"） | — |

实现时先读 `UsageSummaryCards.tsx` 内部的取数函数，将其提取成 hook `useUsageSummary(range, filters, refreshMs)`，让 `UsageSummaryCards` 与 `OverviewKpiRow` 共用，避免重复请求逻辑。

sparkline：代理侧如已有按天聚合（`UsageTrendChart` 的数据）则复用；否则只给本地会话 token 画 sparkline。不新增后端接口。

## /usage 页

在现有页面顶部筛选行下方加分段切换：`代理请求 | 本地会话`（默认代理请求，状态记在 URL query `?tab=session`，便于主页"查看详情"直接跳到对应 tab）。"本地会话" tab 渲染 `SessionStatsSection`；顶部的代理筛选控件在本地会话 tab 下隐藏（口径不同，不适用）。

## Dashboard.tsx 结果

标题行 + `OverviewKpiRow` + 现有模块入口 / QuickActions。删除 sessionStatsExpanded 等状态。

## 取舍

- 只选"一行 KPI"而不是在主页保留任何图表，是用户明确选择的方向；图表全部保留在 /usage，功能不丢失。
- 不统一两个数据源的口径，只在 UI 上标明来源。

## 回滚

拆出的组件独立；如需回滚，恢复 `Dashboard.tsx` 即可，/usage 新 tab 可保留。
