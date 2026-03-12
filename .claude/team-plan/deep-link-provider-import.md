# Team Plan: deep-link-provider-import

## 概述

为 CCG Switch 添加 Deep Link Provider 导入功能：用户在浏览器点击 `ccswitch://v1/import?resource=provider&...` 链接时，应用自动唤起并弹出确认对话框，确认后将 Provider 配置写入数据库。

## Codex 分析摘要

- 技术可行性高，Provider 数据模型和 SQLite 存储层已就绪（`Database::upsert_provider()` 支持幂等写入）
- 推荐**方案 A**（cc-switch 模式）：后端统一捕获 URL → emit 事件 → 前端展示确认框 → 前端调命令导入
- 三入口模式：single-instance callback (Windows/Linux CLI args) + `on_open_url` callback + `RunEvent::Opened`
- 需新增 Rust `deeplink` 模块：`mod.rs` (类型定义) + `parser.rs` (URL解析) + `provider.rs` (Provider构建) + `utils.rs` (工具)
- 两个 Tauri 命令：`parse_deeplink` (解析预览) + `import_provider_from_deeplink` (执行导入)
- 风险：API Key 日志脱敏、重复导入幂等性、插件权限配置

## Gemini 分析摘要

- UI 流程：Detect → Confirm → Act，全局 Dialog 监听 `deeplink-import` 事件
- 组件：`DeepLinkImportDialog.tsx`，使用 DaisyUI modal + `useProviderStore`
- API Key 遮掩：前 4 位 + `...` + 后 4 位
- 字段映射：deep link `sonnetModel` → CCG `defaultSonnetModel` 等
- 导入成功后调 `loadAllProviders(true)` 强制刷新 + toast 提示
- 错误处理：监听 `deeplink-error` 事件 → toast 显示错误信息
- i18n：需同时更新 `zh.json` 和 `en.json`

## 技术方案

### 架构决策

采用**后端统一处理**模式（与 cc-switch 一致）：

1. **URL 捕获**（Rust）：通过 3 个入口统一到 `handle_deeplink_url()` → `app.emit("deeplink-import", request)` / `app.emit("deeplink-error", error)`
2. **UI 确认**（React）：全局 `DeepLinkImportDialog` 监听事件，展示确认对话框
3. **执行导入**（Rust）：前端确认后调用 `import_provider_from_deeplink` Tauri 命令写入数据库

### 关键技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| URL scheme | `ccswitch` + `ccgswitch` | 兼容 cc-switch + 品牌统一 |
| deep-link 处理模式 | 后端 emit 事件 | cc-switch 验证过的跨平台方案 |
| Provider 构建 | 直接映射到现有 Provider struct | 避免引入新的中间结构 |
| 导入接口 | 复用 `add_provider_to_db()` | 保持数据层一致性 |
| 前端 Dialog | DaisyUI modal (非 ModalDialog) | 更灵活的自定义布局 |
| 状态刷新 | `useProviderStore.loadAllProviders(true)` | Zustand 已有机制 |

## 子任务列表

### Task 1: 后端依赖与配置

- **类型**: 后端
- **文件范围**:
  - `src-tauri/Cargo.toml`
  - `src-tauri/tauri.conf.json`
  - `src-tauri/capabilities/default.json`
- **依赖**: 无
- **实施步骤**:
  1. `Cargo.toml` 添加 `tauri-plugin-deep-link = "2"`
  2. `tauri.conf.json` 的 `plugins` 添加 `"deep-link": { "desktop": { "schemes": ["ccswitch", "ccgswitch"] } }`
  3. `capabilities/default.json` 的 `permissions` 数组添加 `"deep-link:default"`
- **验收标准**: `cargo check` 通过，配置文件 JSON 格式正确

### Task 2: 前端依赖与 i18n

- **类型**: 前端
- **文件范围**:
  - `package.json` (npm install)
  - `src/types/deeplink.ts` (新建)
  - `src/locales/zh.json`
  - `src/locales/en.json`
- **依赖**: 无
- **实施步骤**:
  1. 执行 `npm install @tauri-apps/plugin-deep-link`
  2. 创建 `src/types/deeplink.ts`，定义 `DeepLinkImportRequest` 接口（字段参考 cc-switch：version, resource, app, name, endpoint, apiKey, model, haikuModel, sonnetModel, opusModel, icon, notes, homepage, enabled, config, configFormat, configUrl）
  3. `zh.json` 添加 `deeplink` 命名空间翻译（confirmImport, importSuccess, importError, parseError, fieldName/app/endpoint/apiKey/model 等标签、warning 提示文本、importing 按钮状态）
  4. `en.json` 添加对应英文翻译
