# Team Plan: Settings 页面重构

## 概述
将 Settings 页面从单页滚动布局重构为 Tabs 模式（General/Proxy/Advanced/About），删除 SpeedTest 和 StreamCheck 面板，新增开机自启动和 WebDAV 备份配置。

## Codex 分析摘要
- `speedtest_service.rs` 仅被 `test_endpoint_speed` 命令使用，是孤立模块，可安全完全删除
- **`stream_check_service.rs` 不可删除**：`check_stream_connectivity` 被 `ProviderForm.tsx` 使用，`check_provider_health` 被 `provider_commands.rs` 使用，是 Provider 健康检查的核心依赖
- Auto Launch / WebDAV 后端已完整实现，无需新增后端服务
- Config 模型扩展需使用 `#[serde(default)]` 保证旧配置兼容性
- 建议 `get_auto_launch_status` 作为自启动状态的单一真相源

## Gemini 分析摘要
- 推荐 DaisyUI `tabs-boxed` 样式，深浅模式下对比度良好
- Settings.tsx 精简为 Tab 框架，具体内容提取到子组件
- 新增 `src/types/advanced.ts`（WebDavConfig, AutoLaunchStatus 接口）
- 新增 `src/services/advancedService.ts` 封装 invoke 调用
- AutoLaunch 在非 Windows 平台应展示「不支持」提示或隐藏
- Tab 切换无需持久化到 localStorage（低优先级）

## 技术方案

### 关键决策
1. **stream_check_service.rs 保留**：仅删除前端 StreamCheckPanel 组件，后端服务和命令保留给 Provider 功能使用
2. **Config 模型不扩展**：AutoLaunch 状态由独立命令管理（`get_auto_launch_status`），不纳入 Config 模型，避免 Config 与系统状态不一致
3. **WebDAV 配置独立存储**：继续使用 `~/.ccg-switch/webdav.json`，不并入 Config 模型
4. **Tabs 使用本地 state**：`useState<'general'|'proxy'|'advanced'|'about'>` 管理，不引入路由参数

## 子任务列表

### Task 1: 后端清理 - 删除 SpeedTest 全链路
- **类型**: 后端 (Rust)
- **文件范围**:
  - `src-tauri/src/services/speedtest_service.rs` (删除整个文件)
  - `src-tauri/src/services/mod.rs` (删除 `pub mod speedtest_service;` 行)
  - `src-tauri/src/commands/utility_commands.rs` (删除 `test_endpoint_speed` 函数和 `speedtest_service` import)
  - `src-tauri/src/lib.rs` (删除 `utility_commands::test_endpoint_speed` 注册项)
- **依赖**: 无
- **实施步骤**:
  1. 删除 `src-tauri/src/services/speedtest_service.rs` 文件
  2. 从 `src-tauri/src/services/mod.rs` 删除 `pub mod speedtest_service;`
  3. 从 `src-tauri/src/commands/utility_commands.rs` 顶部 use 语句删除 `speedtest_service`，删除 `test_endpoint_speed` 函数
  4. 从 `src-tauri/src/lib.rs` 的 `generate_handler![]` 删除 `utility_commands::test_endpoint_speed`
- **验收标准**: `cargo check` 编译通过，无 speedtest_service 相关引用残留

### Task 2: 新增前端类型与服务文件
- **类型**: 前端 (TypeScript)
- **文件范围**:
  - `src/types/advanced.ts` (新建)
  - `src/services/advancedService.ts` (新建)
- **依赖**: 无
- **实施步骤**:
  1. 创建 `src/types/advanced.ts`，定义：
     ```typescript
     export interface WebDavConfig {
       enabled: boolean;
       serverUrl?: string;
       username?: string;
       password?: string;
       remotePath?: string;
       lastSyncAt?: string;
     }
     export interface AutoLaunchStatus {
       enabled: boolean;
       supported: boolean;
     }
     ```
  2. 创建 `src/services/advancedService.ts`，封装四个 invoke 调用：
     ```typescript
     import { invoke } from '@tauri-apps/api/core';
     import { WebDavConfig, AutoLaunchStatus } from '../types/advanced';

     export async function getWebDavConfig(): Promise<WebDavConfig> {
       return invoke<WebDavConfig>('get_webdav_config');
     }
     export async function saveWebDavConfig(config: WebDavConfig): Promise<void> {
       return invoke('save_webdav_config', { config });
     }
     export async function getAutoLaunchStatus(): Promise<AutoLaunchStatus> {
       return invoke<AutoLaunchStatus>('get_auto_launch_status');
     }
     export async function setAutoLaunch(enabled: boolean): Promise<void> {
       return invoke('set_auto_launch', { enabled });
     }
     ```
- **验收标准**: TypeScript 类型检查通过，import 路径正确

### Task 3: i18n 翻译更新
- **类型**: 前端 (JSON)
- **文件范围**:
  - `src/locales/zh.json` (修改 settings 命名空间)
  - `src/locales/en.json` (修改 settings 命名空间)
