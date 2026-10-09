# Implement — 主页统计精简为合并 KPI

## 步骤

1. [ ] 从 `Dashboard.tsx` 纯移动拆出 `components/usage/session/*`（不改逻辑），先让主页引用新组件，确认渲染一致。
2. [ ] 提取 `useUsageSummary` hook，`UsageSummaryCards` 改为使用它（行为不变）。
3. [ ] `OverviewKpiRow` + 回退逻辑 + 来源徽标 + 骨架屏 + "查看详情"。
4. [ ] `/usage` 增加 `代理请求 | 本地会话` 切换（`?tab=session`），本地会话 tab 渲染 `SessionStatsSection`。
5. [ ] `Dashboard.tsx` 删除旧统计区，只保留 KPI 行与模块入口。
6. [ ] i18n zh/en：新增 KPI / tab 文案，清理无用键。

## 校验

```bash
npm run build
npx vitest run src/pages
```

## 手动验证

- 主页亮 / 暗主题，窗口缩窄时 KPI 换行。
- 关闭代理（无代理数据）时 Token KPI 显示本地会话徽标。
- /usage 本地会话 tab：趋势 hover、环图 hover、刷新统计按钮正常。

## 回滚点

步骤 1–2 为无行为变化的重构，可单独提交。
