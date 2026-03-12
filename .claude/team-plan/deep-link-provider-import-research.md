# Team Research: deep-link-provider-import

## 增强后的需求

**目标**: 为 CCG Switch 添加深度链接 (Deep Link) 协议导入功能，支持通过浏览器粘贴 URL 自动导入 Provider 配置到应用中。

**协议格式**: `ccswitch://v1/import?resource=provider&app=claude&name=...&endpoint=...&apiKey=...`

**协议兼容**: 同时支持 `ccswitch://` 和 `ccgswitch://` 两种协议 scheme

**资源范围**: 仅 Provider (服务商) 导入

**参数兼容**: 完整兼容 cc-switch 的所有参数，包括高级参数 (base64 config, configUrl, multi-endpoint, usage script 等)

**参考实现**: `C:\guodevelop\demo\cc-switch` 项目已有完整实现

## 约束集

### 硬约束

- [HC-1] 必须注册两个 URL scheme: `ccswitch` + `ccgswitch` — 来源：用户
- [HC-2] 仅支持 `resource=provider` 类型导入，其他类型可忽略或提示不支持 — 来源：用户
- [HC-3] 完整兼容 cc-switch 的 Provider URL 参数 (app, name, endpoint, apiKey, model, haikuModel, sonnetModel, opusModel, homepage, enabled, notes, icon, config, configFormat, configUrl, usageEnabled, usageScript 等) — 来源：用户
- [HC-4] Tauri deep-link 插件需要 `tauri-plugin-deep-link = "2"` (Rust) + `@tauri-apps/plugin-deep-link` (npm) — 来源：Codex 探索
- [HC-5] Windows/Linux 平台需要在 `tauri-plugin-single-instance` 回调中处理 deep link URL 参数传递 (第二次启动时 URL 在 args 中) — 来源：cc-switch 参考实现
- [HC-6] CCG Switch 的 Provider 已使用 SQLite 数据库存储 (`providers` 表)，导入必须走 `ProviderService::add_provider_to_db()` — 来源：Gemini 探索
- [HC-7] Provider 的 AppType 枚举为 Claude/Codex/Gemini/OpenCode/OpenClaw，深度链接 app 参数必须映射到这些类型 — 来源：代码探索
- [HC-8] 导入前必须显示确认对话框，展示解析后的配置详情，用户点击"导入"后才执行 — 来源：用户 (截图)
- [HC-9] API Key 在日志中必须脱敏，不可明文输出 — 来源：安全要求
- [HC-10] CCG Switch 已有 `tauri-plugin-single-instance`，deep link 必须与其配合 (第二实例启动时传递 URL 到已运行实例) — 来源：代码探索

### 软约束

- [SC-1] 确认对话框 UI 应与 cc-switch 截图风格一致 (深色主题，分行展示各字段，API Key 遮掩) — 来源：用户截图
- [SC-2] 导入成功后应自动刷新 Provider 列表 (invalidate Zustand store) — 来源：惯例
- [SC-3] 解析失败应显示 toast 错误提示 — 来源：cc-switch 参考
- [SC-4] 前端组件命名按项目惯例使用 PascalCase，Rust 代码使用 snake_case — 来源：CLAUDE.md 规范
- [SC-5] 新增 Tauri 命令需注册到 `lib.rs` 的 `generate_handler!` 宏 — 来源：CLAUDE.md

### 依赖关系

- [DEP-1] Rust deep-link 模块 → `tauri-plugin-deep-link` crate + `tauri-plugin-single-instance` (已有)
- [DEP-2] Rust URL 解析 → `url` crate (需新增到 Cargo.toml)
- [DEP-3] Provider 导入逻辑 → 现有 `ProviderService::add_provider_to_db()` + `sync_provider_to_app_config()`
- [DEP-4] 前端 DeepLinkImportDialog → 现有 `useProviderStore` (刷新列表)
- [DEP-5] 前端 Dialog → 现有 `ModalDialog` 通用组件或 DaisyUI modal

### 风险

