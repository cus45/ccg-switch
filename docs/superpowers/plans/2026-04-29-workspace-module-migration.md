# Workspace Module Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `C:\guodevelop\demo\CodexDesktop-Rebuild` 的核心功能拆分并迁移到 `C:\guodevelop\ccg-switch`，作为独立的工作空间模块，并为后续接入更多模型和本地客户端预留扩展边界。

**Architecture:** 不直接搬运 Electron 打包产物，而是在 CCG Switch 的 Tauri + React + SQLite 架构内重建语义等价能力。迁移边界分为 `Workspace Core`、`Session/Conversation Core`、`CodexBridge`、`Model/App Adapter Registry`、`Capability Binding`、`Terminal/Git/Automation` 等模块；数据库是主存储，外部 CLI 配置文件只作为同步目标。

**Tech Stack:** Tauri 2、Rust、SQLite、React 19、TypeScript、Zustand、i18next、lucide-react、Tailwind / daisyUI。

---

## 0. 当前事实

### 0.1 目标项目事实

- `C:\guodevelop\demo\CodexDesktop-Rebuild` 是 Electron Forge 项目，主入口是 `src\.vite\build\main.js`，前端是 `src\webview\assets\*.js`，不是常规源码态 React 项目。
- 目标项目的核心不是“前端直接调用模型 API”，而是 `webview -> preload/electronBridge -> main process -> Codex app server / CLI`。
- 目标项目包含以下用户可见能力：
  - workspace roots 管理和 `cwd` 注入。
  - thread / turn / streaming item 事件。
  - command、file change、MCP tool、user input approval。
  - config / model list / reasoning effort。
  - MCP server 配置、状态和 OAuth。
  - skills、recommended skills。
  - Git branch / push / PR message / diff。
  - Codex-managed worktrees。
  - local environment `environment.toml`。
  - automations、automation runs、inbox、memory。
  - terminal sessions。
  - Electron shell 能力：pick file、open external、context menu、window / hotkey / updater。

### 0.2 当前项目事实

