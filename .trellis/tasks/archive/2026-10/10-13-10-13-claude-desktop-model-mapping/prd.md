# 10-13-claude-desktop-model-mapping

## Goal
支持 Claude Desktop 模型映射模式：当用户为 Claude Desktop 供应商配置非 Claude 模型（如 `deepseek-chat`、`gpt-4o`、`qwen-max` 等）时，自动或按需通过 CCG-Switch 本地代理进行请求转发，并将 Claude Desktop 客户端原生的 Sonnet / Opus / Haiku 档位透明映射重写为目标模型。

## Requirements

### 1. 代理路由扩展 (`src-tauri/src/proxy/provider_router.rs`)
- `strip_app_prefix`: 增加识别与剥离 `/claudedesktop` 前缀（如 `/claudedesktop/v1/messages` -> `/v1/messages`）。
- `detect_app_type`: 当请求路径以 `/claudedesktop` 开头时，识别为 `AppType::ClaudeDesktop`。
- `resolve_candidates`: 支持查询 `claudedesktop` 应用的活跃供应商及故障转移队列。
- `build_route`: 为 `AppType::ClaudeDesktop` 构建上游 URL 及认证头（同时支持 Bearer 与 x-api-key）。

### 2. 模型重写支持 (`src-tauri/src/proxy/handlers.rs`)
- 在 `handlers.rs` 的代理转发循环中，将 `AppType::ClaudeDesktop` 纳入 `model_mapper::apply_model_mapping` 处理范围。
- 当 Claude Desktop 发起请求（如 `claude-3-7-sonnet-20250219`、`claude-3-5-haiku-20241022`、`claude-3-opus-20240229`）时，根据该供应商配置的 `default_sonnet_model` / `default_opus_model` / `default_haiku_model` / `default_reasoning_model` 进行重写替换。

### 3. Claude Desktop 配置写入升级 (`src-tauri/src/services/claude_desktop_config.rs`)
- 判断 Provider 是否需要走本地代理映射：
  - 如果模型包含非 `is_claude_safe_model_id` 的模型（如 `deepseek-chat` 等），或者 Provider 的 meta 中显式开启了 `proxyMappingMode`：
    - 读取本地代理服务配置端口（默认 8080，支持动态读取实际代理端口/配置端口）；
    - 将 `inferenceGatewayBaseUrl` 写入 `http://127.0.0.1:{proxy_port}/claudedesktop`；
    - 将 `inferenceGatewayApiKey` 写入 `ccg-proxy-managed`；
    - 将 `inferenceModels` 转换为 Claude Desktop 能够合法识别的标准档位名（如 `["claude-3-7-sonnet-20250219", "claude-3-5-haiku-20241022", "claude-3-opus-20240229"]`），避免客户端校验拦截。
  - 如果所有模型均为合法的 Claude 原生模型且未指定映射模式，则保持原有直连网关写入逻辑。

### 4. 前端交互与表单放宽 (`src/components/providers/ProviderForm.tsx` & `ClaudeDesktopPanel.tsx`)
- 放开 `claudedesktop` 供应商的模型名称校验限制，允许输入任意大模型名称。
- 在表单中增加清晰的映射档位说明（Sonnet 档位对应模型、Opus 档位对应模型、Haiku 档位对应模型）。
- `ClaudeDesktopPanel.tsx` 状态条显示当前代理映射状态与端口提示。

### 5. i18n 多语言
- 在 `src/locales/zh.json` 与 `src/locales/en.json` 中同步新增相关文案。

## Acceptance Criteria
- [x] `strip_app_prefix` 与 `detect_app_type` 正确处理 `/claudedesktop` 前缀。
- [x] `handlers.rs` 成功对 `AppType::ClaudeDesktop` 请求执行模型重写并转发到上游。
- [x] `claude_desktop_config.rs` 在配置非 Claude 模型时正确写入代理地址与标准档位别名，且不抛出模型名称校验错误。
- [x] 前端表单支持为 Claude Desktop 配置非 Claude 模型并保存成功。
- [x] 所有 Rust 单元测试和 Vitest 前端测试全部通过，`npm run build` 无错误。
