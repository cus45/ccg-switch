//! 内置余额查询（对齐 cc-switch `services/balance.rs`）
//!
//! 按 Base URL 识别服务商，用供应商自己的 API Key 查账户余额，返回与用量脚本相同的
//! `UsageResult`，供应商卡片无需配置脚本即可显示余额。
//!
//! 支持：DeepSeek、StepFun（阶跃星辰）、SiliconFlow（国内 / 国际）、OpenRouter、Novita AI。
//! 失败语义：网络错误返回 `Err`（前端保留上次结果）；鉴权失败 / 非 2xx / 响应非法返回 `Ok(success=false)`。

use crate::services::usage_query_service::{UsageData, UsageResult};
use serde_json::Value;
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BalanceProvider {
    DeepSeek,
    StepFun,
    SiliconFlowCn,
    SiliconFlowIntl,
    OpenRouter,
    Novita,
}

/// 按 Base URL 识别；与前端 `supportsBuiltinBalance` 的域名列表保持一致
pub fn detect(base_url: &str) -> Option<BalanceProvider> {
    let url = base_url.to_ascii_lowercase();
    if url.contains("api.deepseek.com") {
        Some(BalanceProvider::DeepSeek)
    } else if url.contains("api.stepfun.com") || url.contains("api.stepfun.ai") {
        Some(BalanceProvider::StepFun)
    } else if url.contains("api.siliconflow.cn") {
        Some(BalanceProvider::SiliconFlowCn)
    } else if url.contains("api.siliconflow.com") {
        Some(BalanceProvider::SiliconFlowIntl)
    } else if url.contains("openrouter.ai") {
        Some(BalanceProvider::OpenRouter)
    } else if url.contains("api.novita.ai") {
        Some(BalanceProvider::Novita)
    } else {
        None
    }
}

impl BalanceProvider {
    fn endpoint(self) -> &'static str {
        match self {
            BalanceProvider::DeepSeek => "https://api.deepseek.com/user/balance",
            BalanceProvider::StepFun => "https://api.stepfun.com/v1/accounts",
            BalanceProvider::SiliconFlowCn => "https://api.siliconflow.cn/v1/user/info",
            BalanceProvider::SiliconFlowIntl => "https://api.siliconflow.com/v1/user/info",
            BalanceProvider::OpenRouter => "https://openrouter.ai/api/v1/credits",
            BalanceProvider::Novita => "https://api.novita.ai/v3/user/balance",
        }
    }
}

fn failed(msg: String) -> UsageResult {
    UsageResult {
        success: false,
        data: None,
        error: Some(msg),
    }
}

fn num(obj: &Value, field: &str) -> Option<f64> {
    obj.get(field)
        .and_then(|v| v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse().ok())))
}

fn item(plan: &str, remaining: f64, total: Option<f64>, used: Option<f64>, unit: &str) -> UsageData {
    let valid = remaining > 0.0;
    UsageData {
        plan_name: Some(plan.to_string()),
        extra: None,
        is_valid: Some(valid),
        invalid_message: (!valid).then(|| "余额不足".to_string()),
        total,
        used,
        remaining: Some(remaining),
        unit: Some(unit.to_string()),
    }
}

/// 把各家响应体解析成余额条目（纯函数，便于测试）
pub fn parse_balance(provider: BalanceProvider, body: &Value) -> Result<Vec<UsageData>, String> {
    let data = match provider {
        BalanceProvider::DeepSeek => {
            let available = body.get("is_available").and_then(Value::as_bool).unwrap_or(true);
            body.get("balance_infos")
                .and_then(Value::as_array)
                .map(|infos| {
                    infos
                        .iter()
                        .map(|info| {
                            let currency = info.get("currency").and_then(Value::as_str).unwrap_or("CNY");
                            let mut d = item(currency, num(info, "total_balance").unwrap_or(0.0), None, None, currency);
                            if !available {
                                d.is_valid = Some(false);
                                d.invalid_message = Some("余额不足".to_string());
                            }
                            d
                        })
                        .collect()
                })
                .unwrap_or_default()
        }
        BalanceProvider::StepFun => {
            vec![item("StepFun", num(body, "balance").unwrap_or(0.0), None, None, "CNY")]
        }
        BalanceProvider::SiliconFlowCn | BalanceProvider::SiliconFlowIntl => {
            let data = body.get("data").ok_or("响应缺少 data 字段")?;
            let (plan, unit) = if provider == BalanceProvider::SiliconFlowCn {
                ("SiliconFlow", "CNY")
            } else {
                ("SiliconFlow (Intl)", "USD")
            };
            vec![item(plan, num(data, "totalBalance").unwrap_or(0.0), None, None, unit)]
        }
        BalanceProvider::OpenRouter => {
            let data = body.get("data").unwrap_or(body);
            let total = num(data, "total_credits").unwrap_or(0.0);
            let used = num(data, "total_usage").unwrap_or(0.0);
            vec![item("OpenRouter", total - used, Some(total), Some(used), "USD")]
        }
        // Novita 金额单位 0.0001 USD
        BalanceProvider::Novita => {
            vec![item("Novita AI", num(body, "availableBalance").unwrap_or(0.0) / 10_000.0, None, None, "USD")]
        }
    };
    if data.is_empty() {
        return Err("响应中没有余额信息".to_string());
    }
    Ok(data)
}