- `C:\guodevelop\ccg-switch` 是 Tauri 2 + React + SQLite 应用。
- 前端已有一级路由 `/workspaces`：`src\App.tsx` 已懒加载 `src\pages\WorkspacesPage.tsx`。
- 侧边栏已有工作空间入口：`src\components\layout\Sidebar.tsx`。
- 当前 `WorkspacesPage.tsx` 更像“会话历史浏览器”，数据来自 dashboard / session 扫描，不是持久化 workspace 实体。
- 当前已有统一会话层：`src-tauri\src\session_manager\`，支持 Claude / Codex / Gemini 会话扫描和消息读取。
- 当前数据库主 schema 在 `src-tauri\src\database\schema.rs`，已有 `providers`、`mcp_servers`、`skills`、`prompts`、`global_proxies`、`proxy_config`、`failover_queue`、`provider_health`。
- 当前扩展瓶颈：
  - `AppType`、`VISIBLE_APP_TYPES`、`enabled_claude/enabled_codex/enabled_gemini` 等仍绑定固定应用。
  - `Provider` 同时承载上游 endpoint、模型默认值、本地 app 配置和代理配置，后续模型扩展会变重。
  - MCP / skills / prompts 的 per-app 绑定需要动态化，否则每加一个模型都要改 schema。

---

## 1. 总体迁移原则

- 分析可以并行，实施必须串行 gate：每完成一个小功能点，必须完成该点验证后再进入下一个小功能点。
- 本次迁移不复制 Electron `main.js` / bundle 代码；只按功能语义重建。
- 数据库作为 CCG Switch 主存储，旧 JSON 存储方式不再作为新模块方案。
- 外部文件如 `$CODEX_HOME\config.toml`、automation TOML、CLI 会话文件只作为导入、扫描或同步目标。
- 先做兼容层和 registry，再做 schema 动态化，避免一次性大迁移。
- 新增模型时应优先新增 adapter / registry 数据，不应散落修改 UI union、DB 列和 command match 分支。
- 工作空间是用户维护的实体，历史会话扫描结果只是可导入或可关联的数据源。
- 安全上不在日志、toast、导出文件中明文输出 API Key、Token、OAuth token。

---

## 2. 目标模块边界

### 2.1 Workspace Core

负责：

- 工作空间实体 CRUD。
- 路径归一化。
- Git 根目录和 origin 探测。
- 最近打开、收藏、标签、颜色、描述。
- 默认 app / provider / permission policy。
- 从当前 dashboard project / session project 一键导入 workspace。

不负责：

- 直接读写 provider 密钥。
- 直接执行模型请求。
- 直接解析所有会话格式。

### 2.2 App / Model Adapter Registry

负责：

- 描述一个本地客户端集成：Claude、Codex、Gemini、后续 OpenCode / OpenClaw / Qwen / Ollama 等。
- 描述一个模型协议 adapter：Anthropic、OpenAI compatible、OpenAI Responses、Gemini、local HTTP。
- 描述 capabilities：streaming、tool calling、vision、reasoning effort、JSON schema output。

短期：

- 先做静态 registry，不改 DB。

长期：

- 动态 registry 入库，支持插件式启用和禁用。

### 2.3 Session / Conversation Core

负责：

- 复用现有 `session_manager` 扫描历史会话。
- 将 session 关联到 workspace。
- 后续支持 Codex Desktop 风格 thread / turn / item 事件。
- 保存 conversation UI 状态、pending approval 状态和 token usage 展示。

短期：

- 保留历史会话浏览。

中期：

- 引入 CodexBridge 做实时 Codex thread / turn。

### 2.4 CodexBridge

负责：

- 以 Tauri command / Rust service 抽象目标项目中的 Electron bridge。
- 语义 API 包括 `thread/start`、`thread/resume`、`turn/start`、`turn/interrupt`、`thread/read`、`model/list`、`config/read`、`mcpServerStatus/list`。
- 将 Codex app server streaming event 转成前端稳定事件模型。

不负责：

- Electron BrowserWindow、globalShortcut、Sparkle updater。
- 直接把 Electron IPC 名字暴露给 CCG 前端。

### 2.5 Capability Binding

负责：

- 把 MCP server、skill、prompt、local tool、automation 等能力绑定到 app、model adapter、provider、workspace。
- 替代未来继续新增 `enabled_xxx` 列的做法。

短期：

- 先建立 service 层视图，将旧列映射为动态 binding。

长期：

- 新增 `capability_bindings` 表并迁移旧数据。

### 2.6 Terminal / Git / Worktree / Local Environment / Automation

负责：

- 作为 Workspace 模块的增强能力逐步接入。
- 每个增强能力独立 gate，不和 Workspace Core 混在一个大改动里。

---

## 3. 建议文件结构

### 3.1 前端新增文件

- `src\types\workspace.ts`：workspace、binding、override、command payload 类型。
- `src\types\adapter.ts`：app integration、model adapter、capabilities 类型。
- `src\types\conversation.ts`：thread、turn、item、approval、streaming event 类型。
- `src\services\workspaceService.ts`：workspace Tauri invoke 封装。
- `src\services\adapterRegistryService.ts`：读取 app / model registry。
- `src\services\codexBridgeService.ts`：Codex thread / turn / config / model / MCP status API。
- `src\stores\useWorkspaceStore.ts`：workspace 列表、选中项、导入、CRUD、触达时间。
- `src\stores\useAdapterRegistryStore.ts`：app / model adapter registry。
- `src\stores\useConversationStore.ts`：conversation runtime、event reducer、pending approval。
- `src\components\workspaces\WorkspaceList.tsx`：左侧 workspace 列表。
- `src\components\workspaces\WorkspaceDetails.tsx`：workspace 详情和关联信息。
- `src\components\workspaces\WorkspaceFormModal.tsx`：新增 / 编辑 modal。
- `src\components\workspaces\WorkspaceActions.tsx`：打开目录、打开终端、导入历史项目。
- `src\components\workspaces\WorkspaceSessionPanel.tsx`：复用现有会话列表能力。
- `src\components\workspaces\WorkspaceBindingsPanel.tsx`：provider / MCP / capability 绑定。
- `src\components\conversation\ConversationPanel.tsx`：目标项目 Chat Core 的容器。
- `src\components\conversation\MessageItem.tsx`：普通消息、reasoning、tool、diff、command 输出渲染。
- `src\components\conversation\ApprovalCard.tsx`：command / file change / tool user input 审批。

### 3.2 前端修改文件

- `src\pages\WorkspacesPage.tsx`：从单页大状态拆为模块组合，接入 workspace store。
- `src\App.tsx`：仅当新增 `/workspaces/:workspaceId` 或 `/workspaces/:workspaceId/chat` 子路由时修改。
- `src\components\layout\Sidebar.tsx`：原则上不改，已有入口。
- `src\locales\zh.json`：新增 workspace 模块文案。
- `src\locales\en.json`：新增 workspace 模块文案。

### 3.3 后端新增文件

- `src-tauri\src\models\workspace.rs`：workspace、binding、override 模型。
- `src-tauri\src\models\adapter.rs`：app integration、model adapter、capabilities 模型。
- `src-tauri\src\models\conversation.rs`：thread、turn、item、approval 事件模型。
- `src-tauri\src\database\dao\workspaces.rs`：workspace DAO。
- `src-tauri\src\services\workspace_service.rs`：workspace 业务逻辑。
- `src-tauri\src\services\adapter_registry_service.rs`：静态 / 动态 registry。
- `src-tauri\src\services\codex_bridge_service.rs`：Codex app server / CLI 适配。
- `src-tauri\src\commands\workspace_commands.rs`：workspace command。
- `src-tauri\src\commands\adapter_commands.rs`：adapter registry command。
- `src-tauri\src\commands\codex_bridge_commands.rs`：CodexBridge command。

### 3.4 后端修改文件

- `src-tauri\src\models\mod.rs`
- `src-tauri\src\database\schema.rs`
- `src-tauri\src\database\dao\mod.rs`
- `src-tauri\src\services\mod.rs`
- `src-tauri\src\commands\mod.rs`
- `src-tauri\src\lib.rs`
- `src-tauri\src\session_manager\mod.rs`：只在 session 与 workspace 关联阶段修改。

---

## 4. 数据模型草案

### 4.1 `workspaces`

```sql
CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    root_path TEXT NOT NULL,
    normalized_path TEXT NOT NULL UNIQUE,
    git_root TEXT,
    origin_url TEXT,
    description TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    color TEXT,
    icon TEXT,
    default_app_type TEXT,
    default_provider_id TEXT,
    permission_policy TEXT,
    terminal_policy TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    is_favorite BOOLEAN NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_opened_at INTEGER
);
```

### 4.2 `workspace_bindings`

```sql
CREATE TABLE IF NOT EXISTS workspace_bindings (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    binding_type TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT 1,
    priority INTEGER NOT NULL DEFAULT 0,
    config TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(workspace_id, target_type, target_id, binding_type)
);
```

`target_type` 可取：

- `app`
- `model_adapter`
- `provider`
- `mcp_server`
- `skill`
- `prompt`
- `automation`

`binding_type` 可取：

- `default`
- `enabled`
- `override`
- `sync`
- `favorite`

### 4.3 后续动态表

这些表不在第一批实现，等兼容层稳定后再加：

- `model_adapters`
- `app_integrations`
- `capabilities`
- `capability_bindings`
- `sessions`
- `conversation_threads`

---

## 5. 命令设计

### 5.1 Workspace commands

- `list_workspaces() -> Vec<Workspace>`
- `get_workspace(id: String) -> Workspace`
- `resolve_workspace(path: String) -> Workspace`
- `create_workspace(input: WorkspaceInput) -> Workspace`
- `update_workspace(id: String, input: WorkspaceInput) -> Workspace`
- `delete_workspace(id: String) -> ()`
- `touch_workspace(id: String) -> ()`
- `import_project_as_workspace(path: String) -> Workspace`
- `list_workspace_bindings(workspaceId: String) -> Vec<WorkspaceBinding>`
- `set_workspace_binding(input: WorkspaceBindingInput) -> WorkspaceBinding`
- `delete_workspace_binding(id: String) -> ()`

### 5.2 Adapter registry commands

- `list_app_integrations() -> Vec<AppIntegration>`
- `list_model_adapters() -> Vec<ModelAdapter>`
- `get_app_integration(appId: String) -> AppIntegration`
- `get_model_adapter(adapterId: String) -> ModelAdapter`

### 5.3 CodexBridge commands

第一阶段只定义接口，不立即实现全部功能：

- `codex_config_read(workspaceId?: String)`
- `codex_model_list(providerId?: String)`
- `codex_thread_start(input: ThreadStartInput)`
- `codex_thread_resume(input: ThreadResumeInput)`
- `codex_turn_start(input: TurnStartInput)`
- `codex_turn_interrupt(threadId: String, turnId: String)`
- `codex_thread_read(threadId: String)`
- `codex_mcp_server_status_list(workspaceId?: String)`
- `codex_approval_respond(input: ApprovalResponseInput)`

---

## 6. 串行实施计划

> 执行规则：每个 task 完成后必须执行该 task 的验证；验证不通过时禁止进入下一 task。涉及代码实现前必须按 AGENTS 先向用户确认。

### Task 0: 基线冻结和方案确认

**目标：** 确认当前计划是后续实施依据，不进入代码修改。

**Files:**

- Modify: `TODO_LIST.md`
- Create: `docs\superpowers\plans\2026-04-29-workspace-module-migration.md`

- [ ] **Step 0.1: 保存计划文档**
  - 验证：文档存在且能被 `Get-Content` 正常读取。

- [ ] **Step 0.2: 在 TODO_LIST.md 登记本任务**
  - 验证：旧“配置导入导出”任务仍保留，新任务只追加。

- [ ] **Step 0.3: 等待用户确认**
  - 验证：用户明确回复“确认”或指定优先 task。

### Task 1: Workspace 模块最小模型

**目标：** 建立 workspace 的 Rust / TypeScript 类型，不接数据库、不改 UI 行为。

**Files:**

- Create: `src-tauri\src\models\workspace.rs`
- Modify: `src-tauri\src\models\mod.rs`
- Create: `src\types\workspace.ts`

- [ ] **Step 1.1: 新增 Rust `Workspace` 类型**
  - 字段包括 `id`、`name`、`rootPath`、`normalizedPath`、`gitRoot`、`originUrl`、`description`、`tags`、`color`、`icon`、`defaultAppType`、`defaultProviderId`、`permissionPolicy`、`terminalPolicy`、`metadata`、`isFavorite`、`createdAt`、`updatedAt`、`lastOpenedAt`。
  - 使用 `#[serde(rename_all = "camelCase")]`。
  - 验证：`cargo check --manifest-path src-tauri\Cargo.toml`。

