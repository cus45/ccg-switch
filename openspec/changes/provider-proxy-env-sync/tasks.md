## 1. 数据模型更新

- [x] 1.1 Rust `ProviderProxyConfig` struct 新增 `http_proxy: Option<String>` 和 `https_proxy: Option<String>` 字段（serde rename `httpProxy`/`httpsProxy`，`skip_serializing_if = "Option::is_none"`，`default`）
- [x] 1.2 前端 `src/types/provider.ts` 的 `ProviderProxyConfig` 接口新增 `httpProxy?: string` 和 `httpsProxy?: string`

## 2. 后端同步逻辑

- [x] 2.1 在 `provider_service.rs` 的 `sync_to_claude_settings` 函数中，`remap_settings_to_env` 之前插入代理同步逻辑：读取 `provider.proxy_config`，enabled 且有值时写入 `env.HTTP_PROXY`/`env.HTTPS_PROXY`，否则 remove 这两个 key

## 3. 前端组件改造

- [x] 3.1 重写 `src/components/providers/ProviderProxyConfig.tsx`：去掉 host/port/username/password 拆分 UI，改为两个 URL 输入框（HTTP 代理、HTTPS 代理）+ 启用开关
- [x] 3.2 旧格式兼容：组件初始化时检测旧字段（`proxyHost`/`proxyPort`），用 `buildProxyUrl` 构建完整 URL 显示在输入框中
- [x] 3.3 保存时将输入框值写入新字段 `httpProxy`/`httpsProxy`，不再填充旧字段

## 4. 国际化

- [x] 4.1 更新 `src/locales/zh.json` 和 `en.json`，新增/修改代理相关翻译 key（如 `providers.httpProxy`、`providers.httpsProxy` 等）

## 5. 验证

- [x] 5.1 dev 模式下切换带代理配置的 Provider，确认 `~/.claude/settings.json` 的 env 中正确写入/清除 `HTTP_PROXY` 和 `HTTPS_PROXY`