- **依赖**: 无
- **实施步骤**:
  1. 在 `zh.json` 的 `settings` 对象中新增：
     ```json
     "tab_general": "通用",
     "tab_proxy": "代理",
     "tab_advanced": "高级",
     "tab_about": "关于",
     "auto_launch": "开机自启动",
     "auto_launch_hint": "在系统登录时自动启动应用",
     "auto_launch_unsupported": "当前系统不支持自启动",
     "webdav_title": "WebDAV 备份",
     "webdav_enabled": "启用云端同步",
     "webdav_url": "服务器地址",
     "webdav_url_placeholder": "https://dav.jianguoyun.com/dav/",
     "webdav_username": "用户名",
     "webdav_password": "密码/应用令牌",
     "webdav_path": "远端目录",
     "webdav_path_placeholder": "/ccg-switch-backup/",
     "webdav_save_success": "WebDAV 配置保存成功",
     "webdav_save_failed": "WebDAV 配置保存失败",
     "webdav_last_sync": "最后同步: {{time}}",
     "webdav_never_synced": "尚未同步"
     ```
  2. 在 `en.json` 的 `settings` 对象中新增对应英文翻译
  3. 删除仅被 SpeedTestPanel/StreamCheckPanel 使用的 i18n 键（如 `speedTest`, `testSpeed`, `latency`, `status`, `streamCheck`, `checkStream`, `modelName`, `available`, `unavailable`, `endpointUrl`, `apiKey` 等），需先确认无其他组件引用
- **验收标准**: 所有新增键在 zh/en 文件中均有对应值，无遗漏

### Task 4: 新增 WebDavBackupPanel 组件
- **类型**: 前端 (React)
- **文件范围**:
  - `src/components/settings/WebDavBackupPanel.tsx` (新建)
- **依赖**: Task 2 (需要 types/advanced.ts 和 services/advancedService.ts)
- **实施步骤**:
  1. 创建 `WebDavBackupPanel.tsx` 组件，包含：
     - 启用/禁用 toggle
     - 表单字段: serverUrl (input), username (input), password (input type=password), remotePath (input)
     - lastSyncAt 只读展示
     - 保存按钮（调用 saveWebDavConfig）
  2. 使用 `useState` 管理表单状态和 loading
  3. `useEffect` 初始化时调用 `getWebDavConfig()` 加载配置
  4. 保存成功/失败显示 toast 提示
  5. UI 风格与现有面板一致：卡片容器 + 表单项
  6. **安全**: password 字段不回显原始值到 UI 日志
- **验收标准**: 面板正确加载/保存 WebDAV 配置，表单校验正常，UI 风格统一

### Task 5: Settings 页面 Tabs 重构
- **类型**: 前端 (React)
- **文件范围**:
  - `src/pages/Settings.tsx` (重写)
  - `src/components/settings/SpeedTestPanel.tsx` (删除)
  - `src/components/settings/StreamCheckPanel.tsx` (删除)
- **依赖**: Task 2, Task 3, Task 4
- **实施步骤**:
  1. 删除 `SpeedTestPanel.tsx` 和 `StreamCheckPanel.tsx` 文件
  2. 重写 `Settings.tsx`：
     - 引入 `useState` 管理 `activeTab`
     - 页面顶部标题保留（Settings 图标 + 标题）
     - 标题下方渲染 DaisyUI `tabs tabs-boxed` 组件，四个 Tab
     - 根据 `activeTab` 条件渲染对应内容：
       - **General**: 保留现有外观设置代码（主题/语言/导航位置/终端） + 新增 AutoLaunch toggle 区域
       - **Proxy**: `<GlobalProxyPanel />`
       - **Advanced**: `<ImportExportPanel />` + `<WebDavBackupPanel />` + `<EnvCheckerPanel />`
       - **About**: `<AboutPanel />`
  3. AutoLaunch toggle 实现：
     - `useEffect` 调用 `getAutoLaunchStatus()` 获取初始状态
     - toggle 切换时调用 `setAutoLaunch(enabled)`
     - `supported === false` 时显示提示文字并禁用 toggle
     - 错误时显示提示
  4. 删除旧的 SpeedTestPanel/StreamCheckPanel import
- **验收标准**:
  - 四个 Tab 正确切换，内容渲染无误
  - General Tab 自启动 toggle 正常工作
  - Proxy Tab 代理功能不受影响
  - Advanced Tab 三个面板正常显示
  - About Tab 正常显示
  - 无 SpeedTestPanel/StreamCheckPanel 引用残留
  - `npm run build` 编译通过

## 文件冲突检查
✅ 无冲突 - 所有任务文件范围互不重叠：
- Task 1: 仅 `src-tauri/` 后端文件
- Task 2: 仅 `src/types/advanced.ts` + `src/services/advancedService.ts`（新建）
- Task 3: 仅 `src/locales/zh.json` + `src/locales/en.json`
- Task 4: 仅 `src/components/settings/WebDavBackupPanel.tsx`（新建）
- Task 5: 仅 `src/pages/Settings.tsx` + 删除两个面板文件

## 并行分组
- **Layer 1** (并行): Task 1, Task 2, Task 3
- **Layer 2** (依赖 Layer 1): Task 4
- **Layer 3** (依赖 Layer 1 + Task 4): Task 5

## Builder 数量建议
- Layer 1: 3 个 Builder 并行
- Layer 2: 1 个 Builder
- Layer 3: 1 个 Builder
- 总计: 最多 3 个并行 Builder
