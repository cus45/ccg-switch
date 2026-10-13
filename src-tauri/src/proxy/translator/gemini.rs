use serde_json::{json, Value};
use std::collections::HashMap;

/// 将 Anthropic Messages API 请求体转换为 Google Gemini API 请求体
pub fn anthropic_to_gemini_request(anthropic: &Value) -> Result<Value, String> {
    let mut gemini_req = json!({});

    // 1. System Prompt -> systemInstruction
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
            gemini_req["systemInstruction"] = json!({
                "parts": [
                    { "text": system_text }
                ]
            });
        }
    }

    // 建立 tool_id -> tool_name 映射，便于 tool_result 查找对应函数名
    let mut tool_id_to_name: HashMap<String, String> = HashMap::new();

    // 2. 对话内容 contents
    let mut contents: Vec<Value> = Vec::new();

    if let Some(anthropic_msgs) = anthropic.get("messages").and_then(|m| m.as_array()) {
        for msg in anthropic_msgs {
            let role = msg
                .get("role")
                .and_then(|r| r.as_str())
                .unwrap_or("user");

            let gemini_role = match role {
                "assistant" => "model",
                _ => "user",
            };

            let mut parts: Vec<Value> = Vec::new();

            match msg.get("content") {
                Some(Value::String(s)) => {
                    parts.push(json!({ "text": s }));
                }
                Some(Value::Array(blocks)) => {
                    for block in blocks {
                        let block_type = block.get("type").and_then(|t| t.as_str()).unwrap_or("");
                        if block_type == "text" {
                            if let Some(t) = block.get("text").and_then(|s| s.as_str()) {
                                parts.push(json!({ "text": t }));
                            }
                        } else if block_type == "image" {
                            if let Some(source) = block.get("source") {
                                let media_type = source
                                    .get("media_type")
                                    .and_then(|m| m.as_str())
                                    .unwrap_or("image/jpeg");
                                let data = source.get("data").and_then(|d| d.as_str()).unwrap_or("");
                                parts.push(json!({
                                    "inlineData": {
                                        "mimeType": media_type,
                                        "data": data
                                    }
                                }));
                            }
                        } else if block_type == "tool_use" {
                            let id = block.get("id").and_then(|i| i.as_str()).unwrap_or("");
                            let name = block.get("name").and_then(|n| n.as_str()).unwrap_or("");
                            let input = block.get("input").cloned().unwrap_or(json!({}));

                            if !id.is_empty() && !name.is_empty() {
                                tool_id_to_name.insert(id.to_string(), name.to_string());
                            }

                            parts.push(json!({
                                "functionCall": {
                                    "name": name,
                                    "args": input
                                }
                            }));
                        } else if block_type == "tool_result" {
                            let tool_id = block.get("tool_use_id").and_then(|i| i.as_str()).unwrap_or("");
                            let fn_name = tool_id_to_name
                                .get(tool_id)
                                .cloned()
                                .unwrap_or_else(|| "function".to_string());

                            let content_val = match block.get("content") {
                                Some(Value::String(s)) => json!({ "output": s }),
                                Some(Value::Array(arr)) => {
                                    let texts: Vec<&str> = arr
                                        .iter()
                                        .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
                                        .collect();
                                    json!({ "output": texts.join("\n") })
                                }
                                Some(other) => json!({ "output": other }),
                                None => json!({ "output": "" }),
                            };

                            parts.push(json!({
                                "functionResponse": {
                                    "name": fn_name,
                                    "response": content_val
                                }
                            }));
                        }
                    }
                }
                _ => {}
            }

            if !parts.is_empty() {
                contents.push(json!({
                    "role": gemini_role,
                    "parts": parts
                }));
            }
        }
    }

    gemini_req["contents"] = Value::Array(contents);

    // 3. 工具声明 (tools -> functionDeclarations)
    if let Some(anthropic_tools) = anthropic.get("tools").and_then(|t| t.as_array()) {
        let fn_decls: Vec<Value> = anthropic_tools
            .iter()
            .map(|tool| {
                let name = tool.get("name").and_then(|n| n.as_str()).unwrap_or("");
                let description = tool.get("description").cloned().unwrap_or(Value::Null);
                let parameters = tool.get("input_schema").cloned().unwrap_or(json!({
                    "type": "object",
                    "properties": {}
                }));

                let mut decl = json!({
                    "name": name,
                    "parameters": parameters
                });
                if !description.is_null() {
                    decl["description"] = description;
                }
                decl
            })
            .collect();

        if !fn_decls.is_empty() {
            gemini_req["tools"] = json!([
                {
                    "functionDeclarations": fn_decls
                }
            ]);
        }
    }

    // 4. 超参数 generationConfig
    let mut gen_config = json!({});
    if let Some(max_tokens) = anthropic.get("max_tokens") {
        gen_config["maxOutputTokens"] = max_tokens.clone();
    }
    if let Some(temperature) = anthropic.get("temperature") {
        gen_config["temperature"] = temperature.clone();
    }
    if let Some(top_p) = anthropic.get("top_p") {
        gen_config["topP"] = top_p.clone();
    }
    if let Some(stop_seqs) = anthropic.get("stop_sequences") {
        gen_config["stopSequences"] = stop_seqs.clone();
    }

    if !gen_config.as_object().map(|o| o.is_empty()).unwrap_or(true) {
        gemini_req["generationConfig"] = gen_config;
    }

    Ok(gemini_req)
}