/// 查询余额；`base_url` 识别不出时返回 `None`（调用方据此回退到其它逻辑）
pub async fn query(base_url: &str, api_key: &str) -> Option<Result<UsageResult, String>> {
    let provider = detect(base_url)?;
    Some(query_provider(provider, api_key).await)
}

async fn query_provider(provider: BalanceProvider, api_key: &str) -> Result<UsageResult, String> {
    if api_key.trim().is_empty() {
        return Ok(failed("API Key 为空".to_string()));
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(provider.endpoint())
        .bearer_auth(api_key.trim())
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("网络错误: {e}"))?;

    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return Ok(failed(format!("鉴权失败（HTTP {status}），请检查 API Key")));
    }
    // 先取完整响应体：读体失败是瞬时错误，解析失败才是确定性错误
    let raw = resp.bytes().await.map_err(|e| format!("读取响应失败: {e}"))?;
    if !status.is_success() {
        let body = String::from_utf8_lossy(&raw);
        return Ok(failed(format!("查询失败（HTTP {status}）: {}", body.chars().take(200).collect::<String>())));
    }
    let body: Value = match serde_json::from_slice(&raw) {
        Ok(v) => v,
        Err(e) => return Ok(failed(format!("响应解析失败: {e}"))),
    };
    Ok(match parse_balance(provider, &body) {
        Ok(data) => UsageResult {
            success: true,
            data: Some(data),
            error: None,
        },
        Err(msg) => failed(msg),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn detects_by_base_url() {
        assert_eq!(detect("https://api.deepseek.com/anthropic"), Some(BalanceProvider::DeepSeek));
        assert_eq!(detect("https://API.SiliconFlow.cn/v1"), Some(BalanceProvider::SiliconFlowCn));
        assert_eq!(detect("https://api.siliconflow.com"), Some(BalanceProvider::SiliconFlowIntl));
        assert_eq!(detect("https://openrouter.ai/api"), Some(BalanceProvider::OpenRouter));
        assert_eq!(detect("https://api.anthropic.com"), None);
    }

    #[test]
    fn parses_deepseek_multi_currency() {
        let body = json!({"is_available": true, "balance_infos": [
            {"currency": "CNY", "total_balance": "110.00"},
            {"currency": "USD", "total_balance": 2.5}
        ]});
        let data = parse_balance(BalanceProvider::DeepSeek, &body).unwrap();
        assert_eq!(data.len(), 2);
        assert_eq!(data[0].remaining, Some(110.0));
        assert_eq!(data[1].unit.as_deref(), Some("USD"));
    }

    #[test]
    fn parses_openrouter_remaining() {
        let body = json!({"data": {"total_credits": 20.0, "total_usage": 7.5}});
        let d = &parse_balance(BalanceProvider::OpenRouter, &body).unwrap()[0];
        assert_eq!(d.remaining, Some(12.5));
        assert_eq!(d.total, Some(20.0));
        assert_eq!(d.is_valid, Some(true));
    }

    #[test]
    fn novita_converts_units_and_flags_empty_balance() {
        let d = &parse_balance(BalanceProvider::Novita, &json!({"availableBalance": 0})).unwrap()[0];
        assert_eq!(d.remaining, Some(0.0));
        assert_eq!(d.is_valid, Some(false));
        let d = &parse_balance(BalanceProvider::Novita, &json!({"availableBalance": 25000})).unwrap()[0];
        assert_eq!(d.remaining, Some(2.5));
    }

    #[test]
    fn siliconflow_requires_data() {
        assert!(parse_balance(BalanceProvider::SiliconFlowCn, &json!({})).is_err());
        let d = &parse_balance(BalanceProvider::SiliconFlowCn, &json!({"data": {"totalBalance": "8.8"}})).unwrap()[0];
        assert_eq!(d.remaining, Some(8.8));
        assert_eq!(d.unit.as_deref(), Some("CNY"));
    }
}
