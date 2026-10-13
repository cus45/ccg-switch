# 项目配置组合一键切换 (Project Profiles)

## Goal
支持项目（整套配置）一键切换：允许用户将不同工作场景（如“公司企业级开发”、“个人开源项目”、“DeepSeek 编程”、“学术研究”等）下的供应商、MCP 服务器、技能、Prompt 预设保存为一个项目配置（Project Profile），并在全局导航栏实现毫秒级一键切换与即时生效。

## Requirements

### 1. 数据模型与持久化 (`src-tauri/src/database/dao/project_profile.rs` & `schema.rs`)
- SQLite 表 `project_profiles`:
  - `id`: TEXT PRIMARY KEY
  - `name`: TEXT NOT NULL
  - `description`: TEXT
  - `icon`: TEXT
  - `is_active`: BOOLEAN NOT NULL DEFAULT 0
  - `providers_json`: TEXT NOT NULL DEFAULT '{}' (app_type -> provider_id)
  - `mcp_servers_json`: TEXT NOT NULL DEFAULT '{}' (app_type -> [server_id])
  - `skills_json`: TEXT NOT NULL DEFAULT '{}' (app_type -> [skill_id])
  - `prompts_json`: TEXT NOT NULL DEFAULT '{}' (app_type -> prompt_id)
  - `created_at`: INTEGER NOT NULL
  - `updated_at`: INTEGER NOT NULL
- DAO 支持列出所有项目、按 ID 查询、新增/更新、删除、以及将指定项目标记为活跃。

### 2. 业务逻辑服务 (`src-tauri/src/services/project_profile_service.rs`)
- `capture_current_profile(db, name, description, icon)`:
  - 自动抓取当前所有应用的活跃 Provider (`providers.is_active = 1`);
  - 自动抓取各应用启用的 MCP 服务器 (`enabled_claude`, `enabled_codex` 等);
  - 自动抓取各应用启用的技能 (`enabled_claude`, `enabled_codex` 等);
  - 自动抓取各应用启用的 Prompt 预设 (`prompts.enabled = 1`);
  - 组装并保存为新项目 Profile。
- `apply_profile(db, profile_id)`:
  - 对每个应用切换活跃 Provider 并调用对应应用配置同步 (`sync_provider_to_app_config`);
  - 对所有 MCP 服务器按 profile 启用状态更新并调用 `McpService::upsert` 同步配置;
  - 对所有已安装技能按 profile 启用状态更新并同步本地目录/链接;
  - 对所有 Prompt 预设按 profile 启用状态更新并应用到 live 提示词文件;
  - 更新项目表中 `is_active` 状态。
- `update_profile_from_current(db, profile_id)`:
  - 用当前系统状态更新已有项目的各项配置。

### 3. Tauri 命令与注册 (`src-tauri/src/commands/project_profile_commands.rs` & `lib.rs`)
- `get_project_profiles`
- `save_project_profile`
- `delete_project_profile`
- `capture_current_project_profile`
- `apply_project_profile`

### 4. 前端状态与界面
- `src/types/projectProfile.ts`: 类型定义
- `src/stores/useProjectProfileStore.ts`: Zustand 状态管理
- `src/components/project/ProjectProfileSelector.tsx`: 顶部导航栏项目选择器，支持一键切换与下拉菜单
- `src/components/project/ProjectProfileSaveModal.tsx`: 另存当前配置为新项目对话框
- `src/components/project/ProjectProfileManagerModal.tsx`: 项目管理弹窗（查看配置概览、更新配置、重命名、删除）
- 集成到 `Navbar.tsx` 与 `Sidebar.tsx` (top 模式)

### 5. i18n
- 中英文文案同步完善。

## Acceptance Criteria
- [x] 数据库正确建立 `project_profiles` 表与 DAO 读写方法。
- [x] `capture_current_profile` 能准确捕获当前活跃 Provider、MCP、技能与 Prompt。
- [x] `apply_profile` 能一键将整套配置无缝同步到系统与磁盘配置文件中。
- [x] 顶部导航栏展示项目切换下拉菜单，点击任意项目即可一键切换并弹出 Toast 提示。
- [x] 支持将当前状态另存为新项目，或用当前状态更新已有项目。
- [x] 所有 Rust 单元测试和 Vitest 前端测试全部通过，`npm run build` 构建无警告。
