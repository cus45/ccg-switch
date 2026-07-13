//! 供应商用量/余额查询服务
//!
//! 移植自 cc-switch：用户配置一段 JS 脚本（request + extractor），
//! 后端用 rquickjs 解析脚本得到请求配置，reqwest 发送请求，
//! 再用 extractor 提取余额数据。脚本配置存储在 Provider.meta["usageScript"]。

use rquickjs::{Context, Function, Runtime};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use url::{Host, Url};

/// 用量查询脚本配置（存储于 Provider.meta["usageScript"]，JSON 字符串）
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UsageScriptConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub code: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timeout: Option<u64>,
    #[serde(rename = "apiKey", skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
    #[serde(rename = "baseUrl", skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    #[serde(rename = "accessToken", skip_serializing_if = "Option::is_none")]
    pub access_token: Option<String>,
    #[serde(rename = "userId", skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    #[serde(rename = "templateType", skip_serializing_if = "Option::is_none")]
    pub template_type: Option<String>,
    #[serde(rename = "autoQueryInterval", skip_serializing_if = "Option::is_none")]
    pub auto_query_interval: Option<u64>,
}

/// 单个套餐的用量数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageData {
    #[serde(rename = "planName", skip_serializing_if = "Option::is_none")]
    pub plan_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extra: Option<String>,
    #[serde(rename = "isValid", skip_serializing_if = "Option::is_none")]
    pub is_valid: Option<bool>,
    #[serde(rename = "invalidMessage", skip_serializing_if = "Option::is_none")]
    pub invalid_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub used: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remaining: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unit: Option<String>,
}

/// 用量查询结果（支持多套餐）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Vec<UsageData>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// 执行脚本并格式化为 UsageResult（错误转为 success=false）
pub async fn execute_and_format(
    config: &UsageScriptConfig,
    fallback_api_key: &str,
    fallback_base_url: Option<&str>,
) -> UsageResult {
    let api_key = config
        .api_key
        .as_deref()
        .filter(|k| !k.is_empty())
        .unwrap_or(fallback_api_key);
    let base_url = config
        .base_url
        .as_deref()
        .filter(|u| !u.is_empty())
        .or(fallback_base_url)
        .unwrap_or("")
        .trim_end_matches('/')
        .to_string();

    match execute_usage_script(
        &config.code,
        api_key,
        &base_url,
        config.timeout.unwrap_or(10),
        config.access_token.as_deref(),
        config.user_id.as_deref(),
        config.template_type.as_deref(),
    )
    .await
    {
        Ok(data) => {
            let parsed: Result<Vec<UsageData>, _> = if data.is_array() {
                serde_json::from_value(data)
            } else {
                serde_json::from_value(data).map(|single: UsageData| vec![single])
            };
            match parsed {
                Ok(list) => UsageResult {
                    success: true,
                    data: Some(list),
                    error: None,
                },
                Err(e) => UsageResult {
                    success: false,
                    data: None,
                    error: Some(format!("数据格式错误: {e}")),
                },
            }
        }
        Err(e) => UsageResult {
            success: false,
            data: None,
            error: Some(e),
        },
    }
}

