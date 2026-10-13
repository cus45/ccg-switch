use serde_json::{json, Value};
use std::collections::HashMap;

/// 将 Anthropic Messages API 请求体转换为 OpenAI Chat Completions API 请求体
pub fn anthropic_to_openai_request(anthropic: &Value) -> Result<Value, String> {
    let mut openai_req = json!({});

    // 1. 模型名
    if let Some(model) = anthropic.get("model") {
        openai_req["model"] = model.clone();
    } else {
        return Err("缺少 model 字段".to_string());
    }

    let mut messages: Vec<Value> = Vec::new();

    // 2. System Prompt
    if let Some(system_val) = anthropic.get("system") {
        let system_text = match system_val {
            Value::String(s) => s.clone(),
            Value::Array(arr) => {
                let parts: Vec<String> = arr
                    .iter()
                    .filter_map(|block| {
                        if block.get("type").and_then(|t| t.as_str()) == Some("text") {
                            block.get("text").and_then(|t| t.as_str()).map(String::from)
                        } else {
                            None
                        }
                    })
                    .collect();
                parts.join("\n\n")
            }
            _ => String::new(),
        };

        if !system_text.is_empty() {
            messages.push(json!({
                "role": "system",
                "content": system_text
            }));
        }
    }

    // 3. 对话消息列表
    if let Some(anthropic_msgs) = anthropic.get("messages").and_then(|m| m.as_array()) {
        for msg in anthropic_msgs {
            let role = msg
                .get("role")
                .and_then(|r| r.as_str())
                .unwrap_or("user");

            match msg.get("content") {
                Some(Value::String(s)) => {
                    messages.push(json!({
                        "role": role,
                        "content": s
                    }));
                }
                Some(Value::Array(blocks)) => {
                    if role == "user" {
                        // User 消息中可能混有 tool_result 和 普通文本/图片
                        let mut tool_results = Vec::new();
                        let mut user_parts = Vec::new();

                        for block in blocks {
                            let block_type = block.get("type").and_then(|t| t.as_str()).unwrap_or("");
                            if block_type == "tool_result" {
                                tool_results.push(block);
                            } else if block_type == "text" {
                                if let Some(text) = block.get("text").and_then(|t| t.as_str()) {
                                    user_parts.push(json!({
                                        "type": "text",
                                        "text": text
                                    }));
                                }
                            } else if block_type == "image" {
                                if let Some(source) = block.get("source") {
                                    let media_type = source
                                        .get("media_type")
                                        .and_then(|m| m.as_str())
                                        .unwrap_or("image/jpeg");
                                    let data = source.get("data").and_then(|d| d.as_str()).unwrap_or("");
                                    let url = format!("data:{};base64,{}", media_type, data);
                                    user_parts.push(json!({
                                        "type": "image_url",
                                        "image_url": { "url": url }
                                    }));
                                }
                            }
                        }

                        // 先追加 tool_result（OpenAI 要求 role: "tool" 消息独立）
                        for tr in tool_results {
                            let tool_call_id = tr
                                .get("tool_use_id")
                                .and_then(|id| id.as_str())
                                .unwrap_or("");

                            let content_str = match tr.get("content") {
                                Some(Value::String(s)) => s.clone(),
                                Some(Value::Array(arr)) => {
                                    let texts: Vec<&str> = arr
                                        .iter()
                                        .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
                                        .collect();
                                    texts.join("\n")
                                }
                                Some(other) => other.to_string(),
                                None => String::new(),
                            };

                            let is_error = tr.get("is_error").and_then(|e| e.as_bool()).unwrap_or(false);
                            let final_content = if is_error && !content_str.starts_with("Error:") {
                                format!("Error: {}", content_str)
                            } else {
                                content_str
                            };

                            messages.push(json!({
                                "role": "tool",
                                "tool_call_id": tool_call_id,
                                "content": final_content
                            }));
                        }

                        // 如果还有普通用户输入文本或图片
                        if !user_parts.is_empty() {
                            if user_parts.len() == 1 && user_parts[0]["type"] == "text" {
                                messages.push(json!({
                                    "role": "user",
                                    "content": user_parts[0]["text"]
                                }));
                            } else {
                                messages.push(json!({
                                    "role": "user",
                                    "content": user_parts
                                }));
                            }
                        }
                    } else if role == "assistant" {
                        let mut text_parts = Vec::new();
                        let mut tool_calls = Vec::new();

                        for block in blocks {
                            let block_type = block.get("type").and_then(|t| t.as_str()).unwrap_or("");
                            if block_type == "text" {
                                if let Some(t) = block.get("text").and_then(|s| s.as_str()) {
                                    text_parts.push(t);
                                }
                            } else if block_type == "tool_use" {
                                let id = block.get("id").and_then(|i| i.as_str()).unwrap_or("");
                                let name = block.get("name").and_then(|n| n.as_str()).unwrap_or("");
                                let input = block.get("input").cloned().unwrap_or(json!({}));
                                let args_str = serde_json::to_string(&input).unwrap_or_else(|_| "{}".to_string());

                                tool_calls.push(json!({
                                    "id": id,
                                    "type": "function",
                                    "function": {
                                        "name": name,
                                        "arguments": args_str
                                    }
                                }));
                            }
                            // 忽略 Anthropic 的 thinking 签名块
                        }

                        let text_content = text_parts.join("");
                        let mut assistant_msg = json!({
                            "role": "assistant"
                        });

                        if text_content.is_empty() && !tool_calls.is_empty() {
                            assistant_msg["content"] = Value::Null;
                        } else {
                            assistant_msg["content"] = Value::String(text_content);
                        }

                        if !tool_calls.is_empty() {
                            assistant_msg["tool_calls"] = Value::Array(tool_calls);
                        }

                        messages.push(assistant_msg);
                    }
                }
                _ => {}
            }
        }
    }

    openai_req["messages"] = Value::Array(messages);

    // 4. 工具声明 (tools)
    if let Some(anthropic_tools) = anthropic.get("tools").and_then(|t| t.as_array()) {
        let openai_tools: Vec<Value> = anthropic_tools
            .iter()
            .map(|tool| {
                let name = tool.get("name").and_then(|n| n.as_str()).unwrap_or("");
                let description = tool.get("description").cloned().unwrap_or(Value::Null);
                let parameters = tool.get("input_schema").cloned().unwrap_or(json!({
                    "type": "object",
                    "properties": {}
                }));

                let mut function_obj = json!({
                    "name": name,
                    "parameters": parameters
                });
                if !description.is_null() {
                    function_obj["description"] = description;
                }

                json!({
                    "type": "function",
                    "function": function_obj
                })
            })
            .collect();

        if !openai_tools.is_empty() {
            openai_req["tools"] = Value::Array(openai_tools);
        }
    }

    // 5. Tool choice
    if let Some(tool_choice) = anthropic.get("tool_choice") {
        match tool_choice {
            Value::String(s) => {
                openai_req["tool_choice"] = Value::String(s.clone());
            }
            Value::Object(obj) => {
                let choice_type = obj.get("type").and_then(|t| t.as_str()).unwrap_or("auto");
                match choice_type {
                    "auto" => openai_req["tool_choice"] = json!("auto"),
                    "any" => openai_req["tool_choice"] = json!("required"),
                    "tool" => {
                        if let Some(name) = obj.get("name").and_then(|n| n.as_str()) {
                            openai_req["tool_choice"] = json!({
                                "type": "function",
                                "function": { "name": name }
                            });
                        }
                    }
                    _ => openai_req["tool_choice"] = json!("auto"),
                }
            }
            _ => {}
        }
    }

    // 6. 其他常用超参
    if let Some(max_tokens) = anthropic.get("max_tokens") {
        openai_req["max_tokens"] = max_tokens.clone();
    }
    if let Some(temperature) = anthropic.get("temperature") {
        openai_req["temperature"] = temperature.clone();
    }
    if let Some(top_p) = anthropic.get("top_p") {
        openai_req["top_p"] = top_p.clone();
    }
    if let Some(stop_seqs) = anthropic.get("stop_sequences") {
        openai_req["stop"] = stop_seqs.clone();
    }
    if let Some(stream) = anthropic.get("stream") {
        openai_req["stream"] = stream.clone();
        if stream.as_bool() == Some(true) {
            openai_req["stream_options"] = json!({
                "include_usage": true
            });
        }
    }

    Ok(openai_req)
}

