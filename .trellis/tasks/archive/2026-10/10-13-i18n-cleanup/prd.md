# 页面硬编码中文改多语言 (i18n 清理)

## Goal

将前端中尚未国际化的硬编码中文（主要分布在代理相关组件、服务商页与卡片/弹窗组件、技能管理页）全部重构为 `useTranslation` 的 `t(...)` 调用，并在 `src/locales/zh.json` 与 `src/locales/en.json` 中补齐中英文双语翻译，实现界面语言平滑切换无中文硬编码残留。

## Requirements

1. **代理模块 (`src/components/proxy/` & `src/pages/ProxyPage.tsx`)**：
   - `ProxyStatus.tsx`: 运行状态、监听地址/端口提示、接管模式说明、启停控制按钮与 Toast 提示。
   - `ProxyConfig.tsx`: 代理设置表单、端口范围校验提示、保存成功/失败 Toast。
   - `FailoverQueue.tsx`: 故障转移队列状态、说明文案、移除/加入 Toast、空状态。
   - `CircuitBreakerPanel.tsx`: 熔断状态标签（闭合/断开/半开）、说明与占位提示。

2. **服务商模块 (`src/pages/ProvidersPage.tsx` & `src/components/providers/`)**：
   - `ProvidersPage.tsx`: 顶部操作提示、应用终端打开与错误 Toast、列表与卡片视图文字。
   - `ProviderForm.tsx`: 表单校验错误提示、高级配置字段提示、模型选择提示。
   - `ProviderCard.tsx`: 操作按钮 title、健康状态、测试延迟、复制操作。
   - `ClaudeDesktopPanel.tsx`: 接管状态条、网关信息、重启提示、还原配置确认与 Toast。
   - `UniversalProviderPanel.tsx`: 通用服务商配置说明、批量操作按钮与提示。
   - `ProviderProxyConfig.tsx` / `UsageFooter.tsx` / `UsageScriptModal.tsx` / `DeepLinkImportDialog.tsx`: 代理设置、额度脚本与 DeepLink 导入相关提示。

3. **技能模块 (`src/pages/SkillsPage.tsx`)**：
   - 顶部操作：从分享码导入、扫描导入、复制清单、添加仓库、发现技能等按钮与状态。
   - 提示消息：扫描结果 Toast、复制成功/失败 Toast、更新全部与 ZIP 安装反馈提示。
   - 视图标签与排序：已安装 / 发现 / 仓库管理 / 本地文件，按 Star 推荐 / 按名称排序。
   - 各模态弹窗：导入弹窗、沙箱测试、差异对比更新、添加仓库错误提示。

4. **语言包补齐 (`src/locales/zh.json` & `en.json`)**：
   - 统一命名空间：`proxy.*`、`providers.*`、`skills.*`。
   - 保持中英文对应，避免孤立键。

## Acceptance Criteria

- [ ] 代理、服务商、技能相关组件中无直接渲染的裸中文字符串（除代码注释与外部动态数据）。
- [ ] 中文语言环境下文字正常展示，英文语言环境下显示对应英译文。
- [ ] `npm test` 前端单测全部通过。
- [ ] `npm run build` 前端编译打包零类型错误通过。