/// 执行用量查询脚本：eval 脚本取 request 配置 -> 发请求 -> 调 extractor 提取
async fn execute_usage_script(
    script_code: &str,
    api_key: &str,
    base_url: &str,
    timeout_secs: u64,
    access_token: Option<&str>,
    user_id: Option<&str>,
    template_type: Option<&str>,
) -> Result<Value, String> {
    if script_code.trim().is_empty() {
        return Err("用量查询脚本为空".to_string());
    }
    let is_custom_template = template_type.map(|t| t == "custom").unwrap_or(false);

    let script_with_vars =
        build_script_with_vars(script_code, api_key, base_url, access_token, user_id);

    if !base_url.is_empty() {
        validate_base_url(base_url)?;
    }

    // 在独立作用域中提取 request 配置（确保 Runtime/Context 在 await 前释放）
    let request_json = {
        let runtime = Runtime::new().map_err(|e| format!("创建 JS 运行时失败: {e}"))?;
        let context = Context::full(&runtime).map_err(|e| format!("创建 JS 上下文失败: {e}"))?;
        context.with(|ctx| {
            let config: rquickjs::Object = ctx
                .eval(script_with_vars.clone())
                .map_err(|e| format!("解析脚本失败: {}", js_error_detail(&ctx, e)))?;
            let request: rquickjs::Object =
                config.get("request").map_err(|e| format!("缺少 request 配置: {e}"))?;
            let json: String = ctx
                .json_stringify(request)
                .map_err(|e| format!("序列化 request 失败: {e}"))?
                .ok_or_else(|| "序列化 request 返回空".to_string())?
                .get()
                .map_err(|e| format!("获取字符串失败: {e}"))?;
            Ok::<_, String>(json)
        })?
    };

    let request: RequestConfig =
        serde_json::from_str(&request_json).map_err(|e| format!("request 配置格式错误: {e}"))?;

    validate_request_url(&request.url, base_url, is_custom_template)?;

    let response_data = send_http_request(&request, timeout_secs).await?;

    // 先在 Rust 侧解析并重新序列化，剔除 BOM/nul 等脏字节，
    // 避免 rquickjs 的 CString 转换因 nul 字节报错
    let response_data = {
        let cleaned: String = response_data
            .trim_start_matches('\u{feff}')
            .chars()
            .filter(|c| *c != '\0')
            .collect();
        let value: Value = serde_json::from_str(&cleaned).map_err(|e| {
            let preview: String = cleaned.chars().take(200).collect();
            format!("响应不是有效 JSON: {e}（响应开头: {preview}）")
        })?;
        serde_json::to_string(&value).map_err(|e| format!("响应重序列化失败: {e}"))?
    };

    // 重新创建 JS 运行时执行 extractor
    let result: Value = {
        let runtime = Runtime::new().map_err(|e| format!("创建 JS 运行时失败: {e}"))?;
        let context = Context::full(&runtime).map_err(|e| format!("创建 JS 上下文失败: {e}"))?;
        context.with(|ctx| {
            let config: rquickjs::Object = ctx
                .eval(script_with_vars.clone())
                .map_err(|e| format!("解析脚本失败: {}", js_error_detail(&ctx, e)))?;
            let extractor: Function = config
                .get("extractor")
                .map_err(|e| format!("缺少 extractor 函数: {e}"))?;
            let response_js: rquickjs::Value = ctx
                .json_parse(response_data.as_str())
                .map_err(|e| format!("解析响应 JSON 失败: {e}"))?;
            let result_js: rquickjs::Value = extractor
                .call((response_js,))
                .map_err(|e| format!("执行 extractor 失败: {}", js_error_detail(&ctx, e)))?;
            let json: String = ctx
                .json_stringify(result_js)
                .map_err(|e| format!("序列化结果失败: {e}"))?
                .ok_or_else(|| "extractor 未返回有效结果".to_string())?
                .get()
                .map_err(|e| format!("获取字符串失败: {e}"))?;
            serde_json::from_str(&json).map_err(|e| format!("结果 JSON 解析失败: {e}"))
        })?
    };

    validate_result(&result)?;
    Ok(result)
}

#[derive(Debug, Deserialize)]
struct RequestConfig {
    url: String,
    method: String,
    #[serde(default)]
    headers: HashMap<String, String>,
    #[serde(default)]
    body: Option<String>,
}

/// 提取 QuickJS 异常的具体信息（错误消息 + 行号），
/// 默认的 Display 只会输出 "Exception generated by QuickJS"
fn js_error_detail(ctx: &rquickjs::Ctx<'_>, err: rquickjs::Error) -> String {
    if !matches!(err, rquickjs::Error::Exception) {
        return err.to_string();
    }
    let caught = ctx.catch();
    if let Some(exception) = caught.as_exception() {
        let msg = exception.message().unwrap_or_default();
        let stack = exception.stack().unwrap_or_default();
        let detail = if stack.is_empty() {
            msg
        } else {
            format!("{msg} @ {}", stack.lines().next().unwrap_or("").trim())
        };
        if !detail.trim().is_empty() {
            return detail;
        }
    }
    err.to_string()
}