/// 将 OpenAI Chat Completions 响应体转换为 Anthropic Messages 响应体
pub fn openai_to_anthropic_response(openai: &Value) -> Result<Value, String> {
    let raw_id = openai
        .get("id")
        .and_then(|i| i.as_str())
        .unwrap_or("chatcmpl-unknown");
    let msg_id = if raw_id.starts_with("msg_") {
        raw_id.to_string()
    } else {
        format!("msg_{}", raw_id)
    };

    let model = openai
        .get("model")
        .and_then(|m| m.as_str())
        .unwrap_or("unknown");

    let choice = openai
        .get("choices")
        .and_then(|c| c.as_array())
        .and_then(|arr| arr.first())
        .ok_or_else(|| "OpenAI 响应中未找到 choices".to_string())?;

    let message = choice
        .get("message")
        .ok_or_else(|| "Choice 中缺少 message".to_string())?;

    let mut content_blocks: Vec<Value> = Vec::new();

    // 文本内容
    if let Some(content_str) = message.get("content").and_then(|c| c.as_str()) {
        if !content_str.is_empty() {
            content_blocks.push(json!({
                "type": "text",
                "text": content_str
            }));
        }
    }

    // 工具调用 (tool_calls)
    if let Some(tool_calls) = message.get("tool_calls").and_then(|t| t.as_array()) {
        for tc in tool_calls {
            let id = tc.get("id").and_then(|i| i.as_str()).unwrap_or("");
            let name = tc
                .get("function")
                .and_then(|f| f.get("name"))
                .and_then(|n| n.as_str())
                .unwrap_or("");
            let args_raw = tc
                .get("function")
                .and_then(|f| f.get("arguments"))
                .and_then(|a| a.as_str())
                .unwrap_or("{}");

            let input_json: Value = serde_json::from_str(args_raw).unwrap_or(json!({}));

            content_blocks.push(json!({
                "type": "tool_use",
                "id": id,
                "name": name,
                "input": input_json
            }));
        }
    }

    if content_blocks.is_empty() {
        content_blocks.push(json!({
            "type": "text",
            "text": ""
        }));
    }

    // 结束原因
    let finish_reason = choice.get("finish_reason").and_then(|f| f.as_str());
    let stop_reason = match finish_reason {
        Some("stop") => "end_turn",
        Some("tool_calls") => "tool_use",
        Some("length") => "max_tokens",
        _ => "end_turn",
    };

    // 用量统计
    let input_tokens = openai
        .get("usage")
        .and_then(|u| u.get("prompt_tokens"))
        .and_then(|pt| pt.as_u64())
        .unwrap_or(0);
    let output_tokens = openai
        .get("usage")
        .and_then(|u| u.get("completion_tokens"))
        .and_then(|ct| ct.as_u64())
        .unwrap_or(0);

    let anthropic_resp = json!({
        "id": msg_id,
        "type": "message",
        "role": "assistant",
        "model": model,
        "content": content_blocks,
        "stop_reason": stop_reason,
        "stop_sequence": null,
        "usage": {
            "input_tokens": input_tokens,
            "output_tokens": output_tokens
        }
    });

    Ok(anthropic_resp)
}