/// 将 Google Gemini 响应体转换为 Anthropic Messages 响应体
pub fn gemini_to_anthropic_response(gemini: &Value, fallback_model: &str) -> Result<Value, String> {
    let msg_id = format!(
        "msg_gemini_{}",
        uuid::Uuid::new_v4().to_string().replace("-", "")[..20].to_string()
    );

    let candidate = gemini
        .get("candidates")
        .and_then(|c| c.as_array())
        .and_then(|arr| arr.first())
        .ok_or_else(|| "Gemini 响应中未找到 candidates".to_string())?;

    let parts = candidate
        .get("content")
        .and_then(|c| c.get("parts"))
        .and_then(|p| p.as_array());

    let mut content_blocks: Vec<Value> = Vec::new();
    let mut has_tool_use = false;

    if let Some(parts_arr) = parts {
        for part in parts_arr {
            if let Some(text) = part.get("text").and_then(|t| t.as_str()) {
                if !text.is_empty() {
                    content_blocks.push(json!({
                        "type": "text",
                        "text": text
                    }));
                }
            } else if let Some(fc) = part.get("functionCall") {
                has_tool_use = true;
                let name = fc.get("name").and_then(|n| n.as_str()).unwrap_or("");
                let args = fc.get("args").cloned().unwrap_or(json!({}));
                let call_id = format!(
                    "call_{}",
                    uuid::Uuid::new_v4().to_string().replace("-", "")[..16].to_string()
                );

                content_blocks.push(json!({
                    "type": "tool_use",
                    "id": call_id,
                    "name": name,
                    "input": args
                }));
            }
        }
    }

    if content_blocks.is_empty() {
        content_blocks.push(json!({
            "type": "text",
            "text": ""
        }));
    }

    let finish_reason = candidate.get("finishReason").and_then(|f| f.as_str());
    let stop_reason = if has_tool_use {
        "tool_use"
    } else {
        match finish_reason {
            Some("STOP") => "end_turn",
            Some("MAX_TOKENS") => "max_tokens",
            _ => "end_turn",
        }
    };

    let input_tokens = gemini
        .get("usageMetadata")
        .and_then(|u| u.get("promptTokenCount"))
        .and_then(|pt| pt.as_u64())
        .unwrap_or(0);
    let output_tokens = gemini
        .get("usageMetadata")
        .and_then(|u| u.get("candidatesTokenCount"))
        .and_then(|ct| ct.as_u64())
        .unwrap_or(0);

    let anthropic_resp = json!({
        "id": msg_id,
        "type": "message",
        "role": "assistant",
        "model": fallback_model,
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

/// Gemini SSE 流式转译器：将 Gemini SSE chunks 转译为标准的 Anthropic SSE 事件流
pub struct GeminiSseTranslator {
    pub message_id: String,
    pub model: String,
    pub sent_message_start: bool,
    pub current_block_index: usize,
    pub in_text_block: bool,
    pub finish_reason: Option<String>,
    pub input_tokens: u64,
    pub output_tokens: u64,
}

impl GeminiSseTranslator {
    pub fn new(fallback_model: &str) -> Self {
        Self {
            message_id: format!(
                "msg_gemini_{}",
                uuid::Uuid::new_v4().to_string().replace("-", "")[..20].to_string()
            ),
            model: fallback_model.to_string(),
            sent_message_start: false,
            current_block_index: 0,
            in_text_block: false,
            finish_reason: None,
            input_tokens: 0,
            output_tokens: 0,
        }
    }

    pub fn translate_chunk(&mut self, chunk: &Value) -> Vec<String> {
        let mut events = Vec::new();

        if let Some(usage) = chunk.get("usageMetadata") {
            if let Some(pt) = usage.get("promptTokenCount").and_then(|v| v.as_u64()) {
                self.input_tokens = pt;
            }
            if let Some(ct) = usage.get("candidatesTokenCount").and_then(|v| v.as_u64()) {
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

        let candidate = match chunk
            .get("candidates")
            .and_then(|c| c.as_array())
            .and_then(|arr| arr.first())
        {
            Some(c) => c,
            None => return events,
        };

        if let Some(fr) = candidate.get("finishReason").and_then(|f| f.as_str()) {
            self.finish_reason = Some(fr.to_string());
        }

        let parts = match candidate.get("content").and_then(|c| c.get("parts")).and_then(|p| p.as_array()) {
            Some(p) => p,
            None => return events,
        };

        for part in parts {
            if let Some(text) = part.get("text").and_then(|t| t.as_str()) {
                if !text.is_empty() {
                    if !self.in_text_block {
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
                            "text": text
                        }
                    });
                    events.push(format!("event: content_block_delta\ndata: {}\n\n", block_delta));
                }
            } else if let Some(fc) = part.get("functionCall") {
                if self.in_text_block {
                    let block_stop = json!({
                        "type": "content_block_stop",
                        "index": self.current_block_index
                    });
                    events.push(format!("event: content_block_stop\ndata: {}\n\n", block_stop));
                    self.in_text_block = false;
                    self.current_block_index += 1;
                }

                let name = fc.get("name").and_then(|n| n.as_str()).unwrap_or("tool");
                let args = fc.get("args").cloned().unwrap_or(json!({}));
                let call_id = format!(
                    "call_{}",
                    uuid::Uuid::new_v4().to_string().replace("-", "")[..16].to_string()
                );
                let tool_idx = self.current_block_index;
                self.current_block_index += 1;

                let tool_start = json!({
                    "type": "content_block_start",
                    "index": tool_idx,
                    "content_block": {
                        "type": "tool_use",
                        "id": call_id,
                        "name": name,
                        "input": {}
                    }
                });
                events.push(format!("event: content_block_start\ndata: {}\n\n", tool_start));

                let args_json = serde_json::to_string(&args).unwrap_or_default();
                let tool_delta = json!({
                    "type": "content_block_delta",
                    "index": tool_idx,
                    "delta": {
                        "type": "input_json_delta",
                        "partial_json": args_json
                    }
                });
                events.push(format!("event: content_block_delta\ndata: {}\n\n", tool_delta));

                let block_stop = json!({
                    "type": "content_block_stop",
                    "index": tool_idx
                });
                events.push(format!("event: content_block_stop\ndata: {}\n\n", block_stop));
            }
        }

        events
    }

    pub fn finish(&mut self) -> Vec<String> {
        let mut events = Vec::new();

        if self.in_text_block {
            let block_stop = json!({
                "type": "content_block_stop",
                "index": self.current_block_index
            });
            events.push(format!("event: content_block_stop\ndata: {}\n\n", block_stop));
            self.in_text_block = false;
        }

        let stop_reason = match self.finish_reason.as_deref() {
            Some("STOP") => "end_turn",
            Some("MAX_TOKENS") => "max_tokens",
            _ => "end_turn",
        };

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

        let msg_stop = json!({
            "type": "message_stop"
        });
        events.push(format!("event: message_stop\ndata: {}\n\n", msg_stop));

        events
    }
}

/// 将 Gemini 格式的错误响应转为 Anthropic Messages 格式的错误 JSON
pub fn gemini_error_to_anthropic(status: u16, error_body: &str) -> Value {
    let mut message = format!("Gemini Upstream HTTP {}", status);

    if let Ok(json_err) = serde_json::from_str::<Value>(error_body) {
        if let Some(msg) = json_err.get("error").and_then(|e| e.get("message")).and_then(|m| m.as_str()) {
            message = msg.to_string();
        }
    }

    let error_type = match status {
        400 => "invalid_request_error",
        401 | 403 => "authentication_error",
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
    fn test_anthropic_to_gemini_request() {
        let anthropic = json!({
            "model": "gemini-2.0-flash",
            "system": "You are Gemini assistant.",
            "messages": [
                {
                    "role": "user",
                    "content": "Hi there"
                },
                {
                    "role": "assistant",
                    "content": [
                        {
                            "type": "tool_use",
                            "id": "call_1",
                            "name": "calc",
                            "input": { "expr": "1+1" }
                        }
                    ]
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": "call_1",
                            "content": "2"
                        }
                    ]
                }
            ],
            "tools": [
                {
                    "name": "calc",
                    "description": "Calculate math",
                    "input_schema": {
                        "type": "object",
                        "properties": { "expr": { "type": "string" } }
                    }
                }
            ],
            "max_tokens": 2048
        });

        let gemini = anthropic_to_gemini_request(&anthropic).unwrap();
        assert_eq!(gemini["systemInstruction"]["parts"][0]["text"], "You are Gemini assistant.");
        assert_eq!(gemini["generationConfig"]["maxOutputTokens"], 2048);

        let contents = gemini["contents"].as_array().unwrap();
        assert_eq!(contents.len(), 3);
        assert_eq!(contents[0]["role"], "user");
        assert_eq!(contents[1]["role"], "model");
        assert_eq!(contents[1]["parts"][0]["functionCall"]["name"], "calc");
        assert_eq!(contents[2]["role"], "user");
        assert_eq!(contents[2]["parts"][0]["functionResponse"]["name"], "calc");

        let tools = gemini["tools"].as_array().unwrap();
        assert_eq!(tools[0]["functionDeclarations"][0]["name"], "calc");
    }

    #[test]
    fn test_gemini_to_anthropic_response() {
        let gemini = json!({
            "candidates": [
                {
                    "content": {
                        "parts": [
                            { "text": "Gemini response text" }
                        ],
                        "role": "model"
                    },
                    "finishReason": "STOP"
                }
            ],
            "usageMetadata": {
                "promptTokenCount": 20,
                "candidatesTokenCount": 10
            }
        });

        let anthropic = gemini_to_anthropic_response(&gemini, "gemini-2.0-flash").unwrap();
        assert_eq!(anthropic["type"], "message");
        assert_eq!(anthropic["model"], "gemini-2.0-flash");
        assert_eq!(anthropic["stop_reason"], "end_turn");
        assert_eq!(anthropic["content"][0]["text"], "Gemini response text");
        assert_eq!(anthropic["usage"]["input_tokens"], 20);
        assert_eq!(anthropic["usage"]["output_tokens"], 10);
    }
}