async fn send_http_request(config: &RequestConfig, timeout_secs: u64) -> Result<String, String> {
    let client = reqwest::Client::new();
    let request_timeout = std::time::Duration::from_secs(timeout_secs.clamp(2, 30));

    let method: reqwest::Method = config
        .method
        .parse()
        .map_err(|_| format!("不支持的 HTTP 方法: {}", config.method))?;

    let mut req = client.request(method, &config.url).timeout(request_timeout);
    for (k, v) in &config.headers {
        req = req.header(k, v);
    }
    if let Some(body) = &config.body {
        req = req.body(body.clone());
    }

    let resp = req.send().await.map_err(|e| format!("请求失败: {e}"))?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("读取响应失败: {e}"))?;

    if !status.is_success() {
        let preview = if text.len() > 200 {
            let mut safe_cut = 200usize;
            while !text.is_char_boundary(safe_cut) {
                safe_cut = safe_cut.saturating_sub(1);
            }
            format!("{}...", &text[..safe_cut])
        } else {
            text.clone()
        };
        return Err(format!("HTTP {status}: {preview}"));
    }

    Ok(text)
}

/// 验证脚本返回值（支持单对象或数组）
fn validate_result(result: &Value) -> Result<(), String> {
    if let Some(arr) = result.as_array() {
        if arr.is_empty() {
            return Err("脚本返回的数组不能为空".to_string());
        }
        for (idx, item) in arr.iter().enumerate() {
            validate_single_usage(item).map_err(|e| format!("数组索引[{idx}]验证失败: {e}"))?;
        }
        return Ok(());
    }
    validate_single_usage(result)
}

fn validate_single_usage(result: &Value) -> Result<(), String> {
    let obj = result
        .as_object()
        .ok_or_else(|| "脚本必须返回对象或对象数组".to_string())?;

    let type_checks: [(&str, fn(&Value) -> bool, &str); 8] = [
        ("isValid", Value::is_boolean, "布尔值"),
        ("invalidMessage", Value::is_string, "字符串"),
        ("remaining", Value::is_number, "数字"),
        ("unit", Value::is_string, "字符串"),
        ("total", Value::is_number, "数字"),
        ("used", Value::is_number, "数字"),
        ("planName", Value::is_string, "字符串"),
        ("extra", Value::is_string, "字符串"),
    ];
    for (key, check, type_name) in type_checks {
        if obj.contains_key(key) && !result[key].is_null() && !check(&result[key]) {
            return Err(format!("{key} 必须是{type_name}或 null"));
        }
    }
    Ok(())
}

fn build_script_with_vars(
    script_code: &str,
    api_key: &str,
    base_url: &str,
    access_token: Option<&str>,
    user_id: Option<&str>,
) -> String {
    let mut replaced = script_code
        .replace("{{apiKey}}", api_key)
        .replace("{{baseUrl}}", base_url);
    if let Some(token) = access_token {
        replaced = replaced.replace("{{accessToken}}", token);
    }
    if let Some(uid) = user_id {
        replaced = replaced.replace("{{userId}}", uid);
    }
    replaced
}

fn validate_base_url(base_url: &str) -> Result<(), String> {
    let parsed_url = Url::parse(base_url).map_err(|e| format!("无效的 base_url: {e}"))?;
    let is_loopback = is_loopback_host(&parsed_url);

    if parsed_url.scheme() != "https" && !is_loopback {
        return Err("base_url 必须使用 HTTPS 协议（localhost 除外）".to_string());
    }

    let hostname = parsed_url
        .host_str()
        .ok_or_else(|| "base_url 必须包含有效的主机名".to_string())?;
    if hostname.is_empty()
        || hostname.contains("..")
        || hostname.starts_with('.')
        || hostname.ends_with('.')
    {
        return Err("base_url 包含可疑的主机名".to_string());
    }
    Ok(())
}