/// OpenAI SSE 流式转译器：将 OpenAI chunk 转译为标准的 Anthropic SSE 事件流
pub struct OpenAiSseTranslator {
    pub message_id: String,
    pub model: String,
    pub sent_message_start: bool,
    pub current_block_index: usize,
    pub in_text_block: bool,
    // (openai tool_call index -> (anthropic_block_index, tool_id))
    pub tool_blocks: HashMap<usize, (usize, String)>,
    pub finish_reason: Option<String>,
    pub input_tokens: u64,
    pub output_tokens: u64,
}

impl OpenAiSseTranslator {
    pub fn new(fallback_model: &str) -> Self {
        Self {
            message_id: format!("msg_{}", uuid::Uuid::new_v4().to_string().replace("-", "")[..24].to_string()),
            model: fallback_model.to_string(),
            sent_message_start: false,
            current_block_index: 0,
            in_text_block: false,
            tool_blocks: HashMap::new(),
            finish_reason: None,
            input_tokens: 0,
            output_tokens: 0,
        }
    }

    /// 翻译单个 OpenAI SSE chunk，输出若干个标准的 Anthropic SSE 事件（每个事件以 `\n\n` 结尾）
    pub fn translate_chunk(&mut self, chunk: &Value) -> Vec<String> {
        let mut events = Vec::new();

        // 提取 chunk 中的 message_id 与 model
        if let Some(id_str) = chunk.get("id").and_then(|i| i.as_str()) {
            if !id_str.is_empty() {
                self.message_id = if id_str.starts_with("msg_") {
                    id_str.to_string()
                } else {
                    format!("msg_{}", id_str)
                };
            }
        }
        if let Some(model_str) = chunk.get("model").and_then(|m| m.as_str()) {
            if !model_str.is_empty() {
                self.model = model_str.to_string();
            }
        }

        // 提取 usage（如果包含 stream_options.include_usage）
        if let Some(usage) = chunk.get("usage") {
            if let Some(pt) = usage.get("prompt_tokens").and_then(|v| v.as_u64()) {
                self.input_tokens = pt;
            }
            if let Some(ct) = usage.get("completion_tokens").and_then(|v| v.as_u64()) {
                self.output_tokens = ct;
            }
        }

        // 1. 发送 message_start 事件
        if !self.sent_message_start {
            self.sent_message_start = true;
            let start_evt = json!({
                "type": "message_start",
                "message": {
                    "id": self.message_id,
                    "type": "message",
                    "role": "assistant",
                    "model": self.model,
                    "content": [],
                    "stop_reason": null,
                    "stop_sequence": null,
                    "usage": {
                        "input_tokens": self.input_tokens,
                        "output_tokens": 0
                    }
                }
            });
            events.push(format!("event: message_start\ndata: {}\n\n", start_evt));
        }

        let choice = match chunk.get("choices").and_then(|c| c.as_array()).and_then(|arr| arr.first()) {
            Some(c) => c,
            None => return events,
        };

        if let Some(fr) = choice.get("finish_reason").and_then(|f| f.as_str()) {
            self.finish_reason = Some(fr.to_string());
        }

        let delta = match choice.get("delta") {
            Some(d) => d,
            None => return events,
        };

        // 2. 文本 Delta
        if let Some(content_text) = delta.get("content").and_then(|c| c.as_str()) {
            if !content_text.is_empty() {
                if !self.in_text_block {
                    // 开始 text content block
                    self.in_text_block = true;
                    let block_start = json!({
                        "type": "content_block_start",
                        "index": self.current_block_index,
                        "content_block": {
                            "type": "text",
                            "text": ""
                        }
                    });
                    events.push(format!("event: content_block_start\ndata: {}\n\n", block_start));
                }

                let block_delta = json!({
                    "type": "content_block_delta",
                    "index": self.current_block_index,
                    "delta": {
                        "type": "text_delta",
                        "text": content_text
                    }
                });
                events.push(format!("event: content_block_delta\ndata: {}\n\n", block_delta));
            }
        }

        // 3. 工具调用 Delta
        if let Some(tool_calls) = delta.get("tool_calls").and_then(|tc| tc.as_array()) {
            // 如果文本块仍在开启，先关闭文本块
            if self.in_text_block {
                let block_stop = json!({
                    "type": "content_block_stop",
                    "index": self.current_block_index
                });
                events.push(format!("event: content_block_stop\ndata: {}\n\n", block_stop));
                self.in_text_block = false;
                self.current_block_index += 1;
            }

            for tc in tool_calls {
                let tc_idx = tc.get("index").and_then(|i| i.as_u64()).unwrap_or(0) as usize;

                if !self.tool_blocks.contains_key(&tc_idx) {
                    let tc_id = match tc.get("id").and_then(|i| i.as_str()) {
                        Some(id) if !id.is_empty() => id.to_string(),
                        _ => format!("call_{}", &uuid::Uuid::new_v4().to_string().replace("-", "")[..16]),
                    };
                    let fn_name = tc
                        .get("function")
                        .and_then(|f| f.get("name"))
                        .and_then(|n| n.as_str())
                        .unwrap_or("tool");

                    let anthropic_idx = self.current_block_index;
                    self.current_block_index += 1;
                    self.tool_blocks.insert(tc_idx, (anthropic_idx, tc_id.clone()));

                    let tool_start = json!({
                        "type": "content_block_start",
                        "index": anthropic_idx,
                        "content_block": {
                            "type": "tool_use",
                            "id": tc_id,
                            "name": fn_name,
                            "input": {}
                        }
                    });
                    events.push(format!("event: content_block_start\ndata: {}\n\n", tool_start));
                }

                // 传递 partial_json 参数
                if let Some(args_delta) = tc
                    .get("function")
                    .and_then(|f| f.get("arguments"))
                    .and_then(|a| a.as_str())
                {
                    if !args_delta.is_empty() {
                        let (anthropic_idx, _) = self.tool_blocks[&tc_idx];
                        let tool_delta = json!({
                            "type": "content_block_delta",
                            "index": anthropic_idx,
                            "delta": {
                                "type": "input_json_delta",
                                "partial_json": args_delta
                            }
                        });
                        events.push(format!("event: content_block_delta\ndata: {}\n\n", tool_delta));
                    }
                }
            }
        }

        events
    }

