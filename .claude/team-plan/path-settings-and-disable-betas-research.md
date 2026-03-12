# Team Research: 路径设置 + 禁用实验性Beta + 禁用工具搜索配置

## 增强后的需求

### 需求1：路径配置功能
在 Settings > Advanced 标签页中新增"配置目录"面板，允许用户自定义以下 4 个路径：

| # | 配置项 | 默认路径 | 影响范围 |
|---|--------|----------|----------|
| 1 | 应用配置目录 | `~/.ccg-switch` | 数据库、JSON配置、日志、备份等 |
| 2 | Claude Code 配置目录 | `~/.claude` | settings.json、.claude.json、prompts、skills、agents |
| 3 | Codex 配置目录 | `~/.codex` | auth.json、config.toml、MCP |
| 4 | Gemini 配置目录 | `~/.gemini` | .env、settings.json |

每个路径输入框配备：文本输入 + 文件夹浏览按钮（需 tauri-plugin-dialog）+ 重置按钮。

### 需求2：CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS 配置
在 ProviderForm 的 Claude 内部设置区域（快捷配置按钮组），"禁用归因头"复选框**旁边**新增"禁用实验性 Beta"复选框。

- 勾选时：写入 `env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = "1"`
- 取消时：从 env 中移除该 key

### 需求3：ENABLE_TOOL_SEARCH 配置
在 ProviderForm 的 Claude 内部设置区域，新增"禁用工具搜索"复选框，放在"禁用实验性 Beta"旁边。

- 勾选时（禁用工具搜索）：写入 `env.ENABLE_TOOL_SEARCH = "false"`
- 取消时（启用工具搜索）：从 env 中移除该 key（默认启用）

---

## 约束集

### 硬约束

- [HC-1] **InternalSettings 接口扩展** — `ProviderForm.tsx:41-47` 的 `InternalSettings` 接口必须新增 `disableExperimentalBetas?: boolean` 和 `disableToolSearch?: boolean` — 来源：Codex+Gemini
- [HC-2] **knownKeys 白名单（2处）** — `ProviderForm.tsx:148` 和 `:227` 两处 knownKeys 数组必须同时添加 `'disableExperimentalBetas'` 和 `'disableToolSearch'`，遗漏任一处将导致字段无法保存或读取 — 来源：Codex
- [HC-3] **默认值初始化（2处）** — `ProviderForm.tsx:98-104`（初始状态）和 `:130-136`（编辑重置）两处默认对象必须包含 `disableExperimentalBetas: false` 和 `disableToolSearch: false` — 来源：Codex
- [HC-4] **remap_settings_to_env 扩展** — `provider_service.rs:253-310` 必须新增两个映射：①`disableExperimentalBetas` → `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = "1"`（true时写入/false时移除）②`disableToolSearch` → `ENABLE_TOOL_SEARCH = "false"`（true时写入"false"/false时移除） — 来源：Codex
- [HC-5] **get_claude_settings_state 扩展** — `provider_service.rs:316-340` 必须新增：①从 env 读取 `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` 返回布尔值 ②从 env 读取 `ENABLE_TOOL_SEARCH`，值为 `"false"` 时返回 true — 来源：Codex
- [HC-5a] **ENABLE_TOOL_SEARCH 反向语义** — 该变量语义为"启用工具搜索"，但 UI 展示为"禁用工具搜索"复选框，因此映射逻辑是**反向**的：checkbox=true → env 值 `"false"`；checkbox=false → 移除 key（恢复默认启用） — 来源：语义分析
- [HC-6] **tauri-plugin-dialog 三处注册** — 需同时修改：①`Cargo.toml` 添加依赖 ②`lib.rs` 添加 `.plugin(tauri_plugin_dialog::init())` ③`tauri.conf.json` 或 capabilities 添加权限 — 来源：Codex+Gemini
- [HC-7] **@tauri-apps/plugin-dialog 前端依赖** — `package.json` 需添加 `@tauri-apps/plugin-dialog` 以在前端调用 `open()` API — 来源：Gemini
- [HC-8] **Config 结构体扩展** — `models/config.rs` 的 Config struct 需新增 4 个 `Option<String>` 路径字段，带 `#[serde(default)]` 确保向后兼容 — 来源：Codex
- [HC-9] **Config TS 类型同步** — `types/config.ts` 的 Config 接口需同步新增 4 个可选路径字段 — 来源：Gemini
- [HC-10] **应用配置目录引导问题** — 数据库路径 (`~/.ccg-switch/ccg-switch.db`) 位于应用配置目录内，而路径配置本身存储在数据库中。必须使用**独立于数据库的存储**（如固定位置文件或 Tauri Store）来保存应用配置目录覆盖路径，避免鸡生蛋问题 — 来源：Codex
- [HC-11] **路径解析需处理 ~ 前缀** — 后端需实现 `resolve_override_path()` 函数，将 `~` 展开为 `home_dir()`，其他值视为绝对路径 — 来源：参考项目
- [HC-12] **env 变量语义 "1"=启用** — `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` 的值应为 `"1"` 表示启用（禁用实验性Beta），遵循同类变量 `DISABLE_NONESSENTIAL_TRAFFIC` 的语义约定 — 来源：Codex
- [HC-13] **ENABLE_TOOL_SEARCH 值为 "false"** — 与其他 DISABLE 类变量不同，`ENABLE_TOOL_SEARCH` 是正向语义变量，禁用时值为 `"false"` 字符串而非 `"1"` — 来源：用户指定

