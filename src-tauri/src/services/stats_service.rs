use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{self, BufRead, BufReader};
use std::path::PathBuf;
use chrono::{DateTime, Utc, Timelike};

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StatsCache {
    #[serde(default)]
    pub version: u32,
    #[serde(default)]
    pub last_computed_date: Option<String>,
    #[serde(default)]
    pub daily_activity: Vec<DailyActivity>,
    #[serde(default)]
    pub daily_model_tokens: Vec<DailyModelTokens>,
    #[serde(default)]
    pub model_usage: HashMap<String, ModelUsage>,
    #[serde(default)]
    pub total_sessions: u64,
    #[serde(default)]
    pub total_messages: u64,
    #[serde(default)]
    pub longest_session: Option<LongestSession>,
    #[serde(default)]
    pub first_session_date: Option<String>,
    #[serde(default)]
    pub hour_counts: HashMap<String, u64>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyActivity {
    pub date: String,
    #[serde(default)]
    pub message_count: u64,
    #[serde(default)]
    pub session_count: u64,
    #[serde(default)]
    pub tool_call_count: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyModelTokens {
    pub date: String,
    #[serde(default)]
    pub tokens_by_model: HashMap<String, u64>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ModelUsage {
    #[serde(default)]
    pub input_tokens: u64,
    #[serde(default)]
    pub output_tokens: u64,
    #[serde(default)]
    pub cache_read_input_tokens: u64,
    #[serde(default)]
    pub cache_creation_input_tokens: u64,
    #[serde(default)]
    pub web_search_requests: u64,
    #[serde(default)]
    pub cost_usd: f64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LongestSession {
    #[serde(default)]
    pub session_id: String,
    #[serde(default)]
    pub duration: u64,
    #[serde(default)]
    pub message_count: u64,
    #[serde(default)]
    pub timestamp: String,
}

fn get_stats_cache_path() -> Result<PathBuf, io::Error> {
    let home = dirs::home_dir()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Home directory not found"))?;
    Ok(home.join(".claude").join("stats-cache.json"))
}

pub fn get_stats_cache() -> Result<StatsCache, io::Error> {
    let path = get_stats_cache_path()?;
    if !path.exists() {
        return Ok(StatsCache::default());
    }
    let content = fs::read_to_string(&path)?;
    let cache: StatsCache = serde_json::from_str(&content)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e.to_string()))?;
    Ok(cache)
}

/// 刷新统计缓存 - 遍历所有会话文件重新计算
pub fn refresh_stats_cache() -> Result<StatsCache, io::Error> {
    let home = dirs::home_dir()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Home directory not found"))?;
    let projects_dir = home.join(".claude").join("projects");

    if !projects_dir.exists() {
        return Ok(StatsCache::default());
    }

    let mut cache = StatsCache {
        version: 2,
        last_computed_date: Some(Utc::now().format("%Y-%m-%d").to_string()),
        ..Default::default()
    };

    // 用于聚合的临时数据结构
    let mut daily_activity_map: HashMap<String, DailyActivity> = HashMap::new();
    let mut daily_tokens_map: HashMap<String, HashMap<String, u64>> = HashMap::new();
    let mut session_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut first_date: Option<String> = None;

    // 遍历所有项目目录
    for project_entry in fs::read_dir(&projects_dir)? {
        let project_entry = project_entry?;
        let project_path = project_entry.path();

        if !project_path.is_dir() {
            continue;
        }

        // 遍历项目中的所有 JSONL 文件
        for file_entry in fs::read_dir(&project_path)? {
            let file_entry = file_entry?;
            let file_path = file_entry.path();

            if file_path.extension().map_or(true, |ext| ext != "jsonl") {
                continue;
            }

            // 解析 JSONL 文件
            if let Ok(file) = fs::File::open(&file_path) {
                let reader = BufReader::new(file);

                for line in reader.lines() {
                    let line = match line {
                        Ok(l) => l,
                        Err(_) => continue,
                    };

                    // 解析 JSON 行
                    let json: serde_json::Value = match serde_json::from_str(&line) {
                        Ok(v) => v,
                        Err(_) => continue,
                    };

                    // 提取 timestamp 和 date
                    let timestamp_str = json.get("timestamp").and_then(|v| v.as_str());
                    let date = if let Some(ts) = timestamp_str {
                        if let Ok(dt) = ts.parse::<DateTime<Utc>>() {
                            let date_str = dt.format("%Y-%m-%d").to_string();
                            let hour = dt.hour().to_string();

                            // 更新小时统计
                            *cache.hour_counts.entry(hour).or_insert(0) += 1;

                            // 更新首次会话日期
                            if first_date.is_none() || date_str < *first_date.as_ref().unwrap() {
                                first_date = Some(date_str.clone());
                            }

                            Some(date_str)
                        } else {
                            None
                        }
                    } else {
                        None
                    };

                    // 提取 session_id
                    if let Some(session_id) = json.get("sessionId").and_then(|v| v.as_str()) {
                        session_ids.insert(session_id.to_string());
                    }

                    // 提取消息类型
                    let msg_type = json.get("type").and_then(|v| v.as_str()).unwrap_or("");

                    if let Some(date_str) = &date {
                        let activity = daily_activity_map.entry(date_str.clone()).or_insert(DailyActivity {
                            date: date_str.clone(),
                            message_count: 0,
                            session_count: 0,
                            tool_call_count: 0,
                        });

                        // 统计消息
                        if msg_type == "user" || msg_type == "assistant" {
                            activity.message_count += 1;
                            cache.total_messages += 1;
                        }

                        // 统计工具调用
                        if msg_type == "tool_use" || msg_type == "tool_result" {
                            activity.tool_call_count += 1;
                        }
                    }

                    // 提取 usage 和 model 信息
                    if let (Some(usage), Some(model)) = (json.get("usage"), json.get("model").and_then(|v| v.as_str())) {
                        let input_tokens = usage.get("input_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                        let output_tokens = usage.get("output_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                        let cache_read = usage.get("cache_read_input_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                        let cache_creation = usage.get("cache_creation_input_tokens").and_then(|v| v.as_u64()).unwrap_or(0);

                        // 更新模型总体使用
                        let model_usage = cache.model_usage.entry(model.to_string()).or_insert(ModelUsage::default());
                        model_usage.input_tokens += input_tokens;
                        model_usage.output_tokens += output_tokens;
                        model_usage.cache_read_input_tokens += cache_read;
                        model_usage.cache_creation_input_tokens += cache_creation;

                        // 更新每日模型 token
                        if let Some(date_str) = &date {
                            let daily_tokens = daily_tokens_map.entry(date_str.clone()).or_insert(HashMap::new());
                            *daily_tokens.entry(model.to_string()).or_insert(0) += input_tokens + output_tokens;
                        }
                    }
                }
            }
        }
    }

    // 转换为最终格式
    cache.total_sessions = session_ids.len() as u64;
    cache.first_session_date = first_date;

    // 转换 daily_activity_map
    let mut daily_activity: Vec<DailyActivity> = daily_activity_map.into_values().collect();
    daily_activity.sort_by(|a, b| a.date.cmp(&b.date));
    cache.daily_activity = daily_activity;

    // 转换 daily_tokens_map
    let mut daily_model_tokens: Vec<DailyModelTokens> = daily_tokens_map
        .into_iter()
        .map(|(date, tokens_by_model)| DailyModelTokens { date, tokens_by_model })
        .collect();
    daily_model_tokens.sort_by(|a, b| a.date.cmp(&b.date));
    cache.daily_model_tokens = daily_model_tokens;

    // 保存到文件
    let path = get_stats_cache_path()?;
    let content = serde_json::to_string_pretty(&cache)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e.to_string()))?;
    fs::write(&path, content)?;

    Ok(cache)
}