    /// 在流结束时生成终止事件 (`content_block_stop`, `message_delta`, `message_stop`)
    pub fn finish(&mut self) -> Vec<String> {
        let mut events = Vec::new();

        // 确保未关闭的 text 块关闭
        if self.in_text_block {
            let block_stop = json!({
                "type": "content_block_stop",
                "index": self.current_block_index
            });
            events.push(format!("event: content_block_stop\ndata: {}\n\n", block_stop));
            self.in_text_block = false;
        }

        // 确保所有 tool_use 块都关闭
        for (_openai_idx, (anthropic_idx, _)) in &self.tool_blocks {
            let block_stop = json!({
                "type": "content_block_stop",
                "index": anthropic_idx
            });
            events.push(format!("event: content_block_stop\ndata: {}\n\n", block_stop));
        }

        // 映射 stop_reason
        let stop_reason = match self.finish_reason.as_deref() {
            Some("stop") => "end_turn",
            Some("tool_calls") => "tool_use",
            Some("length") => "max_tokens",
            _ => {
                if !self.tool_blocks.is_empty() {
                    "tool_use"
                } else {
                    "end_turn"
                }
            }
        };

        // message_delta
        let msg_delta = json!({
            "type": "message_delta",
            "delta": {
                "stop_reason": stop_reason,
                "stop_sequence": null
            },
            "usage": {
                "output_tokens": self.output_tokens
            }
        });
        events.push(format!("event: message_delta\ndata: {}\n\n", msg_delta));

        // message_stop
        let msg_stop = json!({
            "type": "message_stop"
        });
        events.push(format!("event: message_stop\ndata: {}\n\n", msg_stop));

        events
    }
}