### 软约束

- [SC-1] **面板插入位置** — DirectorySettingsPanel 应插入 Settings.tsx Advanced 标签页中，位于 `ImportExportPanel` 之前（最显眼位置） — 来源：用户确认
- [SC-2] **样式一致性** — 新面板使用现有卡片样式：`bg-white dark:bg-base-100 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-base-200` — 来源：Gemini
- [SC-3] **复选框样式一致** — 新 checkbox 使用与现有 `disableAttributionHeader` 完全相同的 className — 来源：Gemini
- [SC-4] **advancedService 封装** — 新增 Tauri 命令应封装在 `advancedService.ts` 中 — 来源：Gemini
- [SC-5] **i18n 双语** — 所有新增文案需同时更新 `zh.json` 和 `en.json` — 来源：项目规范
- [SC-6] **路径配置存储复用 app_configs** — 路径配置存入 Config 结构体，通过现有 `save_config`/`get_config` 命令持久化到 `app_configs` 表，无需新建表或命令 — 来源：Codex
- [SC-7] **渐进式路径覆盖** — 初期仅让核心写入路径（provider切换写入的 settings.json/auth.json/.env）和 MCP 同步尊重路径覆盖；Prompt/Skills/Dashboard/Usage 等可后续迭代 — 来源：风险缓解策略

### 依赖关系

- [DEP-1] `tauri-plugin-dialog` 注册 → DirectorySettingsPanel 文件夹浏览功能
- [DEP-2] Config struct 扩展 → 前端 Config 类型同步 → DirectorySettingsPanel 组件开发
- [DEP-3] 应用配置目录引导方案确定 → Config 存储实现
- [DEP-4] InternalSettings 接口扩展 → ProviderForm checkbox UI → remap_settings_to_env 后端映射

### 风险

- [RISK-1] **路径覆盖覆盖不完全** — 当前有 20+ 个 service 文件硬编码 `dirs::home_dir()` 路径，若只改核心路径（provider_service/mcp），其他功能（Dashboard统计、Usage日志、Skills同步等）仍用旧路径 — 缓解：采用 [SC-7] 渐进式策略，核心路径先行，后续迭代补全
- [RISK-2] **DB路径迁移风险** — 若允许修改应用配置目录并迁移DB，存在数据丢失风险 — 缓解：初期仅支持外部工具路径覆盖；应用配置目录改动需重启，且引导配置存于固定位置
- [RISK-3] **tauri-plugin-dialog 权限遗漏** — 仅添加依赖不配置 capabilities 会导致运行时权限错误 — 缓解：明确在 plan 中列出三处修改点
- [RISK-4] **环境变量语义误判** — `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` 的实际语义需与 Claude Code CLI 一致 — 缓解：值使用 `"1"` 表示启用禁用，与同类变量保持一致
- [RISK-5] **向后兼容** — 老用户 Config JSON 无路径字段，升级后 serde 反序列化需正确填充默认值 — 缓解：所有新字段使用 `#[serde(default)]` + `Option<String>`

---

## 修改文件清单

### 需求2+3（CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS + ENABLE_TOOL_SEARCH）— 影响范围小

| 文件 | 修改内容 |
|------|----------|
| `src/components/providers/ProviderForm.tsx` | InternalSettings 接口 + 默认值(2处) + knownKeys(2处) + 2个checkbox UI |
| `src-tauri/src/services/provider_service.rs` | remap_settings_to_env(2个新映射) + get_claude_settings_state(2个新字段) |
| `src/locales/zh.json` | 新增翻译键 |
| `src/locales/en.json` | 新增翻译键 |

### 需求1（路径配置）— 影响范围中等

