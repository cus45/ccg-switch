## Context

当前 `Provider` 的 `proxy_config` 字段（`ProviderProxyConfig`）在 DB 中存储了拆分的代理信息（`proxyType`, `proxyHost`, `proxyPort`, `proxyUsername`, `proxyPassword`），但 `sync_to_claude_settings` 函数在切换 Provider 时完全未消费这些字段。前端 UI 暴露了用户名/密码输入框，但实际场景中用户只需直接粘贴完整的代理 URL。

目标写入位置：`~/.claude/settings.json` 的 `env` 对象中 `HTTP_PROXY` 和 `HTTPS_PROXY` 字段。

## Goals / Non-Goals

**Goals:**
- Provider 切换时，将其代理配置自动同步到 Claude 的 `settings.json` env
- 前端提供简洁的代理 URL 输入体验（HTTP/HTTPS 各一个输入框）
- 关闭代理或清空时，从 env 中移除 `HTTP_PROXY` / `HTTPS_PROXY`
- 旧格式数据反序列化不报错（向下兼容）

**Non-Goals:**
- 不支持 Claude 以外的应用（Codex, Gemini 等暂不处理）
- 不做 SOCKS5 代理的特殊处理（用户自行输入完整 socks5://... URL）
- 不涉及内置代理服务器（ProxyPage）的逻辑
- 不处理 `NO_PROXY` 字段

## Decisions

### 1. 数据模型：新增字段而非替换

在 Rust `ProviderProxyConfig` struct 中新增 `http_proxy: Option<String>` 和 `https_proxy: Option<String>` 字段（带 `#[serde(default)]`），保留旧字段用于反序列化兼容。前端类型同步新增。

**理由**：DB 中已有旧格式数据，直接删除字段会导致反序列化失败。新增字段 + serde default 是最安全的方式。

### 2. 前端 UI：两个独立 URL 输入框

去掉 host/port/username/password 拆分逻辑，改为：
- HTTP 代理 URL 输入框
- HTTPS 代理 URL 输入框（默认与 HTTP 相同的提示）

**理由**：绝大多数用户的 HTTP/HTTPS 代理相同，但分开输入可兼顾不同代理的场景。用户直接粘贴完整 URL，无需理解拆分逻辑。

### 3. 同步逻辑位置：`sync_to_claude_settings`

在 `provider_service.rs` 的 `sync_to_claude_settings` 函数中，于 `merge_provider_to_env` 之后加入代理映射逻辑：
- `proxy_config.enabled == true` 且有值 → 写入 `env.HTTP_PROXY` / `env.HTTPS_PROXY`
- 否则 → `env.remove("HTTP_PROXY")` / `env.remove("HTTPS_PROXY")`

**理由**：这是 Provider 切换时写入 settings.json 的唯一入口，改动集中且可控。

### 4. 前端旧数据兼容：读取时构建 URL

当前端读取到旧格式（有 `proxyHost`/`proxyPort` 但无 `httpProxy`）时，用 `buildProxyUrl` 从旧字段构建完整 URL 显示，并在用户保存时迁移为新格式。

## Risks / Trade-offs

- [旧数据丢失] 旧格式中带 username/password 的代理地址在新 UI 中只能通过 URL 编辑 → 可接受，这种场景罕见，且用户可在 URL 中嵌入 `user:pass@host:port`
- [字段膨胀] 新旧字段并存 → 后续版本可标记旧字段 deprecated 并在 migration 中清理
- [仅 Claude] 其他应用代理需求暂未覆盖 → Non-Goal，后续按需扩展
