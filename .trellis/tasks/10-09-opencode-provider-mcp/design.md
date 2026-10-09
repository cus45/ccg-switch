# Design — OpenCode 供应商切换 + MCP 同步

## 边界

只改后端 `services/provider_service.rs`、`mcp/`、`services/mcp_service.rs`，以及前端的可见应用列表与 OpenCode 表单。不碰代理（`proxy/`、`proxy_takeover.rs` 的 `TAKEOVER_APPS` 保持 3 个）。

## 后端

### 新模块 `src-tauri/src/services/opencode_config.rs`

移植自 cc-switch `opencode_config.rs`，去掉 plugin 部分：

```rust
pub fn get_opencode_config_path() -> PathBuf   // ~/.config/opencode/opencode.json
pub fn read_opencode_config() -> Result<Value, String>   // 不存在 → {"$schema": ...}；JSON 损坏 → Err，不覆盖
pub fn write_opencode_config(v: &Value) -> Result<(), String>  // 原子写：tmp + rename
pub fn set_provider(id, Value) / remove_provider(id)
pub fn set_model(model: &str)                  // 顶层 "model": "<id>/<model>"
pub fn set_mcp_server(id, Value) / remove_mcp_server(id) / get_mcp_servers()
```

依赖 `serde_json` 的 `preserve_order`（项目已启用），保证 key 顺序不变。

### 供应商切换

`provider_service::sync_provider_to_app_config` 和 `preview_provider_sync` 增加 `AppType::OpenCode` 分支：

- `sync_to_opencode_config(provider)`：
  1. 片段来源优先级：`provider.settings_config`（若是完整 `{provider:{...}}` 结构，则取出 `provider.<id>` 片段，与 cc-switch live.rs:146 的逻辑一致）→ 否则由 `url`/`api_key`/`default_*_model` 拼出：
     ```json
     { "npm": "@ai-sdk/openai-compatible", "name": "<name>",
       "options": { "baseURL": "<url>", "apiKey": "<key>" },
       "models": { "<model>": { "name": "<model>" } } }
     ```
     `npm` 可通过 `meta.npm` 覆盖（Anthropic 兼容 → `@ai-sdk/anthropic`）。
  2. `set_provider(provider.id, fragment)`，`set_model("<id>/<default model>")`（没有模型时不改 `model`）。
- 删除供应商（`delete_provider_from_db` 调用链）时，若 app 为 OpenCode → `remove_provider(id)`。
- additive 语义：切换不删除其它 provider 条目（与 `AppType::is_additive_mode` 的含义一致；`is_additive_mode` 目前只含 Codex/Gemini，**不改它**，避免影响其它分支，在 OpenCode 分支内单独处理）。

### MCP

新文件 `src-tauri/src/mcp/opencode.rs`，对外暴露 `sync_server_to_opencode` / `remove_server_from_opencode` / `read_opencode_mcp_servers`，在 `mcp/mod.rs` 中 re-export。

格式转换（内部规范格式 → OpenCode）：

| 内部 | OpenCode |
|---|---|
| `{type:"stdio", command, args, env}` | `{type:"local", command:[command,...args], environment: env, enabled:true}` |
| `{type:"http"\|"sse", url, headers}` | `{type:"remote", url, headers, enabled:true}` |

反向转换用于导入（`mcp/import.rs` 增加 opencode 来源）。

`mcp_service.rs` 中现有 claude/codex/gemini 四处分发点（第 23/37/53/90 行附近）各补一个 `"opencode"` 分支。`McpApps` 是 `HashMap<String,bool>`，无需改模型。

## 前端

- `src/types/app.ts`：`VISIBLE_APP_TYPES` 加入 `'opencode'`，删除"已废弃"注释。
- 搜索 `VISIBLE_APP_TYPES` 的 10 处使用点，逐一确认 OpenCode 出现是否合理；代理相关（接管、故障转移队列）对 OpenCode 过滤掉或显示"暂不支持"。
- 供应商表单：OpenCode 需要 `npm` 选择（openai-compatible / anthropic / 自定义）+ Base URL + Key + 模型列表；参考 cc-switch `useOpencodeFormState.ts`，只保留这些字段。
- MCP 页面的应用开关列加入 OpenCode。
- 图标：`ProviderIcon` 已有 opencode（`ProviderIcon.test.tsx` 中有引用），确认可用。

## 兼容性 / 回滚

- 已有数据库里 `app_type = opencode` 的旧数据：可能存在历史遗留，切换前用 `preview_provider_sync` 让用户看到 diff。
- 回滚：前端把 `opencode` 从 `VISIBLE_APP_TYPES` 中移除即可隐藏入口；后端分支是新增的，对其它应用无副作用。

## 取舍

- 不移植 cc-switch 的 `OpenCodeProviderConfig` 强类型结构，直接用 `serde_json::Value` 片段，以减少类型维护；校验只检查 `options.baseURL` 是否存在。