| 文件 | 修改内容 |
|------|----------|
| `src-tauri/Cargo.toml` | 添加 `tauri-plugin-dialog = "2"` |
| `package.json` | 添加 `@tauri-apps/plugin-dialog` |
| `src-tauri/src/lib.rs` | 注册 dialog 插件 + 新增 `pick_directory` 命令 |
| `src-tauri/src/models/config.rs` | Config struct 添加 4 个路径字段 |
| `src/types/config.ts` | Config 接口添加 4 个路径字段 |
| `src/components/settings/DirectorySettingsPanel.tsx` | 新建组件 |
| `src/pages/Settings.tsx` | Advanced 标签引入 DirectorySettingsPanel |
| `src/locales/zh.json` | 路径设置相关翻译 |
| `src/locales/en.json` | 路径设置相关翻译 |

### 渐进式路径覆盖（核心路径）

| 文件 | 修改内容 |
|------|----------|
| `src-tauri/src/services/provider_service.rs` | `get_claude_settings_path`、`sync_to_*` 系列函数尊重路径覆盖 |
| `src-tauri/src/mcp/utils.rs` | `home_dir()` 系列函数增加路径覆盖支持 |
| `src-tauri/src/mcp/claude.rs` | 使用统一路径解析 |
| `src-tauri/src/mcp/codex.rs` | 使用统一路径解析 |
| `src-tauri/src/mcp/gemini.rs` | 使用统一路径解析 |

---

## 成功判据

- [OK-1] ProviderForm Claude 模式下，"禁用归因头"旁边出现"禁用实验性 Beta"和"禁用工具搜索"复选框
- [OK-2] 勾选"禁用实验性 Beta"并保存/切换后，`~/.claude/settings.json` 的 `env` 中出现 `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: "1"`
- [OK-3] 取消勾选并保存/切换后，该 key 从 env 中移除
- [OK-3a] 勾选"禁用工具搜索"并保存/切换后，`env` 中出现 `ENABLE_TOOL_SEARCH: "false"`
- [OK-3b] 取消勾选"禁用工具搜索"并保存/切换后，`ENABLE_TOOL_SEARCH` 从 env 中移除
- [OK-4] 重新打开编辑表单时，两个新复选框状态与 settings.json 一致
- [OK-5] Settings > Advanced 出现"配置目录"面板，包含 4 个路径输入框
- [OK-6] 点击浏览按钮弹出原生文件夹选择对话框
- [OK-7] 点击重置按钮恢复默认路径
- [OK-8] 保存路径配置后重启应用，路径设置保持不变
- [OK-9] 修改 Claude 路径后，Provider 切换时 settings.json 写入新路径
- [OK-10] 应用编译通过 (`npm run tauri build`)
- [OK-11] 中英文切换正常，无 hardcode 文字

## 开放问题（已解决）

- Q1: 需要哪些路径？ → A: 4个（应用配置 + Claude + Codex + Gemini，不含 OpenCode） → 约束：[HC-8]
- Q2: UI 放在哪里？ → A: Settings > Advanced 标签页 → 约束：[SC-1]
- Q3: 是否需要文件夹浏览器？ → A: 需要，添加 tauri-plugin-dialog → 约束：[HC-6], [HC-7]
- Q4: 路径覆盖范围多大？ → A: 采用渐进策略，先覆盖核心写入路径 → 约束：[SC-7]

---

## 关键代码定位

### ProviderForm.tsx 修改点精确位置

| 修改点 | 行号 | 描述 |
|--------|------|------|
| InternalSettings 接口 | 41-47 | 新增 `disableExperimentalBetas?: boolean` 和 `disableToolSearch?: boolean` |
| 默认值初始化 #1 | 98-104 | 新增 `disableExperimentalBetas: false, disableToolSearch: false` |
| knownKeys #1 | 148 | 数组中追加 `'disableExperimentalBetas', 'disableToolSearch'` |
| knownKeys #2 | 227 | 数组中追加 `'disableExperimentalBetas', 'disableToolSearch'` |
| Checkbox UI | 605 之后 | 在"禁用归因头"label 后新增 2 个 checkbox |

### provider_service.rs 修改点精确位置

| 修改点 | 行号 | 描述 |
|--------|------|------|
| 布尔值提取 | 261-263 之后 | 新增 `let disable_betas = ...` 和 `let disable_tool_search = ...` |
| 顶层移除 | 271-276 之间 | 新增 `obj.remove("disableExperimentalBetas")` 和 `obj.remove("disableToolSearch")` |
| env 写入 | 295-301 之后 | 新增 CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS(true→"1") + ENABLE_TOOL_SEARCH(true→"false") |
| 状态读取 | 328-338 之间 | 新增 `"disableExperimentalBetas": env == "1"` 和 `"disableToolSearch": env == "false"` |
