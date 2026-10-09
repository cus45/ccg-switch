//! 从上游 API 响应中提取 token 用量
//!
//! 覆盖格式：
//! - Claude（非流式 / SSE 事件流）
//! - OpenAI Chat Completions（非流式 / 流式）
//! - Codex Responses API（非流式 / 流式，含自动格式探测）
//! - Gemini（非流式 / 流式分片）
//!
//! 所有解析器在拿不到用量时返回 `None`，由调用方决定是记 0 还是跳过。

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 单次请求的 token 用量
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct TokenUsage {
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub cache_read_tokens: u32,
    pub cache_creation_tokens: u32,
    /// 响应里自报的真实模型名，优先于请求中声明的模型
    pub model: Option<String>,
}

/// 读 u64 字段并窄化为 u32，缺失记 0
fn u32_field(value: &Value, key: &str) -> u32 {
    value.get(key).and_then(|v| v.as_u64()).unwrap_or(0) as u32
}

/// 读必需的 u64 字段，缺失即整体解析失败
fn required_u32(value: &Value, key: &str) -> Option<u32> {
    Some(value.get(key)?.as_u64()? as u32)
}

/// 取 `body.model` 字符串
fn model_field(body: &Value) -> Option<String> {
    body.get("model")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

/// Codex / OpenAI 的缓存命中数散落在多个位置，逐个兜底
fn cached_tokens(usage: &Value) -> u32 {
    usage
        .get("cache_read_input_tokens")
        .and_then(|v| v.as_u64())
        .or_else(|| {
            usage
                .get("input_tokens_details")
                .and_then(|d| d.get("cached_tokens"))
                .and_then(|v| v.as_u64())
        })
        .or_else(|| {
            usage
                .get("prompt_tokens_details")
                .and_then(|d| d.get("cached_tokens"))
                .and_then(|v| v.as_u64())
        })
        .unwrap_or(0) as u32
}

impl TokenUsage {
    // ---------- Claude ----------

    /// Claude 非流式：`usage.{input_tokens, output_tokens, cache_*_input_tokens}`
    pub fn from_claude_response(body: &Value) -> Option<Self> {
        let usage = body.get("usage")?;
        Some(Self {
            input_tokens: required_u32(usage, "input_tokens")?,
            output_tokens: required_u32(usage, "output_tokens")?,
            cache_read_tokens: u32_field(usage, "cache_read_input_tokens"),
            cache_creation_tokens: u32_field(usage, "cache_creation_input_tokens"),
            model: model_field(body),
        })
    }

    /// Claude SSE：`message_start` 带 input/cache，`message_delta` 带 output
    ///
    /// 反代（OpenRouter 之类）转换后的流有时把 input_tokens 也塞进 `message_delta`，
    /// 所以 message_start 没拿到时要在 delta 里再兜一次。
    pub fn from_claude_stream_events(events: &[Value]) -> Option<Self> {
        let mut usage = Self::default();
        let mut model: Option<String> = None;

        for event in events {
            let Some(event_type) = event.get("type").and_then(|v| v.as_str()) else {
                continue;
            };

            match event_type {
                "message_start" => {
                    let message = event.get("message");

                    if model.is_none() {
                        model = message.and_then(model_field);
                    }

                    if let Some(msg_usage) = message.and_then(|m| m.get("usage")) {
                        if let Some(input) = msg_usage.get("input_tokens").and_then(|v| v.as_u64()) {
                            usage.input_tokens = input as u32;
                        }
                        usage.cache_read_tokens = u32_field(msg_usage, "cache_read_input_tokens");
                        usage.cache_creation_tokens =
                            u32_field(msg_usage, "cache_creation_input_tokens");
                    }
                }
                "message_delta" => {
                    if let Some(delta_usage) = event.get("usage") {
                        if let Some(output) =
                            delta_usage.get("output_tokens").and_then(|v| v.as_u64())
                        {
                            usage.output_tokens = output as u32;
                        }
                        if usage.input_tokens == 0 {
                            if let Some(input) =
                                delta_usage.get("input_tokens").and_then(|v| v.as_u64())
                            {
                                usage.input_tokens = input as u32;
                            }
                        }
                    }
                }
                _ => {}
            }
        }

        if usage.input_tokens > 0 || usage.output_tokens > 0 {
            usage.model = model;
            Some(usage)
        } else {
            None
        }
    }

    /// 从 Claude SSE 事件里取模型名，拿不到就用请求里声明的
    pub fn model_from_claude_stream(events: &[Value], fallback: &str) -> String {
        events
            .iter()
            .find_map(|event| {
                if event.get("type").and_then(|v| v.as_str()) == Some("message_start") {
                    event.get("message").and_then(model_field)
                } else {
                    None
                }
            })
            .unwrap_or_else(|| fallback.to_string())
    }

    // ---------- OpenAI ----------

    /// OpenAI Chat Completions：`usage.{prompt_tokens, completion_tokens}`
    pub fn from_openai_response(body: &Value) -> Option<Self> {
        let usage = body.get("usage")?;
        Some(Self {
            input_tokens: required_u32(usage, "prompt_tokens")?,
            output_tokens: required_u32(usage, "completion_tokens")?,
            cache_read_tokens: cached_tokens(usage),
            cache_creation_tokens: 0,
            model: model_field(body),
        })
    }

    /// OpenAI 流式：usage 在最后一个 chunk，从尾部往前找第一个非 null 的
    pub fn from_openai_stream_events(events: &[Value]) -> Option<Self> {
        events.iter().rev().find_map(|event| {
            event
                .get("usage")
                .filter(|u| !u.is_null())
                .and_then(|_| Self::from_openai_response(event))
        })
    }

    /// OpenRouter 走 OpenAI 格式，但不带缓存字段
    pub fn from_openrouter_response(body: &Value) -> Option<Self> {
        let usage = body.get("usage")?;
        Some(Self {
            input_tokens: required_u32(usage, "prompt_tokens")?,
            output_tokens: required_u32(usage, "completion_tokens")?,
            cache_read_tokens: 0,
            cache_creation_tokens: 0,
            model: model_field(body),
        })
    }

    // ---------- Codex ----------

    /// Codex Responses API：记录原始 input_tokens（计费时才扣缓存）
    pub fn from_codex_response(body: &Value) -> Option<Self> {
        let usage = body.get("usage")?;
        Some(Self {
            input_tokens: required_u32(usage, "input_tokens")?,
            output_tokens: required_u32(usage, "output_tokens")?,
            cache_read_tokens: cached_tokens(usage),
            cache_creation_tokens: u32_field(usage, "cache_creation_input_tokens"),
            model: model_field(body),
        })
    }

    /// Codex 变体：input_tokens 已扣掉缓存命中部分
    ///
    /// 用于上游把 cached_tokens 含在 input_tokens 里的场景，
    /// 避免与 `CostCalculator` 的缓存扣减叠加成双重扣减。
    pub fn from_codex_response_adjusted(body: &Value) -> Option<Self> {
        let mut usage = Self::from_codex_response(body)?;
        usage.input_tokens = usage.input_tokens.saturating_sub(usage.cache_read_tokens);
        Some(usage)
    }

    /// Codex 非流式自动探测：有 prompt_tokens 走 OpenAI，有 input_tokens 走 Codex
    pub fn from_codex_response_auto(body: &Value) -> Option<Self> {
        let usage = body.get("usage")?;
        if usage.get("prompt_tokens").is_some() {
            Self::from_openai_response(body)
        } else if usage.get("input_tokens").is_some() {
            Self::from_codex_response(body)
        } else {
            None
        }
    }

    /// Codex 流式：`response.completed` 事件里带完整 usage
    pub fn from_codex_stream_events(events: &[Value]) -> Option<Self> {
        events.iter().find_map(|event| {
            if event.get("type").and_then(|v| v.as_str()) == Some("response.completed") {
                event
                    .get("response")
                    .and_then(Self::from_codex_response_adjusted)
            } else {
                None
            }
        })
    }

    /// Codex 流式自动探测：先找 response.completed，否则退 OpenAI 流式
    pub fn from_codex_stream_events_auto(events: &[Value]) -> Option<Self> {
        let from_responses_api = events.iter().find_map(|event| {
            if event.get("type").and_then(|v| v.as_str()) == Some("response.completed") {
                event.get("response").and_then(Self::from_codex_response_auto)
            } else {
                None
            }
        });

        from_responses_api.or_else(|| Self::from_openai_stream_events(events))
    }

    // ---------- Gemini ----------

    /// Gemini 非流式：`usageMetadata`
    ///
    /// output = total - prompt，因为 totalTokenCount 已含 candidates + thoughts，
    /// 只读 candidatesTokenCount 会漏掉思考 token。
    pub fn from_gemini_response(body: &Value) -> Option<Self> {
        let usage = body.get("usageMetadata")?;
        let prompt_tokens = required_u32(usage, "promptTokenCount")?;
        let total_tokens = required_u32(usage, "totalTokenCount")?;

        Some(Self {
            input_tokens: prompt_tokens,
            output_tokens: total_tokens.saturating_sub(prompt_tokens),
            cache_read_tokens: u32_field(usage, "cachedContentTokenCount"),
            cache_creation_tokens: 0,
            model: body
                .get("modelVersion")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
        })
    }

    /// Gemini 流式：后续分片的 usageMetadata 覆盖前面的（累计值而非增量）
    pub fn from_gemini_stream_chunks(chunks: &[Value]) -> Option<Self> {
        let mut prompt_tokens = 0u32;
        let mut total_tokens = 0u32;
        let mut cache_read = 0u32;
        let mut model: Option<String> = None;

        for chunk in chunks {
            if let Some(usage) = chunk.get("usageMetadata") {
                prompt_tokens = u32_field(usage, "promptTokenCount");
                total_tokens = u32_field(usage, "totalTokenCount");
                cache_read = u32_field(usage, "cachedContentTokenCount");
            }
            if model.is_none() {
                model = chunk
                    .get("modelVersion")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
            }
        }

        let output_tokens = total_tokens.saturating_sub(prompt_tokens);
        if prompt_tokens > 0 || output_tokens > 0 {
            Some(Self {
                input_tokens: prompt_tokens,
                output_tokens,
                cache_read_tokens: cache_read,
                cache_creation_tokens: 0,
                model,
            })
        } else {
            None
        }
    }

    /// 从 Gemini 流式分片取 modelVersion
    pub fn model_from_gemini_stream(chunks: &[Value], fallback: &str) -> String {
        chunks
            .iter()
            .find_map(|c| c.get("modelVersion").and_then(|v| v.as_str()))
            .unwrap_or(fallback)
            .to_string()
    }

    /// 从 OpenAI / Codex 流式事件取模型名
    pub fn model_from_openai_stream(events: &[Value], fallback: &str) -> String {
        events
            .iter()
            .rev()
            .find_map(|e| {
                e.get("model")
                    .and_then(|v| v.as_str())
                    .or_else(|| e.get("response").and_then(|r| r.get("model"))?.as_str())
            })
            .unwrap_or(fallback)
            .to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // ---------- Claude ----------

    #[test]
    fn claude_response_reads_all_four_token_kinds() {
        let body = json!({
            "model": "claude-sonnet-4-5-20250929",
            "usage": {
                "input_tokens": 1000,
                "output_tokens": 500,
                "cache_read_input_tokens": 200,
                "cache_creation_input_tokens": 100
            }
        });
        let usage = TokenUsage::from_claude_response(&body).unwrap();
        assert_eq!(usage.input_tokens, 1000);
        assert_eq!(usage.output_tokens, 500);
        assert_eq!(usage.cache_read_tokens, 200);
        assert_eq!(usage.cache_creation_tokens, 100);
        assert_eq!(usage.model.as_deref(), Some("claude-sonnet-4-5-20250929"));
    }

    #[test]
    fn claude_response_defaults_missing_cache_fields_to_zero() {
        let body = json!({"usage": {"input_tokens": 10, "output_tokens": 20}});
        let usage = TokenUsage::from_claude_response(&body).unwrap();
        assert_eq!(usage.cache_read_tokens, 0);
        assert_eq!(usage.cache_creation_tokens, 0);
    }

    #[test]
    fn claude_response_returns_none_without_usage() {
        assert!(TokenUsage::from_claude_response(&json!({"model": "x"})).is_none());
    }

    #[test]
    fn claude_stream_combines_message_start_and_delta() {
        let events = vec![
            json!({
                "type": "message_start",
                "message": {
                    "model": "claude-opus-4-5-20251101",
                    "usage": {
                        "input_tokens": 800,
                        "cache_read_input_tokens": 150,
                        "cache_creation_input_tokens": 50
                    }
                }
            }),
            json!({"type": "content_block_delta"}),
            json!({"type": "message_delta", "usage": {"output_tokens": 321}}),
        ];
        let usage = TokenUsage::from_claude_stream_events(&events).unwrap();
        assert_eq!(usage.input_tokens, 800);
        assert_eq!(usage.output_tokens, 321);
        assert_eq!(usage.cache_read_tokens, 150);
        assert_eq!(usage.cache_creation_tokens, 50);
        assert_eq!(usage.model.as_deref(), Some("claude-opus-4-5-20251101"));
    }

    #[test]
    fn claude_stream_falls_back_to_input_tokens_in_delta() {
        // 反代把 input_tokens 放进 message_delta 的情形
        let events = vec![
            json!({"type": "message_start", "message": {"usage": {}}}),
            json!({"type": "message_delta", "usage": {"input_tokens": 42, "output_tokens": 7}}),
        ];
        let usage = TokenUsage::from_claude_stream_events(&events).unwrap();
        assert_eq!(usage.input_tokens, 42);
        assert_eq!(usage.output_tokens, 7);
    }

    #[test]
    fn claude_stream_returns_none_when_no_tokens_seen() {
        let events = vec![json!({"type": "ping"}), json!({"type": "content_block_stop"})];
        assert!(TokenUsage::from_claude_stream_events(&events).is_none());
    }

    #[test]
    fn claude_stream_model_extraction_uses_fallback() {
        let events = vec![json!({"type": "ping"})];
        assert_eq!(
            TokenUsage::model_from_claude_stream(&events, "req-model"),
            "req-model"
        );
    }

    // ---------- OpenAI ----------

    #[test]
    fn openai_response_maps_prompt_and_completion() {
        let body = json!({
            "model": "gpt-5.2",
            "usage": {
                "prompt_tokens": 300,
                "completion_tokens": 120,
                "prompt_tokens_details": {"cached_tokens": 64}
            }
        });
        let usage = TokenUsage::from_openai_response(&body).unwrap();
        assert_eq!(usage.input_tokens, 300);
        assert_eq!(usage.output_tokens, 120);
        assert_eq!(usage.cache_read_tokens, 64);
        assert_eq!(usage.model.as_deref(), Some("gpt-5.2"));
    }

    #[test]
    fn openai_stream_picks_last_chunk_with_usage() {
        let events = vec![
            json!({"model": "gpt-5.2", "usage": null}),
            json!({"model": "gpt-5.2", "choices": []}),
            json!({"model": "gpt-5.2", "usage": {"prompt_tokens": 11, "completion_tokens": 22}}),
        ];
        let usage = TokenUsage::from_openai_stream_events(&events).unwrap();
        assert_eq!(usage.input_tokens, 11);
        assert_eq!(usage.output_tokens, 22);
    }

    #[test]
    fn openai_stream_returns_none_when_all_usage_null() {
        let events = vec![json!({"usage": null}), json!({"choices": []})];
        assert!(TokenUsage::from_openai_stream_events(&events).is_none());
    }

    #[test]
    fn openrouter_response_ignores_cache_fields() {
        let body = json!({"usage": {"prompt_tokens": 5, "completion_tokens": 6}});
        let usage = TokenUsage::from_openrouter_response(&body).unwrap();
        assert_eq!(usage.cache_read_tokens, 0);
        assert_eq!(usage.cache_creation_tokens, 0);
    }

    // ---------- Codex ----------

    #[test]
    fn codex_response_keeps_raw_input_tokens() {
        let body = json!({
            "model": "gpt-5.2-codex",
            "usage": {
                "input_tokens": 1000,
                "output_tokens": 200,
                "input_tokens_details": {"cached_tokens": 400}
            }
        });
        let usage = TokenUsage::from_codex_response(&body).unwrap();
        // 原始值：计费时才由 CostCalculator 扣缓存
        assert_eq!(usage.input_tokens, 1000);
        assert_eq!(usage.cache_read_tokens, 400);
    }

    #[test]
    fn codex_adjusted_subtracts_cached_from_input() {
        let body = json!({
            "usage": {
                "input_tokens": 1000,
                "output_tokens": 200,
                "input_tokens_details": {"cached_tokens": 400}
            }
        });
        let usage = TokenUsage::from_codex_response_adjusted(&body).unwrap();
        assert_eq!(usage.input_tokens, 600, "adjusted 版必须扣掉缓存命中部分");
        assert_eq!(usage.cache_read_tokens, 400);
    }

    #[test]
    fn codex_adjusted_saturates_when_cached_exceeds_input() {
        let body = json!({
            "usage": {
                "input_tokens": 100,
                "output_tokens": 1,
                "cache_read_input_tokens": 500
            }
        });
        let usage = TokenUsage::from_codex_response_adjusted(&body).unwrap();
        assert_eq!(usage.input_tokens, 0, "不能下溢成巨大的 u32");
    }

    #[test]
    fn codex_auto_detects_openai_format() {
        let body = json!({"usage": {"prompt_tokens": 7, "completion_tokens": 8}});
        let usage = TokenUsage::from_codex_response_auto(&body).unwrap();
        assert_eq!(usage.input_tokens, 7);
    }

    #[test]
    fn codex_auto_detects_responses_format() {
        let body = json!({"usage": {"input_tokens": 9, "output_tokens": 10}});
        let usage = TokenUsage::from_codex_response_auto(&body).unwrap();
        assert_eq!(usage.input_tokens, 9);
    }

    #[test]
    fn codex_auto_returns_none_for_unknown_shape() {
        let body = json!({"usage": {"weird_tokens": 1}});
        assert!(TokenUsage::from_codex_response_auto(&body).is_none());
    }

    #[test]
    fn codex_stream_reads_response_completed() {
        let events = vec![
            json!({"type": "response.in_progress"}),
            json!({
                "type": "response.completed",
                "response": {
                    "model": "gpt-5.2-codex",
                    "usage": {
                        "input_tokens": 500,
                        "output_tokens": 60,
                        "input_tokens_details": {"cached_tokens": 100}
                    }
                }
            }),
        ];
        let usage = TokenUsage::from_codex_stream_events(&events).unwrap();
        assert_eq!(usage.input_tokens, 400, "stream 版走 adjusted 语义");
        assert_eq!(usage.output_tokens, 60);
    }

    #[test]
    fn codex_stream_auto_falls_back_to_openai_chunks() {
        let events = vec![
            json!({"choices": []}),
            json!({"model": "gpt-5.2", "usage": {"prompt_tokens": 3, "completion_tokens": 4}}),
        ];
        let usage = TokenUsage::from_codex_stream_events_auto(&events).unwrap();
        assert_eq!(usage.input_tokens, 3);
        assert_eq!(usage.output_tokens, 4);
    }

    // ---------- Gemini ----------

    #[test]
    fn gemini_response_derives_output_from_total() {
        let body = json!({
            "modelVersion": "gemini-3-pro-preview",
            "usageMetadata": {
                "promptTokenCount": 100,
                "candidatesTokenCount": 30,
                "thoughtsTokenCount": 20,
                "totalTokenCount": 150,
                "cachedContentTokenCount": 40
            }
        });
        let usage = TokenUsage::from_gemini_response(&body).unwrap();
        assert_eq!(usage.input_tokens, 100);
        // 150 - 100 = 50，含 candidates(30) + thoughts(20)；
        // 只读 candidatesTokenCount 会漏掉思考 token
        assert_eq!(usage.output_tokens, 50);
        assert_eq!(usage.cache_read_tokens, 40);
        assert_eq!(usage.model.as_deref(), Some("gemini-3-pro-preview"));
    }

    #[test]
    fn gemini_response_saturates_when_total_below_prompt() {
        let body = json!({
            "usageMetadata": {"promptTokenCount": 100, "totalTokenCount": 40}
        });
        let usage = TokenUsage::from_gemini_response(&body).unwrap();
        assert_eq!(usage.output_tokens, 0);
    }

    #[test]
    fn gemini_stream_uses_last_cumulative_metadata() {
        let chunks = vec![
            json!({"modelVersion": "gemini-2.5-pro", "usageMetadata": {
                "promptTokenCount": 100, "totalTokenCount": 110
            }}),
            json!({"usageMetadata": {"promptTokenCount": 100, "totalTokenCount": 180}}),
        ];
        let usage = TokenUsage::from_gemini_stream_chunks(&chunks).unwrap();
        assert_eq!(usage.input_tokens, 100);
        assert_eq!(usage.output_tokens, 80, "累计值应取最后一片，不是逐片相加");
        assert_eq!(usage.model.as_deref(), Some("gemini-2.5-pro"));
    }

    #[test]
    fn gemini_stream_returns_none_without_metadata() {
        let chunks = vec![json!({"candidates": []})];
        assert!(TokenUsage::from_gemini_stream_chunks(&chunks).is_none());
    }
}