- [ ] **Step 1.2: 新增 Rust `WorkspaceInput` 类型**
  - 输入字段只允许用户可编辑项。
  - 不允许从前端传入 `normalizedPath`、`createdAt`、`updatedAt`。
  - 验证：`cargo check --manifest-path src-tauri\Cargo.toml`。

- [ ] **Step 1.3: 新增 Rust `WorkspaceBinding` 类型**
  - 字段包括 `id`、`workspaceId`、`targetType`、`targetId`、`bindingType`、`enabled`、`priority`、`config`、`createdAt`、`updatedAt`。
  - 验证：`cargo check --manifest-path src-tauri\Cargo.toml`。

- [ ] **Step 1.4: 新增 TypeScript 类型**
  - 与 Rust camelCase 输出完全一致。
  - `metadata`、`config` 使用 `Record<string, unknown>`。
  - 验证：`npm run build`。

### Task 2: 路径归一化工具

**目标：** 解决 Windows 路径大小写、分隔符、末尾斜杠、UNC 路径重复问题。

**Files:**

- Create: `src-tauri\src\services\workspace_service.rs`
- Modify: `src-tauri\src\services\mod.rs`

- [ ] **Step 2.1: 实现 `normalize_workspace_path(path: &str) -> Result<String, String>`**
  - Windows 盘符统一小写。
  - `\` 和 `/` 统一为 `\`。
  - 去掉末尾分隔符。
  - 空路径返回错误。
  - 验证：新增 Rust 单测覆盖空路径、盘符大小写、混合分隔符。

- [ ] **Step 2.2: 实现 `derive_workspace_name(path: &str) -> String`**
  - 默认取最后一级目录。
  - 根目录时返回路径本身的可读形式。
  - 验证：Rust 单测。

- [ ] **Step 2.3: 实现 `detect_git_root(path: &Path) -> Option<String>`**
  - 从当前路径向上查找 `.git`。
  - 非 git 项目返回 `None`。
  - 验证：Rust 单测使用临时目录。

- [ ] **Step 2.4: 实现 `detect_origin_url(git_root: &Path) -> Option<String>`**
  - 优先读取 `.git\config` 的 `remote "origin"`。
  - 读取失败返回 `None`，不阻断 workspace 创建。
  - 验证：Rust 单测。

### Task 3: Workspace 数据库 schema

**目标：** 增加数据库表，不接 UI。

**Files:**

- Modify: `src-tauri\src\database\schema.rs`

- [ ] **Step 3.1: 新增 `workspaces` 表**
  - 使用 `CREATE TABLE IF NOT EXISTS`。
  - `normalized_path` 必须唯一。
  - 验证：`cargo check --manifest-path src-tauri\Cargo.toml`。

- [ ] **Step 3.2: 新增 `workspace_bindings` 表**
  - 约束 `UNIQUE(workspace_id, target_type, target_id, binding_type)`。
  - 验证：`cargo check --manifest-path src-tauri\Cargo.toml`。

- [ ] **Step 3.3: 新增必要索引**
  - `idx_workspaces_last_opened_at`
  - `idx_workspace_bindings_workspace_id`
  - 验证：启动内存 DB 创建表无错误。

### Task 4: Workspace DAO

**目标：** 实现数据库 CRUD，先用单测验证。

**Files:**

- Create: `src-tauri\src\database\dao\workspaces.rs`
- Modify: `src-tauri\src\database\dao\mod.rs`

- [ ] **Step 4.1: 实现 `insert_workspace`**
  - 插入完整 `Workspace`。
  - 重复 `normalized_path` 返回业务错误。
  - 验证：Rust 单测 happy path + duplicate path。

- [ ] **Step 4.2: 实现 `list_workspaces`**
  - 默认排序：`is_favorite DESC`、`last_opened_at DESC`、`updated_at DESC`。
  - 验证：Rust 单测检查排序。

- [ ] **Step 4.3: 实现 `get_workspace_by_id`**
  - 不存在返回 `None`。
  - 验证：Rust 单测。

- [ ] **Step 4.4: 实现 `get_workspace_by_normalized_path`**
  - 用于去重和导入。
  - 验证：Rust 单测。

- [ ] **Step 4.5: 实现 `update_workspace`**
  - 不允许修改 `id`、`created_at`。
  - 自动刷新 `updated_at`。
  - 验证：Rust 单测。

- [ ] **Step 4.6: 实现 `delete_workspace`**
  - 同步删除 `workspace_bindings`。
  - 验证：Rust 单测。

- [ ] **Step 4.7: 实现 binding CRUD**
  - `list_bindings_by_workspace`
  - `upsert_binding`
  - `delete_binding`
  - 验证：Rust 单测。

### Task 5: Workspace service

**目标：** 在 DAO 上添加业务规则。

**Files:**

- Modify: `src-tauri\src\services\workspace_service.rs`

- [ ] **Step 5.1: 实现 `create_workspace(input)`**
  - 校验路径存在且是目录。
  - 自动填充 `name`、`normalized_path`、`git_root`、`origin_url`、时间戳。
  - 验证：Rust 单测。

- [ ] **Step 5.2: 实现 `import_project_as_workspace(path)`**
  - 已存在则返回已有 workspace 并刷新 `last_opened_at`。
  - 不存在则创建。
  - 验证：Rust 单测 existing + new。

- [ ] **Step 5.3: 实现 `resolve_workspace(path)`**
  - 优先按规范路径查找。
  - 不存在时不自动创建，只返回可导入候选信息。
  - 验证：Rust 单测。

- [ ] **Step 5.4: 实现 `touch_workspace(id)`**
  - 刷新 `last_opened_at`。
  - 验证：Rust 单测。

### Task 6: Tauri workspace commands

**目标：** 将 workspace service 暴露给前端。

**Files:**

- Create: `src-tauri\src\commands\workspace_commands.rs`
- Modify: `src-tauri\src\commands\mod.rs`
- Modify: `src-tauri\src\lib.rs`

- [ ] **Step 6.1: 新增 `list_workspaces` command**
  - 使用 `State<AppState>` 注入 DB。
  - 验证：`cargo check --manifest-path src-tauri\Cargo.toml`。

- [ ] **Step 6.2: 新增 `create_workspace` command**
  - 前端 payload 使用 camelCase。
  - 验证：Rust command 编译通过。

- [ ] **Step 6.3: 新增 `update_workspace` command**
  - 未找到 id 返回明确错误。
  - 验证：Rust command 编译通过。

- [ ] **Step 6.4: 新增 `delete_workspace` command**
  - 删除不存在 id 返回 no-op 或明确错误，需在方案确认时决定。
  - 验证：Rust command 编译通过。

- [ ] **Step 6.5: 新增 `import_project_as_workspace` command**
  - 验证：Rust command 编译通过。

- [ ] **Step 6.6: 新增 binding commands**
  - `list_workspace_bindings`
  - `set_workspace_binding`
  - `delete_workspace_binding`
  - 验证：Rust command 编译通过。

### Task 7: 前端 workspace service / store

**目标：** 前端能读写 workspace，但 UI 仍不切换。

**Files:**

- Create: `src\services\workspaceService.ts`
- Create: `src\stores\useWorkspaceStore.ts`

- [ ] **Step 7.1: 封装 workspaceService**
  - 包含 list/get/create/update/delete/import/touch/binding API。
  - 所有 `invoke` 名称与 Rust command 对齐。
  - 验证：`npm run build`。

- [ ] **Step 7.2: 新增 Zustand store**
  - 状态：`workspaces`、`selectedWorkspaceId`、`loading`、`error`。
  - action：`loadWorkspaces`、`selectWorkspace`、`createWorkspace`、`updateWorkspace`、`deleteWorkspace`、`importProject`。
  - 验证：`npm run build`。

- [ ] **Step 7.3: 错误处理策略**
  - store 保存错误，页面负责 toast。
  - 不在 service 内直接弹 UI。
  - 验证：`npm run build`。

### Task 8: Workspace UI 最小 CRUD

**目标：** `/workspaces` 页面展示数据库 workspace，并保留现有 session 浏览入口。

**Files:**

- Create: `src\components\workspaces\WorkspaceList.tsx`
- Create: `src\components\workspaces\WorkspaceFormModal.tsx`
- Create: `src\components\workspaces\WorkspaceActions.tsx`
- Modify: `src\pages\WorkspacesPage.tsx`
- Modify: `src\locales\zh.json`
- Modify: `src\locales\en.json`

- [ ] **Step 8.1: 新建 WorkspaceList**
  - 展示名称、路径、标签、收藏、最近打开。
  - 空状态提示“尚未添加工作空间”。
  - 验证：`npm run build`。

- [ ] **Step 8.2: 新建 WorkspaceFormModal**
  - 支持新增 / 编辑。
  - 路径字段只在新增时可编辑。
  - 验证：`npm run build`。

- [ ] **Step 8.3: 新建 WorkspaceActions**
  - 包含导入历史项目、打开终端、刷新。
  - 未实现的增强动作隐藏或禁用，不展示假功能。
  - 验证：`npm run build`。

- [ ] **Step 8.4: 改造 WorkspacesPage 组合**
  - 第一列优先展示持久化 workspace。
  - 保留现有项目扫描结果作为“可导入项目”。
  - 选中 workspace 后仍复用现有会话面板。
  - 验证：`npm run build`。

- [ ] **Step 8.5: i18n 双语补齐**
  - 新增所有 `workspace.*` key。
  - 验证：`npm run build`，页面不显示 key。

### Task 9: Workspace 与现有 session_manager 关联

**目标：** workspace 详情页能展示该工作空间历史会话。

**Files:**

- Modify: `src\components\workspaces\WorkspaceSessionPanel.tsx`
- Modify: `src\pages\WorkspacesPage.tsx`
- Optional Modify: `src-tauri\src\commands\session_commands.rs`

- [ ] **Step 9.1: 抽出 WorkspaceSessionPanel**
  - 输入 `workspace.rootPath`。
  - 内部调用现有 `list_sessions(projectPath)` 或等价命令。
  - 验证：`npm run build`。

- [ ] **Step 9.2: 保留 provider filter**
  - 复用当前 `ProviderFilter` 逻辑。
  - 验证：Claude / Codex / Gemini 三类会话筛选行为不变。

- [ ] **Step 9.3: 消息详情复用**
  - 继续调用 `get_unified_session_messages(providerId, sourcePath)`。
  - 验证：选中历史会话能加载消息。

- [ ] **Step 9.4: 恢复会话复用**
  - 使用现有 `launch_resume_session`。
  - 不新增终端启动逻辑。
  - 验证：生成命令与当前行为一致。

### Task 10: Adapter registry 静态化

**目标：** 将 Claude / Codex / Gemini 的固定事实集中，暂不改旧行为。

**Files:**

- Create: `src-tauri\src\models\adapter.rs`
- Create: `src-tauri\src\services\adapter_registry_service.rs`
- Create: `src-tauri\src\commands\adapter_commands.rs`
- Modify: `src-tauri\src\models\mod.rs`
- Modify: `src-tauri\src\services\mod.rs`
- Modify: `src-tauri\src\commands\mod.rs`
- Modify: `src-tauri\src\lib.rs`
- Create: `src\types\adapter.ts`
- Create: `src\services\adapterRegistryService.ts`
- Create: `src\stores\useAdapterRegistryStore.ts`

- [ ] **Step 10.1: 定义 `AppIntegration`**
  - 字段：`appId`、`displayName`、`visible`、`configFiles`、`sessionLocations`、`resumeCommandTemplate`、`mcpSyncSupported`、`enabled`。
  - 验证：`cargo check --manifest-path src-tauri\Cargo.toml`。

- [ ] **Step 10.2: 定义 `ModelAdapter`**
  - 字段：`adapterId`、`displayName`、`protocol`、`supportedTransports`、`authSchemes`、`capabilities`。
  - 验证：`cargo check --manifest-path src-tauri\Cargo.toml`。

- [ ] **Step 10.3: 静态注册 Claude / Codex / Gemini**
  - 不改变现有 provider / session / mcp 行为。
  - 验证：新增 command 返回三项 registry。

- [ ] **Step 10.4: 前端读取 registry**
  - 先只用于展示或调试，不驱动核心 UI。
  - 验证：`npm run build`。

### Task 11: Provider / model workspace 默认值

**目标：** 每个 workspace 可以设置默认 app 和默认 provider，但 provider 数据仍复用现有表。

**Files:**

- Modify: `src\components\workspaces\WorkspaceBindingsPanel.tsx`
- Modify: `src\stores\useWorkspaceStore.ts`
- Modify: `src-tauri\src\services\workspace_service.rs`

- [ ] **Step 11.1: UI 展示默认 app**
  - app 列表来自 registry 或当前 `VISIBLE_APP_TYPES`。
  - 验证：`npm run build`。

- [ ] **Step 11.2: UI 展示默认 provider**
  - provider 列表复用 `useProviderStore`。
  - 按 app 类型过滤。
  - 验证：`npm run build`。

- [ ] **Step 11.3: 保存 workspace 默认值**
  - 写入 `workspaces.default_app_type` 和 `workspaces.default_provider_id`。
  - 验证：重启应用后仍保留。

- [ ] **Step 11.4: 默认 provider 不复制密钥**
  - 只保存 provider id。
  - 验证：导出 workspace 不包含 API key。

### Task 12: Workspace capability binding 兼容视图

**目标：** 为后续模型扩展打基础，暂不迁移旧 `enabled_*` 列。

**Files:**

- Modify: `src-tauri\src\services\workspace_service.rs`
- Modify: `src\components\workspaces\WorkspaceBindingsPanel.tsx`

- [ ] **Step 12.1: 展示 workspace 级 MCP binding**
  - 从 `workspace_bindings` 读取 `target_type = mcp_server`。
  - 未绑定时默认使用 app/global MCP 行为。
  - 验证：`npm run build`。

- [ ] **Step 12.2: 设置 workspace MCP override**
  - 只写 `workspace_bindings`。
  - 不修改 `mcp_servers.enabled_claude/codex/gemini`。
  - 验证：新增 / 禁用 binding 后 DB 数据正确。

- [ ] **Step 12.3: 生成有效 MCP 列表**
  - service 合并 global app MCP + workspace override。
  - 验证：Rust 单测覆盖 override enable / disable / inherit。

### Task 13: CodexBridge 接口层

**目标：** 建立目标项目 Chat Core 的后端接口骨架，不先做完整 UI。

**Files:**

- Create: `src-tauri\src\models\conversation.rs`
- Create: `src-tauri\src\services\codex_bridge_service.rs`
- Create: `src-tauri\src\commands\codex_bridge_commands.rs`
- Modify: `src-tauri\src\models\mod.rs`
- Modify: `src-tauri\src\services\mod.rs`
- Modify: `src-tauri\src\commands\mod.rs`
- Modify: `src-tauri\src\lib.rs`
- Create: `src\types\conversation.ts`
- Create: `src\services\codexBridgeService.ts`

- [ ] **Step 13.1: 定义 conversation 类型**
  - `ThreadStartInput`
  - `TurnStartInput`
  - `ConversationEvent`
  - `ConversationItem`
  - `ApprovalRequest`
  - `ApprovalResponseInput`
  - 验证：`cargo check` + `npm run build`。

- [ ] **Step 13.2: 新增 command 空实现**
  - 返回明确 `not implemented`，用于前后端类型对齐。
  - 验证：`cargo check --manifest-path src-tauri\Cargo.toml`。

- [ ] **Step 13.3: 前端 service 封装**
  - 不接 UI。
  - 验证：`npm run build`。

### Task 14: Codex config / model 只读集成

**目标：** 工作空间模块能读取 Codex 配置和模型列表，先不启动 conversation。

**Files:**

- Modify: `src-tauri\src\services\codex_bridge_service.rs`
- Modify: `src-tauri\src\commands\codex_bridge_commands.rs`
- Modify: `src\services\codexBridgeService.ts`
- Modify: `src\components\workspaces\WorkspaceBindingsPanel.tsx`

- [ ] **Step 14.1: 定位 Codex home**
  - 支持默认 `$CODEX_HOME` 或用户目录 `.codex`。
  - 不能泄露 token。
  - 验证：不存在目录时返回可解释错误。

- [ ] **Step 14.2: 读取 config summary**
  - 只返回模型、provider、sandbox、approval 等非敏感摘要。
  - 验证：config 不存在时返回默认空摘要。

- [ ] **Step 14.3: 读取模型列表**
  - 先复用当前 provider / registry，不直接联网。
  - 验证：`npm run build` + Rust 单测。

### Task 15: Conversation event reducer 前端

**目标：** 前端可消费流式事件并稳定渲染状态。

**Files:**

- Create: `src\stores\useConversationStore.ts`
- Create: `src\components\conversation\ConversationPanel.tsx`
- Create: `src\components\conversation\MessageItem.tsx`
- Create: `src\components\conversation\ApprovalCard.tsx`

- [ ] **Step 15.1: 设计 reducer 状态**
  - `threads`
  - `activeThreadId`
  - `items`
  - `pendingApprovals`
  - `streaming`
  - `error`
  - 验证：`npm run build`。

- [ ] **Step 15.2: 支持基础事件**
  - `turn.started`
  - `item.started`
  - `item.delta`
  - `item.completed`
  - `turn.completed`
  - 验证：写前端纯函数单测或最小手动模拟 reducer。

- [ ] **Step 15.3: 支持 command / file / mcp / reasoning item**
  - 未知 item type 以 raw fallback 展示。
  - 验证：模拟事件不崩溃。

- [ ] **Step 15.4: 支持 approval request**
  - pending approval 单独列表。
  - interrupt 时统一 decline。
  - 验证：模拟 approval 生命周期。

### Task 16: Chat UI 最小可用

**目标：** 在 workspace 详情中提供 Codex chat 面板。

**Files:**

- Modify: `src\pages\WorkspacesPage.tsx`
- Modify: `src\components\conversation\ConversationPanel.tsx`
- Modify: `src\locales\zh.json`
- Modify: `src\locales\en.json`

- [ ] **Step 16.1: 增加 workspace tab**
  - `Overview`
  - `Sessions`
  - `Chat`
  - `Bindings`
  - 验证：`npm run build`。

- [ ] **Step 16.2: Chat 面板展示输入框和消息流**
  - 不做 landing page。
  - 不展示未实现按钮。
  - 验证：`npm run build`。

- [ ] **Step 16.3: 从 workspace 注入 cwd**
  - `ThreadStartInput.cwd = workspace.rootPath`。
  - 验证：debug 输出不包含敏感信息。

### Task 17: Codex thread / turn 实现

**目标：** 连接 Codex CLI / app server，实现真实对话。

**Files:**

- Modify: `src-tauri\src\services\codex_bridge_service.rs`
- Modify: `src-tauri\src\commands\codex_bridge_commands.rs`
- Modify: `src\stores\useConversationStore.ts`

- [ ] **Step 17.1: 确定 Codex executable 发现策略**
  - 优先用户配置路径。
  - 其次 PATH 中 `codex`。
  - 不执行未知远程脚本。
  - 验证：未安装时返回明确错误。

- [ ] **Step 17.2: 实现 thread start**
  - 参数包含 cwd、model、approval policy、sandbox。
  - 验证：能拿到 thread id 或明确错误。

- [ ] **Step 17.3: 实现 turn start**
  - 支持流式事件转发。
  - 验证：发送简单 prompt 能收到 assistant 消息。

- [ ] **Step 17.4: 实现 turn interrupt**
  - 终止当前 turn。
  - pending approvals 全部 decline。
  - 验证：长任务可中断。

- [ ] **Step 17.5: 实现 thread resume**
  - 从已有 thread id / rollout path 恢复。
  - 验证：恢复后能继续发送消息。

### Task 18: Approval Core

**目标：** 实现 command / file change / user input 三类审批。

**Files:**

- Modify: `src-tauri\src\models\conversation.rs`
- Modify: `src-tauri\src\services\codex_bridge_service.rs`
- Modify: `src\components\conversation\ApprovalCard.tsx`
- Modify: `src\stores\useConversationStore.ts`

- [ ] **Step 18.1: command approval**
  - 展示命令、cwd、reason。
  - Approve / Deny。
  - 验证：需要审批的 command 可继续或拒绝。

- [ ] **Step 18.2: file change approval**
  - 展示文件路径、diff 摘要。
  - Approve / Deny。
  - 验证：拒绝后不会落盘。

- [ ] **Step 18.3: user input request**
  - 支持文本输入和 2-3 个选项。
  - 验证：回复后 turn 继续。

### Task 19: MCP Core 与 workspace binding 集成

**目标：** workspace chat 使用工作空间级 MCP 有效列表。

**Files:**

- Modify: `src-tauri\src\services\workspace_service.rs`
- Modify: `src-tauri\src\services\codex_bridge_service.rs`
- Modify: `src\components\workspaces\WorkspaceBindingsPanel.tsx`

- [ ] **Step 19.1: 获取有效 MCP 配置**
  - 合并全局 MCP、app MCP、workspace override。
  - 验证：Rust 单测。

- [ ] **Step 19.2: 注入 Codex thread config**
  - 将有效 MCP 写入 thread start config。
  - 验证：MCP tool call 在 chat 中可见。

- [ ] **Step 19.3: OAuth / status 暂缓**
  - 若未实现则 UI 明确不显示。
  - 验证：无假入口。

### Task 20: Terminal Core

**目标：** 在 workspace 中打开终端和恢复会话，不实现内置 pty。

**Files:**

- Modify: `src\components\workspaces\WorkspaceActions.tsx`
- Optional Modify: `src-tauri\src\commands\workspace_commands.rs`

- [ ] **Step 20.1: 复用现有 `open_in_terminal`**
  - cwd 使用 workspace root。
  - 验证：Windows 下打开首选终端到正确目录。

- [ ] **Step 20.2: 复用 `launch_resume_session`**
  - 会话恢复从 `SessionMeta.resumeCommand` 来。
  - 验证：当前 Claude / Codex / Gemini 行为不退化。

- [ ] **Step 20.3: 内置 terminal 延后**
  - 不引入 `node-pty`。
  - 如需内置 terminal，另开 adapter 方案。

### Task 21: Git Core

**目标：** 工作空间展示 Git 信息和基础动作。

**Files:**

- Create: `src-tauri\src\services\workspace_git_service.rs`
- Optional Create: `src-tauri\src\commands\workspace_git_commands.rs`
- Create: `src\components\workspaces\WorkspaceGitPanel.tsx`

- [ ] **Step 21.1: 读取 Git branch / dirty 状态**
  - 只读命令。
  - 验证：非 git workspace 返回空状态。

- [ ] **Step 21.2: 展示 remote origin**
  - 复用 workspace `origin_url`。
  - 验证：UI 不因 origin 缺失报错。

- [ ] **Step 21.3: create branch / push / PR 文案延后**
  - 等 Chat Core 稳定后再接。
  - 验证：无未实现按钮。

### Task 22: Worktree Core

**目标：** 为 Codex-managed worktree 做数据和 UI 预留，暂不实现 cloud snapshot。

**Files:**

- Optional Create: `src-tauri\src\models\worktree.rs`
- Optional Create: `src-tauri\src\services\worktree_service.rs`
- Optional Create: `src\components\workspaces\WorkspaceWorktreesPanel.tsx`

- [ ] **Step 22.1: 定义 worktree 数据模型**
  - `id`、`workspaceId`、`path`、`branch`、`ownerThreadId`、`createdAt`、`lastUsedAt`。
  - 验证：`cargo check`。

- [ ] **Step 22.2: 列出现有 worktree**
  - 只读。
  - 验证：非 git 项目返回空。

- [ ] **Step 22.3: cleanup 策略延后**
  - 删除 worktree 属高风险操作，必须单独确认。

### Task 23: Local Environment Core

**目标：** 支持 workspace 的 `environment.toml` 编辑和预览。

**Files:**

- Create: `src-tauri\src\models\local_environment.rs`
- Create: `src-tauri\src\services\local_environment_service.rs`
- Create: `src\components\workspaces\LocalEnvironmentPanel.tsx`

- [ ] **Step 23.1: 读取 environment.toml**
  - 不存在返回默认空配置。
  - 验证：Rust 单测。

- [ ] **Step 23.2: 编辑 setup script**
  - 保存前展示目标路径。
  - 验证：写入只发生在 workspace 内。

- [ ] **Step 23.3: 执行 setup script 延后**
  - 运行脚本属于高风险操作，必须另行确认。

### Task 24: Automation Core

**目标：** 将目标项目 automations 功能作为 workspace 增强能力规划，不与首批交付混合。

**Files:**

- Optional Create: `src-tauri\src\models\automation.rs`
- Optional Create: `src-tauri\src\services\automation_service.rs`
- Optional Create: `src\components\workspaces\AutomationPanel.tsx`

- [ ] **Step 24.1: 定义 automation schema**
  - `id`、`workspaceId`、`title`、`prompt`、`schedule`、`enabled`、`memoryPath`。
  - 验证：`cargo check`。

- [ ] **Step 24.2: CRUD 存 DB**
  - 不使用 JSON 文件作为主存储。
  - 验证：Rust 单测。

- [ ] **Step 24.3: run-now 延后**
  - 需要 Chat Core 稳定后接入。

### Task 25: 动态 capability schema 迁移

**目标：** 真正解除固定 `enabled_claude/enabled_codex/enabled_gemini` 限制。

**Files:**

- Modify: `src-tauri\src\database\schema.rs`
- Modify: `src-tauri\src\database\dao\mcp.rs`
- Modify: `src-tauri\src\commands\mcp_commands.rs`
- Modify: `src\stores\useMcpStoreV2.ts`

- [ ] **Step 25.1: 新增 `capabilities` 表**
  - 覆盖 MCP / skill / prompt。
  - 验证：旧数据可读。

- [ ] **Step 25.2: 新增 `capability_bindings` 表**
  - target 支持 `app`、`workspace`、`provider`、`model_adapter`。
  - 验证：Rust 单测。

- [ ] **Step 25.3: 旧列迁移为 binding**
  - 迁移幂等。
  - 不删除旧列，保留一版兼容。
  - 验证：旧 DB 启动后 MCP 页面数据不变。

### Task 26: 前端 registry 驱动化

**目标：** 新增模型或本地客户端时，UI 不再大量改 union 和 tab。

**Files:**

- Modify: `src\types\app.ts`
- Modify: provider tabs 相关组件
- Modify: MCP app enable toggle 相关组件
- Modify: session provider filter 相关组件

- [ ] **Step 26.1: 让可见 app 来自 registry**
  - 保留旧 `AppType` 兼容。
  - 验证：Claude / Codex / Gemini 显示不变。

- [ ] **Step 26.2: Provider tabs registry 化**
  - 新增 disabled app 不显示。
  - 验证：`npm run build`。

- [ ] **Step 26.3: MCP toggle registry 化**
  - 不再硬编码三列 UI。
  - 验证：旧 MCP 配置不丢。

### Task 27: 完整验证

**目标：** 确认每个阶段不会引入发布阻塞。

**Files:**

- No direct code change.

- [ ] **Step 27.1: 前端构建**
  - Run: `npm run build`
  - Expected: PASS。

- [ ] **Step 27.2: Rust 编译**
  - Run: `cargo check --manifest-path src-tauri\Cargo.toml`
  - Expected: PASS。

- [ ] **Step 27.3: Rust 测试**
  - Run: `cargo test --manifest-path src-tauri\Cargo.toml`
  - Expected: PASS，或明确列出环境阻塞。

- [ ] **Step 27.4: 手动回归**
  - Provider 页面导入 / 导出不退化。
  - MCP 页面启用 / 禁用不退化。
  - Workspaces 页面历史会话读取不退化。
  - Dashboard 项目扫描不退化。

---

## 7. 首批推荐交付顺序

第一批只做可稳定上线的工作空间基础能力：

1. Task 1：Workspace 类型。
2. Task 2：路径归一化。
3. Task 3：数据库 schema。
4. Task 4：DAO。
5. Task 5：service。
6. Task 6：Tauri commands。
7. Task 7：前端 service / store。
8. Task 8：UI 最小 CRUD。
9. Task 9：会话关联。
10. Task 10：静态 registry。

第二批做 Codex Desktop 核心体验：

1. Task 11：workspace 默认 provider。
2. Task 12：capability binding 兼容视图。
3. Task 13：CodexBridge 类型和接口。
4. Task 14：Codex config / model 只读。
5. Task 15：conversation reducer。
6. Task 16：Chat UI 最小可用。
7. Task 17：真实 thread / turn。
8. Task 18：approval。
9. Task 19：MCP 注入。

第三批做增强能力：

1. Task 20：Terminal。
2. Task 21：Git。
3. Task 22：Worktree。
4. Task 23：Local Environment。
5. Task 24：Automation。
6. Task 25：动态 capability schema。
7. Task 26：前端 registry 驱动化。
8. Task 27：完整验证。

---

## 8. 回归风险清单

- 工作空间和历史项目两个概念混用，导致用户不知道当前数据来自 DB 还是扫描。
- 路径归一化不一致，导致同一 Windows 路径重复创建 workspace。
- Provider 默认值保存 API Key 副本，导致导出泄露敏感信息。
- MCP workspace override 和全局 enable 互相覆盖，导致旧页面行为退化。
- 过早迁移 `enabled_*` schema，导致旧数据不可读。
- Conversation event 类型过窄，无法表达 reasoning、diff、tool call、approval。
- CodexBridge 将 Electron IPC 名称直接泄露到前端，后续扩展其他模型困难。
- 直接引入 `node-pty` 或 Electron-only 依赖，破坏 Tauri 架构。
- 自动执行 local environment setup script，触发高风险脚本执行。
- 工作树已有上一个任务未完成验证，实施新任务前需要确认是否允许并行维护未完成状态。

---

## 9. 明确暂缓项

- 不在第一批实现内置 terminal。
- 不在第一批实现 automation run-now。
- 不在第一批实现 worktree 删除 / cleanup。
- 不在第一批删除任何旧 DB 列。
- 不在第一批迁移全部 provider 字段为通用模型。
- 不在第一批支持远程 SSH workspace。
- 不在第一批实现 Sentry、Sparkle updater、hotkey window、native menu。

---

## 10. 后续确认问题

1. 第一批是否只做“Workspace CRUD + 会话关联 + 静态 registry”？
2. 工作空间实体删除时，是只删除 DB 记录，还是允许删除本地目录？建议只删除 DB 记录。
3. 默认 app / provider 是否必须第一批就做？建议放入第二批。
4. CodexBridge 是否只接 Codex CLI，还是要同时抽象 Claude / Gemini 的实时对话？建议先只接 Codex CLI。
5. 是否需要为 workspace 设计详情子路由 `/workspaces/:workspaceId`？建议第一批不拆路由，只在现有页面内完成。
