# Team Research: Settings 页面重构

## 增强后的需求

重构 claude-switch-1.0 的 Settings 页面布局，参考 cc-switch 的模块化设计。

**目标：**
1. 删除 SpeedTestPanel、StreamCheckPanel 两个配置面板（及其后端命令）
2. 新增开机自启动配置（使用 tauri-plugin-autostart 插件）
3. 新增定时备份配置功能（通过 WebDAV 实现）
4. 重新组织 Settings 页面布局为 Tabs 模式（general, proxy, advanced, about）

**技术约束：**
- 保留现有 GlobalProxyPanel、EnvCheckerPanel、AboutPanel、ImportExportPanel
- 使用 Zustand 进行状态管理
- 后端使用 Rust + Tauri 2 + SQLite
- 前端使用 React 19 + TypeScript + TailwindCSS + DaisyUI

**验收标准：**
- Settings 页面使用 Tabs 布局，分为通用设置、代理设置、高级设置、关于
- 通用设置包含：语言、主题、导航位置、终端选择、开机自启动
- 高级设置包含：导入导出、备份列表（WebDAV 定时备份）、日志配置
- SpeedTestPanel 和 StreamCheckPanel 已从页面和后端中完全移除

---

## 约束集

### 硬约束
- [HC-1] 开机自启动使用 tauri-plugin-autostart 插件实现 — 用户确认
- [HC-2] 定时备份功能通过 WebDAV 实现（坚果云、Nextcloud 等） — 用户确认
- [HC-3] 删除 SpeedTestPanel、StreamCheckPanel 组件文件及相关后端命令 — 用户确认
- [HC-4] 后端模型 Config 必须增加对应字段以支持新配置的持久化 — Codex
- [HC-5] 开机自启动仅在 Windows 平台有完整实现 — Codex

### 软约束
- [SC-1] 前端使用 Tabs 布局，参考 cc-switch 的 SettingsPage.tsx 结构 — 建议
- [SC-2] 配置项使用 ToggleRow 组件展示开关类设置 — 建议
- [SC-3] i18n 翻译键使用 `settings.*` 命名空间 — 规范
- [SC-4] 新增配置字段应为可选 (optional) 以兼容旧配置 — 规范

### 依赖关系
- [DEP-1] `src/types/config.ts` → `src/stores/useConfigStore.ts` → `src/pages/Settings.tsx`：类型定义影响状态管理和 UI
- [DEP-2] `src/locales/zh.json` / `en.json` → 翻译需完整覆盖新增配置项
- [DEP-3] Tauri Commands → 持久化接口 (src-tauri/src/models/config.rs)

### 风险
- [RISK-1] 配置兼容性：新增 WebDAV 字段需处理旧配置的默认值填充 — 缓解：字段设为 optional
- [RISK-2] 自动启动在权限受限环境可能失败 — 缓解：前端需对错误进行显式展示
- [RISK-3] WebDAV 定时同步如果以同步阻塞方式执行可能阻塞主线程 — 缓解：使用异步任务
- [RISK-4] 删除后端命令后，旧版本数据迁移可能出现不兼容 — 缓解：保留配置迁移逻辑

---

## 成功判据
- [OK-1] Settings 页面成功切换为 Tabs 布局，URL/状态正确反映当前选中标签
- [OK-2] 代码中不再引用 SpeedTestPanel 和 StreamCheckPanel 组件，且文件已移除
- [OK-3] Config 状态中包含 launchOnStartup 布尔值及 WebDAV 配置对象
- [OK-4] i18n 完整覆盖新增加的配置项标签和描述
- [OK-5] 代理设置移动到 proxy Tab 后仍能正常启动和停止代理
- [OK-6] 构建与运行应用不会出现类型错误或运行时异常

---

## 开放问题（已解决）
- Q1: 开机自启动功能应该如何实现？ → A: 使用官方插件 tauri-plugin-autostart → 约束：[HC-1]
- Q2: 定时同步功能具体指什么？ → A: 定时备份配置（WebDAV 同步） → 约束：[HC-2]
- Q3: 删除面板后后端命令如何处理？ → A: 完全删除 → 约束：[HC-3]
- Q4: 删除面板的辅助函数或状态是否需要清理？ → A: 是，完全删除组件和后端命令

---

## 探索结果摘要

### Codex 后端探索
- 通用配置通过 Rust Config 模型存储在 SQLite app_configs 表
- 代理配置使用独立 ProxyConfig 模型，通过 proxy_server_config 键持久化
- WebDAV 配置使用独立 JSON 文件 (~/.ccg-switch/webdav.json)
- 开机自启动通过 Windows 注册表实现，需使用 tauri-plugin-autostart
- 测速与流检查命令可通过 utility_commands 调用

### Gemini 前端探索
- 当前 Settings.tsx 为单页滚动布局，直接包含多个面板组件
- 模块化面板在 src/components/settings/ 目录
- 使用 Zustand 集中式配置存储
- 建议使用 DaisyUI 的 tabs-boxed 或 tabs-lifted 组件
- Config 接口需增加 launchOnStartup 和 WebDAV 配置字段