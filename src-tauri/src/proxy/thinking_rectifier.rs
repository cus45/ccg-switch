use crate::proxy::error::ProxyError;
use serde_json::Value;

// thinking 相关错误关键字（API 返回的 error type 或 message）
const THINKING_ERROR_TYPES: &[&str] = &[
    "invalid_request_error",
];

const THINKING_ERROR_MESSAGES: &[&str] = &[
    "thinking",
    "extended_thinking",
    "budget_tokens",
];

/// 检测响应是否包含 thinking 相关错误
pub fn is_thinking_error(status: u16, body: &[u8]) -> bool {
    if status != 400 && status != 422 {
        return false;
    }

    let text = match std::str::from_utf8(body) {
        Ok(t) => t,
        Err(_) => return false,
    };

    // 快速字符串匹配：检查 body 中是否含有 thinking 相关词
    let lower = text.to_lowercase();
    if lower.contains("thinking") || lower.contains("extended_thinking") {
        // 进一步验证是 error 响应
        if let Ok(val) = serde_json::from_str::<Value>(text) {
            if let Some(err_type) = val.get("type").and_then(|v| v.as_str()) {
                if THINKING_ERROR_TYPES.contains(&err_type) {
                    return true;
                }
            }
            // 兼容 {"error": {"type": "...", "message": "..."}}
            if let Some(err) = val.get("error") {
                if let Some(msg) = err.get("message").and_then(|v| v.as_str()) {
                    let msg_lower = msg.to_lowercase();
                    return THINKING_ERROR_MESSAGES
                        .iter()
                        .any(|kw| msg_lower.contains(kw));
                }
            }
        }
    }
    false
}

/// 预处理请求体：将 thinking.type: "adaptive" 转为 "enabled"
///
/// 第三方反代通常只支持 "disabled" | "enabled"，
/// Claude Code 新版发送 "adaptive" 会导致 400 错误。
pub fn normalize_thinking_type(body: &[u8]) -> Result<Option<Vec<u8>>, ProxyError> {
    let mut val: Value = serde_json::from_slice(body)
        .map_err(|e| ProxyError::InvalidRequest(format!("JSON parse error: {e}")))?;

    let mut modified = false;

    // 先读取 max_tokens（避免后续可变借用冲突）
    let max_tokens = val.get("max_tokens")
        .and_then(|v| v.as_u64())
        .unwrap_or(16384);

    if let Some(thinking) = val.get_mut("thinking") {
        if let Some(t) = thinking.get("type").and_then(|v| v.as_str()) {
            if t == "adaptive" {
                thinking["type"] = Value::String("enabled".to_string());
                // "enabled" 模式要求 budget_tokens，未提供时补默认值
                if thinking.get("budget_tokens").is_none() {
                    let budget = (max_tokens * 4 / 5).max(1024);
                    thinking["budget_tokens"] = Value::Number(budget.into());
                }
                modified = true;
            }
        }
    }

    if modified {
        let bytes = serde_json::to_vec(&val)
            .map_err(|e| ProxyError::Internal(format!("JSON serialize error: {e}")))?;
        Ok(Some(bytes))
    } else {
        Ok(None)
    }
}

/// 修复请求体：移除可能导致 thinking 签名错误的相关字段
///
/// 移除策略：
/// - 顶层 `thinking` 字段
/// - messages[].content[].type == "thinking" 的块
/// - 若无修改，返回 None
pub fn rectify_request(body: &[u8]) -> Result<Option<Vec<u8>>, ProxyError> {
    let mut val: Value = serde_json::from_slice(body)
        .map_err(|e| ProxyError::InvalidRequest(format!("JSON parse error: {e}")))?;

    let mut modified = false;

    // 移除顶层 thinking 字段
    if let Some(obj) = val.as_object_mut() {
        if obj.remove("thinking").is_some() {
            modified = true;
        }
    }

    // 移除 messages[].content[] 中 type == "thinking" 的块
    if let Some(messages) = val.get_mut("messages").and_then(|m| m.as_array_mut()) {
        for msg in messages.iter_mut() {
            if let Some(content) = msg.get_mut("content").and_then(|c| c.as_array_mut()) {
                let before_len = content.len();
                content.retain(|block| {
                    block.get("type").and_then(|t| t.as_str()) != Some("thinking")
                        && block.get("type").and_then(|t| t.as_str()) != Some("redacted_thinking")
                });
                if content.len() != before_len {
                    modified = true;
                }
            }
        }
    }

    if modified {
        let bytes = serde_json::to_vec(&val)
            .map_err(|e| ProxyError::Internal(format!("JSON serialize error: {e}")))?;
        Ok(Some(bytes))
    } else {
        Ok(None)
    }
}