- [RISK-1] Windows 上 deep-link 注册需要管理员权限或注册表操作，开发模式下需要 `app.deep_link().register_all()` 显式注册 — 缓解：参照 cc-switch 在 debug 模式下调用 register_all()
- [RISK-2] 两个 scheme (ccswitch + ccgswitch) 可能与 cc-switch 应用冲突（如果两个 app 都注册了 ccswitch://）— 缓解：后注册的覆盖先注册的，用户需注意
- [RISK-3] base64 参数在 URL 传递时可能被浏览器 URL encode（+ 变空格等）— 缓解：参照 cc-switch 的 `decode_base64_param()` 鲁棒解码

## 成功判据

- [OK-1] 浏览器中打开 `ccswitch://v1/import?resource=provider&app=claude&name=Test&endpoint=http://example.com&apiKey=sk-test&model=test` 能唤起 CCG Switch 并显示导入确认对话框
- [OK-2] 浏览器中打开 `ccgswitch://v1/import?resource=provider&...` 同样能唤起并显示对话框
- [OK-3] 确认对话框正确展示所有解析字段 (名称、应用类型、端点、API Key 遮掩、模型映射)
- [OK-4] 点击"导入"后 Provider 写入数据库，刷新列表可见
- [OK-5] enabled=true 时导入后自动切换为活跃 Provider (同步到 settings.json)
- [OK-6] 应用已运行时，再次点击链接不会开第二个窗口，而是将 URL 传递给已运行实例
- [OK-7] 编译通过 (`cargo check` + `npm run build`)

## 开放问题（已解决）

- Q1: 支持哪些资源类型？→ A: 仅 Provider → 约束：[HC-2]
- Q2: URL 参数兼容程度？→ A: 完整兼容 cc-switch → 约束：[HC-3]

## 参考文件索引

### cc-switch 参考 (C:\guodevelop\demo\cc-switch)

| 文件 | 作用 |
|------|------|
| `src-tauri/tauri.conf.json` | deep-link 插件配置 (schemes) |
| `src-tauri/Cargo.toml` | tauri-plugin-deep-link 依赖 |
| `src-tauri/src/lib.rs` | 3 个入口 + handle_deeplink_url() + register_all() |
| `src-tauri/src/deeplink/mod.rs` | DeepLinkImportRequest 数据模型 |
| `src-tauri/src/deeplink/parser.rs` | URL 解析 (scheme/version/path/params) |
| `src-tauri/src/deeplink/provider.rs` | Provider 导入逻辑 + 各 AppType 的 settings 构建 |
| `src-tauri/src/deeplink/utils.rs` | URL 校验 + base64 解码 + homepage 推断 |
| `src-tauri/src/commands/deeplink.rs` | Tauri 命令 (parse_deeplink, import_from_deeplink_unified) |
| `src/components/DeepLinkImportDialog.tsx` | 前端确认对话框 |
| `src/lib/api/deeplink.ts` | 前端 API 封装 |

### ccg-switch 现有 (C:\guodevelop\claude-switch-v1\claude-switch-1.0)

| 文件 | 作用 |
|------|------|
| `src-tauri/Cargo.toml` | 需添加 tauri-plugin-deep-link + url crate |
| `src-tauri/tauri.conf.json` | 需添加 deep-link 插件配置 |
| `src-tauri/capabilities/default.json` | 需添加 deep-link 权限 |
| `src-tauri/src/lib.rs` | 需添加 deep-link 插件注册 + URL 处理 |
| `src-tauri/src/models/provider.rs` | 现有 Provider 模型 (导入目标) |
| `src-tauri/src/services/provider_service.rs` | 现有 add_provider_to_db / switch_provider_in_db |
| `src-tauri/src/commands/provider_commands.rs` | 现有 Provider 命令 |
| `src/stores/useProviderStore.ts` | 现有 Zustand store (刷新) |
| `src/types/provider.ts` | 现有 Provider TypeScript 类型 |
| `src/App.tsx` | 需挂载 DeepLinkImportDialog |