/// 验证请求 URL 是否安全（防止 SSRF）：非自定义模板要求与 base_url 同源
fn validate_request_url(
    request_url: &str,
    base_url: &str,
    is_custom_template: bool,
) -> Result<(), String> {
    let parsed_request = Url::parse(request_url).map_err(|e| format!("无效的请求 URL: {e}"))?;
    let is_request_loopback = is_loopback_host(&parsed_request);

    if !is_custom_template && parsed_request.scheme() != "https" && !is_request_loopback {
        return Err("请求 URL 必须使用 HTTPS 协议（localhost 除外）".to_string());
    }

    if !base_url.is_empty() && !is_custom_template {
        let parsed_base = Url::parse(base_url).map_err(|e| format!("无效的 base_url: {e}"))?;

        if parsed_request.host_str() != parsed_base.host_str() {
            return Err(format!(
                "请求域名 {} 与 base_url 域名 {} 不匹配（必须是同源请求）",
                parsed_request.host_str().unwrap_or("unknown"),
                parsed_base.host_str().unwrap_or("unknown")
            ));
        }
        match (
            parsed_request.port_or_known_default(),
            parsed_base.port_or_known_default(),
        ) {
            (Some(rp), Some(bp)) if rp == bp => {}
            (Some(rp), Some(bp)) => {
                return Err(format!("请求端口 {rp} 必须与 base_url 端口 {bp} 匹配"));
            }
            _ => return Err("无法确定端口号".to_string()),
        }

        if let (Some(host), Some(base_host)) = (parsed_request.host_str(), parsed_base.host_str())
        {
            if !is_private_ip(base_host) && is_private_ip(host) {
                return Err("禁止访问私有 IP 地址".to_string());
            }
        }
    } else if let Some(host) = parsed_request.host_str() {
        if is_private_ip(host) && !is_request_loopback {
            return Err("禁止访问私有 IP 地址（localhost 除外）".to_string());
        }
    }

    Ok(())
}

fn is_private_ip(host: &str) -> bool {
    if host.eq_ignore_ascii_case("localhost") {
        return true;
    }
    if let Ok(ip_addr) = host.parse::<std::net::IpAddr>() {
        return is_private_ip_addr(ip_addr);
    }
    false
}

fn is_private_ip_addr(ip: std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(ipv4) => {
            let o = ipv4.octets();
            o[0] == 0
                || o[0] == 10
                || (o[0] == 172 && (16..=31).contains(&o[1]))
                || (o[0] == 192 && o[1] == 168)
                || (o[0] == 169 && o[1] == 254)
                || o[0] == 127
        }
        std::net::IpAddr::V6(ipv6) => {
            let first = ipv6.segments()[0];
            ipv6.is_loopback()
                || ipv6.is_unspecified()
                || (first & 0xfe00) == 0xfc00
                || (first & 0xffc0) == 0xfe80
        }
    }
}

fn is_loopback_host(url: &Url) -> bool {
    match url.host() {
        Some(Host::Domain(d)) => d.eq_ignore_ascii_case("localhost"),
        Some(Host::Ipv4(ip)) => ip.is_loopback(),
        Some(Host::Ipv6(ip)) => ip.is_loopback(),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_private_ip_validation() {
        assert!(is_private_ip("10.0.0.1"));
        assert!(is_private_ip("172.16.0.1"));
        assert!(is_private_ip("192.168.0.1"));
        assert!(is_private_ip("127.0.0.1"));
        assert!(is_private_ip("localhost"));
        assert!(!is_private_ip("172.67.0.1"));
        assert!(!is_private_ip("8.8.8.8"));
        assert!(!is_private_ip("api.example.com"));
        assert!(!is_private_ip("127.0.0.1.evil.com"));
    }

    #[test]
    fn test_same_origin_check() {
        assert!(validate_request_url(
            "https://api.example.com/v1/balance",
            "https://api.example.com",
            false
        )
        .is_ok());
        assert!(validate_request_url(
            "https://evil.com/v1/balance",
            "https://api.example.com",
            false
        )
        .is_err());
        assert!(validate_request_url(
            "https://api.example.com:8443/v1",
            "https://api.example.com",
            false
        )
        .is_err());
        // 自定义模板允许跨域
        assert!(validate_request_url(
            "https://other.com/v1/balance",
            "https://api.example.com",
            true
        )
        .is_ok());
    }
}
