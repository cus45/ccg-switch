# 执行计划：本地代理接口协议转换 (Anthropic ↔ OpenAI/Gemini)

## 执行步骤

### 阶段 1：协议转换引擎核心 (`src-tauri/src/proxy/translator/`)
- [x] 1.1 创建 `src-tauri/src/proxy/translator/mod.rs`：
  - 定义 `ApiFormat` 枚举 (`Anthropic`, `OpenAi`, `Gemini`) 及序列化/解析。
  - 实现 `detect_api_format(&Provider, AppType) -> ApiFormat`。
- [x] 1.2 实现 `src-tauri/src/proxy/translator/openai.rs`：
  - `anthropic_to_openai_request`：完整映射 messages, system, tools, tool_choice, parameters。
  - `openai_to_anthropic_response`：完整映射 choices, tool_calls, usage, stop_reason。
  - `OpenAiSseTranslator`：状态机解析 OpenAI SSE 并生成标准 Anthropic SSE 事件。
  - 单元测试：各种消息组合、tool_use / tool_result、SSE 事件流转换。
- [x] 1.3 实现 `src-tauri/src/proxy/translator/gemini.rs`：
  - `anthropic_to_gemini_request`：完整映射 contents, systemInstruction, tools。
  - `gemini_to_anthropic_response`：映射 candidates, functionCall, usage。
  - `GeminiSseTranslator`：处理 Gemini SSE 流事件。
  - 单元测试：Gemini 格式请求与响应双向转译。

### 阶段 2：代理路由与处理器集成 (`src-tauri/src/proxy/`)
- [x] 2.1 修改 `provider_router.rs`：
  - 根据 `ApiFormat` 构建对应的上游目标 URL（如 OpenAI 走 `/chat/completions`，Gemini 走 `/v1beta/models/...`）。
  - 根据 `ApiFormat` 构建认证头（OpenAI 走 Bearer，Gemini 走 `x-goog-api-key` 或 query，Anthropic 保持原有逻辑）。
- [x] 2.2 修改 `handlers.rs`：
  - 当 `app_type` 为 `Claude` 或 `ClaudeDesktop` 且目标 Provider 为 `OpenAi` 或 `Gemini` 时：
    - 在模型映射之后，调用对应的 request translator 将 Anthropic 请求体转译为目标格式。
    - 处理流式与非流式响应转换：非流式由 response translator 转译，流式通过 SSE translator 进行实时流转译。
    - 上游错误友好包装。

### 阶段 3：前端配置与连通性测试
- [x] 3.1 `ProviderForm.tsx`：
  - 为 Claude / Claude Desktop 添加 API 协议格式单选或下拉选择框（`Anthropic 原生` / `OpenAI 兼容` / `Google Gemini`）。
  - 保存至 `provider.meta.api_format`。
  - 连通性测试根据 `api_format` 选择正确的测试协议。
- [x] 3.2 国际化语言包（`zh.json` & `en.json`）添加对应文案。

### 阶段 4：测试与质量门禁
- [x] 4.1 编写 Rust 端到端与单元测试，确保各类场景（普通对话、多轮对话、带图对话、工具调用、流式中断）全部通过。
- [x] 4.2 运行 `cargo test`、`cargo check`、`npm run build`、Vitest 测试。