/// 将 OpenAI 格式的错误响应转为 Anthropic Messages 格式的错误 JSON
pub fn openai_error_to_anthropic(status: u16, error_body: &str) -> Value {
    let mut message = format!("Upstream HTTP {}", status);

    if let Ok(json_err) = serde_json::from_str::<Value>(error_body) {
        if let Some(msg) = json_err.get("error").and_then(|e| e.get("message")).and_then(|m| m.as_str()) {
            message = msg.to_string();
        } else if let Some(msg) = json_err.get("message").and_then(|m| m.as_str()) {
            message = msg.to_string();
        }
    }

    let error_type = match status {
        400 => "invalid_request_error",
        401 => "authentication_error",
        403 => "permission_error",
        404 => "not_found_error",
        429 => "rate_limit_error",
        _ => "api_error",
    };

    json!({
        "type": "error",
        "error": {
            "type": error_type,
            "message": message
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_anthropic_to_openai_simple_request() {
        let anthropic = json!({
            "model": "claude-3-7-sonnet-20250219",
            "system": "You are a helpful coding assistant.",
            "messages": [
                {
                    "role": "user",
                    "content": "Hello world"
                }
            ],
            "max_tokens": 1024,
            "stream": true
        });

        let openai = anthropic_to_openai_request(&anthropic).unwrap();
        assert_eq!(openai["model"], "claude-3-7-sonnet-20250219");
        assert_eq!(openai["max_tokens"], 1024);
        assert_eq!(openai["stream"], true);

        let msgs = openai["messages"].as_array().unwrap();
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[0]["role"], "system");
        assert_eq!(msgs[0]["content"], "You are a helpful coding assistant.");
        assert_eq!(msgs[1]["role"], "user");
        assert_eq!(msgs[1]["content"], "Hello world");
    }

    #[test]
    fn test_anthropic_to_openai_tools_and_multi_turn() {
        let anthropic = json!({
            "model": "gpt-4o",
            "messages": [
                {
                    "role": "user",
                    "content": [
                        { "type": "text", "text": "What is the weather?" }
                    ]
                },
                {
                    "role": "assistant",
                    "content": [
                        { "type": "text", "text": "Checking weather..." },
                        {
                            "type": "tool_use",
                            "id": "call_123",
                            "name": "get_weather",
                            "input": { "location": "Beijing" }
                        }
                    ]
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": "call_123",
                            "content": "22C, sunny"
                        }
                    ]
                }
            ],
            "tools": [
                {
                    "name": "get_weather",
                    "description": "Get current weather",
                    "input_schema": {
                        "type": "object",
                        "properties": {
                            "location": { "type": "string" }
                        },
                        "required": ["location"]
                    }
                }
            ],
            "tool_choice": { "type": "auto" }
        });

        let openai = anthropic_to_openai_request(&anthropic).unwrap();
        let msgs = openai["messages"].as_array().unwrap();
        assert_eq!(msgs.len(), 3);

        // Turn 1: user
        assert_eq!(msgs[0]["role"], "user");
        assert_eq!(msgs[0]["content"], "What is the weather?");

        // Turn 2: assistant with tool_calls
        assert_eq!(msgs[1]["role"], "assistant");
        assert_eq!(msgs[1]["content"], "Checking weather...");
        let tc = &msgs[1]["tool_calls"][0];
        assert_eq!(tc["id"], "call_123");
        assert_eq!(tc["function"]["name"], "get_weather");

        // Turn 3: tool result
        assert_eq!(msgs[2]["role"], "tool");
        assert_eq!(msgs[2]["tool_call_id"], "call_123");
        assert_eq!(msgs[2]["content"], "22C, sunny");

        // Tools
        let tools = openai["tools"].as_array().unwrap();
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0]["type"], "function");
        assert_eq!(tools[0]["function"]["name"], "get_weather");
        assert_eq!(openai["tool_choice"], "auto");
    }

    #[test]
    fn test_openai_to_anthropic_response() {
        let openai = json!({
            "id": "chatcmpl-test123",
            "model": "deepseek-chat",
            "choices": [
                {
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": "Here is your code.",
                        "tool_calls": [
                            {
                                "id": "call_abc",
                                "type": "function",
                                "function": {
                                    "name": "run_shell",
                                    "arguments": "{\"cmd\":\"ls\"}"
                                }
                            }
                        ]
                    },
                    "finish_reason": "tool_calls"
                }
            ],
            "usage": {
                "prompt_tokens": 50,
                "completion_tokens": 30
            }
        });

        let anthropic = openai_to_anthropic_response(&openai).unwrap();
        assert_eq!(anthropic["id"], "msg_chatcmpl-test123");
        assert_eq!(anthropic["type"], "message");
        assert_eq!(anthropic["role"], "assistant");
        assert_eq!(anthropic["model"], "deepseek-chat");
        assert_eq!(anthropic["stop_reason"], "tool_use");
        assert_eq!(anthropic["usage"]["input_tokens"], 50);
        assert_eq!(anthropic["usage"]["output_tokens"], 30);

        let content = anthropic["content"].as_array().unwrap();
        assert_eq!(content.len(), 2);
        assert_eq!(content[0]["type"], "text");
        assert_eq!(content[0]["text"], "Here is your code.");
        assert_eq!(content[1]["type"], "tool_use");
        assert_eq!(content[1]["id"], "call_abc");
        assert_eq!(content[1]["name"], "run_shell");
        assert_eq!(content[1]["input"]["cmd"], "ls");
    }

    #[test]
    fn test_openai_sse_translator() {
        let mut translator = OpenAiSseTranslator::new("gpt-4o");

        let chunk1 = json!({
            "id": "chatcmpl-stream1",
            "model": "gpt-4o",
            "choices": [
                {
                    "index": 0,
                    "delta": {
                        "role": "assistant",
                        "content": "Hello"
                    },
                    "finish_reason": null
                }
            ]
        });

        let evts1 = translator.translate_chunk(&chunk1);
        // Expect message_start + content_block_start + content_block_delta
        assert!(evts1.iter().any(|e| e.contains("event: message_start")));
        assert!(evts1.iter().any(|e| e.contains("event: content_block_start")));
        assert!(evts1.iter().any(|e| e.contains("event: content_block_delta")));

        let chunk2 = json!({
            "id": "chatcmpl-stream1",
            "choices": [
                {
                    "index": 0,
                    "delta": {
                        "content": " world"
                    },
                    "finish_reason": null
                }
            ]
        });
        let evts2 = translator.translate_chunk(&chunk2);
        assert_eq!(evts2.len(), 1);
        assert!(evts2[0].contains("event: content_block_delta"));

        let chunk3 = json!({
            "choices": [
                {
                    "index": 0,
                    "delta": {},
                    "finish_reason": "stop"
                }
            ],
            "usage": {
                "prompt_tokens": 10,
                "completion_tokens": 5
            }
        });
        let _ = translator.translate_chunk(&chunk3);

        let finish_evts = translator.finish();
        assert!(finish_evts.iter().any(|e| e.contains("event: content_block_stop")));
        assert!(finish_evts.iter().any(|e| e.contains("event: message_delta")));
        assert!(finish_evts.iter().any(|e| e.contains("event: message_stop")));
    }
}
