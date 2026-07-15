## Why

Provider 的代理配置（`proxyConfig`）当前只是存入数据库，切换 Provider 时 `sync_to_claude_settings` 并未将其映射到 `~/.claude/settings.json` 的 `env.HTTP_PROXY` / `env.HTTPS_PROXY`，导致代理配置在 Claude Code 中不生效。同时前端组件暴露了不必要的用户名/密码字段，与实际需求（直接输入完整代理 URL）不匹配。

## What Changes

- 简化前端 `ProviderProxyConfig` 组件：去掉 host/port/username/password 拆分字段，改为直接输入 HTTP 代理和 HTTPS 代理的完整 URL
- 简化数据模型：`ProviderProxyConfig` 从 `{proxyType, proxyHost, proxyPort, proxyUsername, proxyPassword}` 简化为 `{enabled, httpProxy?, httpsProxy?}`
- 后端 `sync_to_claude_settings` 新增代理写入逻辑：切换 Provider 时将 `proxy_config` 映射到 `env.HTTP_PROXY` / `env.HTTPS_PROXY`；关闭或为空时清除这两个 key
- 仅支持 Claude（`AppType::Claude`），其他应用暂不处理

## Capabilities

### New Capabilities
- `proxy-env-sync`: Provider 切换时将代理配置同步到 Claude settings.json 的 env 字段（HTTP_PROXY / HTTPS_PROXY）

### Modified Capabilities

## Impact

- **前端**: `src/types/provider.ts`（类型定义）、`src/components/providers/ProviderProxyConfig.tsx`（UI 组件）
- **Rust 模型**: `src-tauri/src/models/provider.rs`（`ProviderProxyConfig` struct）
- **核心逻辑**: `src-tauri/src/services/provider_service.rs` 的 `sync_to_claude_settings` 函数
- **DB 兼容**: 旧格式 `proxy_config` 数据需向下兼容（反序列化时 fallback）
- **写入目标**: `~/.claude/settings.json` 的 `env` 对象