- **验收标准**: TypeScript 类型无报错，i18n key 中英文一一对应

### Task 3: 后端 deeplink 模块 + 命令 + lib.rs 集成

- **类型**: 后端
- **文件范围**:
  - `src-tauri/src/deeplink/mod.rs` (新建)
  - `src-tauri/src/deeplink/parser.rs` (新建)
  - `src-tauri/src/deeplink/provider.rs` (新建)
  - `src-tauri/src/deeplink/utils.rs` (新建)
  - `src-tauri/src/commands/deeplink_commands.rs` (新建)
  - `src-tauri/src/lib.rs` (修改：添加 mod deeplink, 注册 deep-link 插件, 修改 single-instance 回调, 注册命令)
- **依赖**: Task 1
- **实施步骤**:
  1. **`deeplink/mod.rs`**:
     - 声明子模块 `pub mod parser; pub mod provider; pub mod utils;`
     - 定义 `DeepLinkImportRequest` 结构体（`#[derive(Debug, Clone, Serialize, Deserialize)]`），字段包括：version, resource, app, name, enabled, homepage, endpoint, api_key, icon, model, notes, haiku_model, sonnet_model, opus_model, config, config_format, config_url
     - 所有 Option 字段使用 `#[serde(skip_serializing_if = "Option::is_none")]`
     - `#[serde(rename_all = "camelCase")]` 确保前端兼容
  2. **`deeplink/utils.rs`**:
     - `validate_scheme(scheme: &str) -> Result<(), AppError>` — 校验 scheme 必须是 `ccswitch` 或 `ccgswitch`
     - `validate_url(url_str: &str, field_name: &str) -> Result<(), AppError>` — 校验 HTTP/HTTPS URL
     - `mask_api_key(key: &str) -> String` — 前 4 位 + `*` × 20，不足 4 位全部 `****`
     - `redact_url_for_log(url_str: &str) -> String` — 保留 scheme+host+path，query 参数只显示 key 名
     - `infer_homepage_from_endpoint(endpoint: &str) -> Option<String>` — 去掉 api. 前缀推断首页
  3. **`deeplink/parser.rs`**:
     - `parse_deeplink_url(url_str: &str) -> Result<DeepLinkImportRequest, AppError>` — 核心解析函数
     - 使用 `url::Url::parse()` 解析
     - 校验 scheme（ccswitch/ccgswitch）、version（host 必须为 v1）、path（必须为 /import）
     - 提取 query params，`resource` 必须为 `provider`（否则返回 AppError::InvalidInput）
     - 必填参数：`app`（校验为 claude/codex/gemini/opencode/openclaw）、`name`
     - 可选参数：endpoint, apiKey, model, sonnetModel, opusModel, haikuModel, homepage, icon, notes, enabled, config, configFormat, configUrl
  4. **`deeplink/provider.rs`**:
     - `build_provider_from_deeplink(request: &DeepLinkImportRequest) -> Result<Provider, AppError>` — 将 DeepLinkImportRequest 映射为 Provider
       - id: 使用 `uuid::Uuid::new_v4().to_string()`
       - app_type: `AppType::from_str(&request.app)`
       - api_key: `request.api_key.clone().unwrap_or_default()`
       - url: `request.endpoint.clone()` (取逗号分隔的第一个)
       - default_sonnet/opus/haiku_model: 从 request 映射
       - settings_config: None (暂不处理 config 合并)
       - meta: 如有 homepage 则写入 `meta["homepage"]`
       - icon: `request.icon.clone()`
       - description: `request.notes.clone()`
       - is_active: false, created_at: Utc::now()
     - `import_provider(db: &Arc<Database>, request: &DeepLinkImportRequest) -> Result<String, AppError>` — 构建 Provider + 调用 `provider_service::add_provider_to_db()` + 如 enabled=true 则调 `switch_provider_in_db()`，返回 provider_id
  5. **`commands/deeplink_commands.rs`**:
     - `#[tauri::command] pub fn parse_deeplink(url: String) -> Result<DeepLinkImportRequest, String>` — 解析 URL 返回请求结构
     - `#[tauri::command] pub fn import_provider_from_deeplink(request: DeepLinkImportRequest, state: State<AppState>) -> Result<String, String>` — 执行导入，返回 provider_id
  6. **`lib.rs` 修改**:
     - 顶部添加 `mod deeplink;`
     - 添加 `use tauri_plugin_deep_link::DeepLinkExt;` 和 `use tauri::Emitter;`
     - 添加 `use commands::deeplink_commands;`
     - 添加 `handle_deeplink_url()` 函数：解析 URL → emit("deeplink-import") 或 emit("deeplink-error")，API Key 日志脱敏
     - 修改 `single_instance::init` 回调：遍历 args 查找 ccswitch:// 或 ccgswitch:// URL，调用 `handle_deeplink_url()`
     - 在 `.plugin(tauri_plugin_single_instance::init(...))` 后添加 `.plugin(tauri_plugin_deep_link::init())`
     - setup 中添加：`#[cfg(any(target_os = "linux", all(debug_assertions, windows)))] { app.deep_link().register_all()?; }`
     - setup 中添加：`app.deep_link().on_open_url()` 回调（第二入口）
     - `generate_handler!` 中添加 `deeplink_commands::parse_deeplink, deeplink_commands::import_provider_from_deeplink,`
