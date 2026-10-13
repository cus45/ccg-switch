# 技术方案设计：本地代理接口协议转换 (Anthropic ↔ OpenAI/Gemini)

## 架构概览

CCG-Switch 代理层作为反向代理，当 Claude Code / Claude Desktop 发送请求时：
```
Claude Code / Desktop (Anthropic Protocol: POST /v1/messages)
       │
       ▼
Local Proxy (CCG-Switch proxy_handler)
       │
       ├─► 1. 提取 Provider，识别协议目标 ApiFormat (Anthropic / OpenAI / Gemini)
       │      • 若为 Anthropic: 透传 (原有模式)
       │      • 若为 OpenAI:
       │          - 重写目标 URL: `base_url + /chat/completions`
       │          - 注入 Bearer token 认证头，剥离 Anthropic 专属头
       │          - 转换请求体: `anthropic_to_openai_request(&body_json)`
       │          - 向上游发送请求
       │          - 接收上游响应:
       │              • 非流式: `openai_to_anthropic_response(&upstream_json)`
       │              • 流式 SSE: 通过流转换器将 OpenAI delta 转为 Anthropic SSE 事件流
       │      • 若为 Gemini:
       │          - 重写目标 URL: `base_url + /v1beta/models/{model}:generateContent` (或 streamGenerateContent)
       │          - 注入 x-goog-api-key / ?key=
       │          - 转换请求体: `anthropic_to_gemini_request(&body_json)`
       │          - 接收上游响应转译回 Anthropic Messages / SSE 格式
       │
       ▼
返回 Anthropic Messages 协议响应给 Claude Code
```

## 模块结构

- `src-tauri/src/proxy/translator/mod.rs`:
  - 定义 `ApiFormat` 枚举 (`Anthropic`, `OpenAi`, `Gemini`)。
  - Provider 协议推断辅助函数 `detect_api_format(provider, app_type) -> ApiFormat`。
- `src-tauri/src/proxy/translator/openai.rs`:
  - `anthropic_to_openai_request(anthropic_json: &Value) -> Result<Value, ProxyError>`
  - `openai_to_anthropic_response(openai_json: &Value) -> Result<Value, ProxyError>`
  - `OpenAiSseTranslator`: 状态机转换器，将 OpenAI 流式 chunks 转换为 Anthropic SSE 事件字符串流。
  - `openai_error_to_anthropic(status: u16, error_body: &str) -> Value`
- `src-tauri/src/proxy/translator/gemini.rs`:
  - `anthropic_to_gemini_request(anthropic_json: &Value) -> Result<Value, ProxyError>`
  - `gemini_to_anthropic_response(gemini_json: &Value, model: &str) -> Result<Value, ProxyError>`
  - `GeminiSseTranslator`: 将 Gemini SSE chunks 转换为 Anthropic SSE 事件流。
- `src-tauri/src/proxy/handlers.rs` & `provider_router.rs`:
  - 路由与上游 URL 构建根据 `ApiFormat` 调整。
  - 请求体在发送前根据协议执行转译。
  - 响应在进入 `response_processor` 或 `handlers` 时进行流式/非流式包装。
- 前端 `src/components/providers/ProviderForm.tsx`:
  - 增加 `apiFormat` 选择控件，连通性测试匹配协议。

## 流式转换（SSE 状态机）

### OpenAI SSE 转换为 Anthropic SSE
OpenAI SSE 数据格式：
`data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"role":"assistant","content":"hello"},"finish_reason":null}]}`
`data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"calc","arguments":"{\"a\":1}"}}]},"finish_reason":null}]}`
`data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5}}`
`data: [DONE]`

Anthropic SSE 事件序列需求：
1. 首帧到来时（若尚未发出 `message_start`）：
   发 `event: message_start`
   ```json
   {
     "type": "message_start",
     "message": {
       "id": "msg_<chatcmpl-id>",
       "type": "message",
       "role": "assistant",
       "model": "<model>",
       "content": [],
       "stop_reason": null,
       "stop_sequence": null,
       "usage": { "input_tokens": 0, "output_tokens": 0 }
     }
   }
   ```
2. 当有文本 `content` delta 时：
   - 若当前未开启 text content_block，发 `event: content_block_start`:
     `{"type":"content_block_start","index":block_idx,"content_block":{"type":"text","text":""}}`
   - 发 `event: content_block_delta`:
     `{"type":"content_block_delta","index":block_idx,"delta":{"type":"text_delta","text":"..."}}`
3. 当有 `tool_calls` delta 时：
   - 若之前有开启的 text block，发 `event: content_block_stop`。
   - 对每个 tool call，若新 index，发 `event: content_block_start`:
     `{"type":"content_block_start","index":tool_block_idx,"content_block":{"type":"tool_use","id":"...","name":"...","input":{}}}`
   - 随后的 arguments delta，发 `event: content_block_delta`:
     `{"type":"content_block_delta","index":tool_block_idx,"delta":{"type":"input_json_delta","partial_json":"..."}}`
4. 当某个 block 结束或整体结束时：
   - 确保当前活动的 block 发 `event: content_block_stop`。
5. 当收到 `finish_reason` 或 `[DONE]` 时：
   - 发 `event: message_delta`:
     `{"type":"message_delta","delta":{"stop_reason":"end_turn"|"tool_use","stop_sequence":null},"usage":{"output_tokens":...}}`
   - 发 `event: message_stop`
     `{"type":"message_stop"}`
