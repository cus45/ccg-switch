# 本地代理接口协议转换 (Anthropic ↔ OpenAI/Gemini)

## Goal

使 CCG-Switch 本地代理支持将 Claude Code 及 Claude Desktop 发送的 Anthropic Messages API 格式请求自动双向转译为 OpenAI 兼容接口或 Google Gemini 接口，支持非流式及流式 SSE，支持工具调用（Tool Use / Tool Call / Tool Result），让用户能够在 Claude Code 中无缝使用 DeepSeek 原生、OpenAI 原生、Ollama、Qwen、Gemini 等各类主流供应商。

## Requirements

### 1. 供应商协议配置与识别
- 在 Provider 的 `meta` 中支持配置 `api_format`（可选值：`"anthropic"`、`"openai"`、`"gemini"`）。
- 若未显式配置，基于 Provider URL 进行智能兜底识别：
  - 含有 `generativelanguage.googleapis.com` 或 `/gemini` 判定为 Gemini；
  - 含有 `api.openai.com`、`deepseek.com` 或以 `/v1` 结尾（且非 anthropic.com）判定为 OpenAI；
  - 其它默认为 Anthropic 原生协议。
- 前端 `ProviderForm.tsx` 在应用为 Claude / Claude Desktop 时提供“API 协议 / 格式”选择器（支持 Anthropic、OpenAI 兼容、Google Gemini），并支持连通性测试联动。

### 2. 路由与认证适配
- 当上游协议为 OpenAI 兼容时：
  - 路径由 `/v1/messages` 重写为 `/chat/completions`（并处理 base_url 重复与前缀）。
  - 认证采用 `Authorization: Bearer <key>`，剥离 Anthropic 专属请求头（如 `x-api-key`、`anthropic-version` 等）。
- 当上游协议为 Gemini 时：
  - 路径由 `/v1/messages` 重写为 `/v1beta/models/{model}:generateContent`（流式请求为 `:streamGenerateContent?alt=sse`）。
  - 认证支持 `x-goog-api-key` 或 URL query `key=<key>`。

### 3. Anthropic ↔ OpenAI 双向转换引擎
- **请求体转换 (Anthropic -> OpenAI)**:
  - `system`（字符串或多段 text blocks）转换为 OpenAI 的 `messages` 首条 `role: "system"`。
  - `messages`:
    - `role`: user / assistant 映射。
    - 内容提取：文本块合并、图片块（base64）转为 OpenAI `image_url` data URI。
    - `tool_use` 块转换为 OpenAI assistant 消息的 `tool_calls`（含 `id`, `function.name`, `function.arguments` JSON 字符串）。
    - `tool_result` 块拆分转换为 OpenAI 的独立 `role: "tool"` 消息（带 `tool_call_id` 和对应执行结果）。
  - `tools`: Anthropic `input_schema` 映射为 OpenAI function `parameters`。
  - `tool_choice`: `"auto"` -> `"auto"`, `"any"` -> `"required"`, `{"type":"tool","name":"..."}` -> `{"type":"function","function":{"name":"..."}}`。
  - `max_tokens`、`temperature`、`top_p`、`stop_sequences` -> OpenAI 对应参数。
  - `stream` 保持布尔值。
- **响应体转换 (OpenAI -> Anthropic)**:
  - **非流式**:
    - OpenAI `choices[0].message` 转换为 Anthropic `content` blocks（text 块与 `tool_use` 块）。
    - `finish_reason` 映射：`"stop"` -> `"end_turn"`, `"tool_calls"` -> `"tool_use"`, `"length"` -> `"max_tokens"`。
    - `usage` 转换为 Anthropic `usage: { input_tokens, output_tokens }`。
  - **流式 SSE**:
    - 将 OpenAI SSE 数据块（`choices[0].delta`）转译为标准的 Anthropic SSE 事件流：
      - `message_start`
      - `content_block_start` (文本或 tool_use)
      - `content_block_delta` (文本 `text_delta` 或工具参数 `input_json_delta`)
      - `content_block_stop`
      - `message_delta` (输出 tokens 与 stop_reason)
      - `message_stop`
- **错误包装**:
  - 若 OpenAI 返回 4xx/5xx 错误，将其包装为标准 Anthropic 错误 JSON，防止 Claude Code 客户端解析崩溃。

### 4. Anthropic ↔ Gemini 双向转换引擎
- **请求体转换 (Anthropic -> Gemini)**:
  - `system` 转换为 Gemini 的 `systemInstruction: { parts: [{ text }] }`。
  - `messages`:
    - `user` -> `user`, `assistant` -> `model`。
    - 文本块转为 `{ text }`，图片块转为 `{ inlineData }`。
    - `tool_use` 转为 `{ functionCall: { name, args } }`。
    - `tool_result` 转为 `{ functionResponse: { name, response: { result } } }`。
  - `tools` 转换为 Gemini `functionDeclarations`。
  - `generationConfig`: `maxOutputTokens`, `temperature`, `topP`, `stopSequences`。
- **响应体转换 (Gemini -> Anthropic)**:
  - **非流式**: 解析 `candidates[0].content.parts` 映射为 Anthropic text / tool_use blocks，映射 `usageMetadata`。
  - **流式 SSE**: 解析 Gemini SSE chunks 映射为 Anthropic 流式事件流。

### 5. 质量保证与用量统计
- 与现有的 `response_processor.rs` / `UsageLogger` 无缝集成，正确记账输入/输出 token 与延迟。
- 覆盖率高、端到端的单元测试与集成测试（覆盖请求转换、非流式响应转换、流式转换、Tool Calls 多轮交互）。

## Acceptance Criteria

- [x] 新增 `src-tauri/src/proxy/translator/` 模块，包含 `mod.rs`, `openai.rs`, `gemini.rs` 等。
- [x] 完整支持 Anthropic Messages API 到 OpenAI Chat Completions API 的请求格式、非流式响应、流式 SSE、Tool Calls 转换。
- [x] 完整支持 Anthropic Messages API 到 Google Gemini generateContent 的请求格式、非流式响应、流式 SSE、Tool Calls 转换。
- [x] 代理转发路由集成：当 Provider 协议非 Anthropic 时，自动转写请求 URL、请求头、请求体，并将上游响应实时转译回 Anthropic 协议。
- [x] Provider 数据模型与前端 UI：`ProviderForm.tsx` 支持选择并持久化 `api_format`，连通性测试联动正确。
- [x] 前端与后端所有测试通过，`cargo check` 0 警告，`npm run build` 成功。