- **验收标准**: `cargo check` 通过，所有新结构体可序列化/反序列化

### Task 4: 前端 DeepLinkImportDialog + App.tsx 集成

- **类型**: 前端
- **文件范围**:
  - `src/services/deeplinkService.ts` (新建)
  - `src/components/providers/DeepLinkImportDialog.tsx` (新建)
  - `src/App.tsx` (修改：挂载 DeepLinkImportDialog)
- **依赖**: Task 2 + Task 3
- **实施步骤**:
  1. **`src/services/deeplinkService.ts`**:
     - 封装 Tauri 命令调用
     - `parseDeeplink(url: string): Promise<DeepLinkImportRequest>` — invoke('parse_deeplink', { url })
     - `importProviderFromDeeplink(request: DeepLinkImportRequest): Promise<string>` — invoke('import_provider_from_deeplink', { request })
  2. **`src/components/providers/DeepLinkImportDialog.tsx`**:
     - 使用 DaisyUI `modal` 组件（非 ModalDialog，以便自定义布局）
     - 状态：`request: DeepLinkImportRequest | null`, `isOpen: boolean`, `isImporting: boolean`
     - `useEffect` 中用 `listen<DeepLinkImportRequest>('deeplink-import', ...)` 监听，收到事件后 setRequest + setIsOpen(true)
     - `useEffect` 中用 `listen('deeplink-error', ...)` 监听，收到事件后显示 toast 错误
     - 对话框内容用 grid 布局展示字段：App Type、Provider Name、Endpoint（支持逗号分隔多行）、API Key（遮掩）、Model 字段（Claude 分 haiku/sonnet/opus，其他用通用 model）、Notes
     - API Key 遮掩逻辑：`key.length > 4 ? key.slice(0,4) + '*'.repeat(20) : '****'`
     - 底部黄色警告提示区
     - Cancel 按钮 + Import 按钮（导入中显示 loading）
     - 导入逻辑：调用 `deeplinkService.importProviderFromDeeplink(request)` → 成功后 `useProviderStore.getState().loadAllProviders(true)` → toast 成功 → 关闭弹窗
     - 失败时 toast 显示错误信息
  3. **`src/App.tsx` 修改**:
     - import `DeepLinkImportDialog` (直接导入，不懒加载，因为需要全局监听)
     - 在 `<>` 中 `<ThemeManager />` 和 `<RouterProvider />` 旁边添加 `<DeepLinkImportDialog />`
- **验收标准**: `npm run build` 通过，点击 deep link 能弹出确认对话框

## 文件冲突检查

| Task | 文件范围 | 冲突 |
|------|----------|------|
| Task 1 | Cargo.toml, tauri.conf.json, capabilities/default.json | 无 |
| Task 2 | package.json, types/deeplink.ts, zh.json, en.json | 无 |
| Task 3 | deeplink/*, commands/deeplink_commands.rs, lib.rs | 无（lib.rs 仅 Task 3 修改） |
| Task 4 | deeplinkService.ts, DeepLinkImportDialog.tsx, App.tsx | 无（App.tsx 仅 Task 4 修改） |

✅ 所有任务文件范围无重叠

## 并行分组

- **Layer 1** (并行): Task 1, Task 2
- **Layer 2** (依赖 Task 1): Task 3
- **Layer 3** (依赖 Task 2 + Task 3): Task 4

## Builder 数量建议

- Layer 1: 2 个 Builder 并行
- Layer 2: 1 个 Builder
- Layer 3: 1 个 Builder
- 总计最多 2 个并发 Builder
