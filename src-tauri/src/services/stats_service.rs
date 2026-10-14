use chrono::{DateTime, Timelike, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{self, BufRead, BufReader};
use std::path::{Path, PathBuf};

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

#[allow(dead_code)]
fn get_stats_cache_path() -> Result<PathBuf, io::Error> {
    let home = dirs::home_dir()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Home directory not found"))?;
    Ok(home.join(".claude").join("stats-cache.json"))
}

#[allow(dead_code)]
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

/// 模型名称规范化清洗（剥离前缀、别名合并、过滤占位项）
pub fn normalize_model_name(raw: &str) -> String {
    let mut s = raw.trim();
    if s.is_empty() || s == "<synthetic>" || s.eq_ignore_ascii_case("model") {
        return String::new();
    }
    // 移除提供商前缀（如 "anthropic/", "openai/", "deepseek-ai/"）
    if let Some((_, right)) = s.rsplit_once('/') {
        s = right;
    }
    // 移除版本或标签后缀（如 ":v2"）
    if let Some((left, _)) = s.split_once(':') {
        s = left;
    }
    // 移除 @ 后缀
    if let Some((left, _)) = s.split_once('@') {
        s = left;
    }
    let mut normalized = s.to_string();
    // 移除 -thinking / _thinking
    if normalized.ends_with("-thinking") {
        normalized.truncate(normalized.len() - "-thinking".len());
    } else if normalized.ends_with("_thinking") {
        normalized.truncate(normalized.len() - "_thinking".len());
    }
    // 规范常见变体连字符/点号
    match normalized.as_str() {
        "claude-opus-4-6" => "claude-opus-4.6".to_string(),
        "claude-opus-4-8" => "claude-opus-4.8".to_string(),
        "claude-fable-5-1" => "claude-fable-5.1".to_string(),
        "claude-opus-5-5" => "claude-opus-5.5".to_string(),
        _ => normalized,
    }
}

/// 从 SQLite (proxy_request_logs) 获取统一本地会话统计（支持多端 Claude+Codex+Gemini，本地时区，连续30天）
pub fn get_unified_stats_cache(
    db: &crate::database::Database,
    app_filter: Option<&str>,
) -> Result<StatsCache, String> {
    let conn = db.conn_for_read()?;

    let (where_clause, param) = match app_filter {
        Some("claude") => (
            "WHERE (data_source = 'session_log' OR (data_source IS NOT NULL AND app_type = 'claude'))",
            None,
        ),
        Some("codex") => (
            "WHERE (data_source = 'codex_session' OR (data_source IS NOT NULL AND app_type = 'codex'))",
            None,
        ),
        Some("gemini") => (
            "WHERE (data_source = 'gemini_session' OR (data_source IS NOT NULL AND app_type = 'gemini'))",
            None,
        ),
        Some(other) if other != "all" && !other.is_empty() => (
            "WHERE (data_source IS NOT NULL AND app_type = ?1)",
            Some(other.to_string()),
        ),
        _ => (
            "WHERE data_source IN ('session_log', 'codex_session', 'gemini_session', 'opencode_session')",
            None,
        ),
    };

    let today = chrono::Local::now().date_naive();
    let start_date = today - chrono::Duration::days(29);
    let start_date_str = start_date.format("%Y-%m-%d").to_string();

    // 1. 每日模型 Token 统计（本地时区自然日，最近 30 天连续）
    let daily_param_idx = if param.is_some() { "2" } else { "1" };
    let daily_sql = format!(
        "SELECT strftime('%Y-%m-%d', datetime(created_at, 'unixepoch', 'localtime')) as day,
                model,
                sum(input_tokens + output_tokens + cache_read_tokens + cache_creation_tokens) as total_tokens
         FROM proxy_request_logs
         {} AND strftime('%Y-%m-%d', datetime(created_at, 'unixepoch', 'localtime')) >= ?{}
         GROUP BY day, model",
        where_clause, daily_param_idx
    );

    let mut daily_map: HashMap<String, HashMap<String, u64>> = HashMap::new();
    {
        let mut stmt = conn.prepare(&daily_sql).map_err(|e| e.to_string())?;
        let map_row = |row: &rusqlite::Row| -> rusqlite::Result<(String, String, u64)> {
            let day: String = row.get(0)?;
            let model: String = row.get(1)?;
            let tokens: i64 = row.get(2)?;
            Ok((day, model, tokens.max(0) as u64))
        };

        let rows: Vec<(String, String, u64)> = if let Some(ref p) = param {
            stmt.query_map(rusqlite::params![p, start_date_str], map_row)
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect()
        } else {
            stmt.query_map([&start_date_str], map_row)
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect()
        };

        for (day, raw_model, tokens) in rows {
            let norm_model = normalize_model_name(&raw_model);
            if !norm_model.is_empty() && tokens > 0 {
                let m = daily_map.entry(day).or_default();
                *m.entry(norm_model).or_insert(0) += tokens;
            }
        }
    }

    // 生成最近 30 天的严格连续序列（未活跃日期填 0）
    let mut daily_model_tokens = Vec::with_capacity(30);
    for i in 0..30 {
        let current_date = start_date + chrono::Duration::days(i);
        let date_str = current_date.format("%Y-%m-%d").to_string();
        let tokens_by_model = daily_map.remove(&date_str).unwrap_or_default();
        daily_model_tokens.push(DailyModelTokens {
            date: date_str,
            tokens_by_model,
        });
    }

    // 2. 模型使用汇总（全量归一化）
    let model_sql = format!(
        "SELECT model,
                sum(input_tokens),
                sum(output_tokens),
                sum(cache_read_tokens),
                sum(cache_creation_tokens),
                sum(CAST(total_cost_usd AS REAL))
         FROM proxy_request_logs
         {}
         GROUP BY model",
        where_clause
    );

    let mut model_usage: HashMap<String, ModelUsage> = HashMap::new();
    {
        let mut stmt = conn.prepare(&model_sql).map_err(|e| e.to_string())?;
        let map_row = |row: &rusqlite::Row| -> rusqlite::Result<(String, i64, i64, i64, i64, f64)> {
            let model: String = row.get(0)?;
            let in_t: i64 = row.get(1)?;
            let out_t: i64 = row.get(2)?;
            let c_read: i64 = row.get(3)?;
            let c_create: i64 = row.get(4)?;
            let cost: f64 = row.get(5)?;
            Ok((model, in_t, out_t, c_read, c_create, cost))
        };

        let rows: Vec<(String, i64, i64, i64, i64, f64)> = if let Some(ref p) = param {
            stmt.query_map([p], map_row)
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect()
        } else {
            stmt.query_map([], map_row)
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect()
        };

        for (raw_model, in_t, out_t, c_read, c_create, cost) in rows {
            let norm_model = normalize_model_name(&raw_model);
            if norm_model.is_empty() {
                continue;
            }
            let u = model_usage.entry(norm_model).or_default();
            u.input_tokens += in_t.max(0) as u64;
            u.output_tokens += out_t.max(0) as u64;
            u.cache_read_input_tokens += c_read.max(0) as u64;
            u.cache_creation_input_tokens += c_create.max(0) as u64;
            u.cost_usd += cost;
        }
    }

    // 3. 小时分布（0..23，本地时区）
    let hour_sql = format!(
        "SELECT cast(strftime('%H', datetime(created_at, 'unixepoch', 'localtime')) as integer) as hr,
                count(*) as cnt
         FROM proxy_request_logs
         {}
         GROUP BY hr",
        where_clause
    );

    let mut hour_counts: HashMap<String, u64> = (0..24).map(|i| (i.to_string(), 0)).collect();
    {
        let mut stmt = conn.prepare(&hour_sql).map_err(|e| e.to_string())?;
        let map_row = |row: &rusqlite::Row| -> rusqlite::Result<(i64, u64)> {
            let hr: i64 = row.get(0)?;
            let cnt: i64 = row.get(1)?;
            Ok((hr, cnt.max(0) as u64))
        };

        let rows: Vec<(i64, u64)> = if let Some(ref p) = param {
            stmt.query_map([p], map_row)
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect()
        } else {
            stmt.query_map([], map_row)
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect()
        };

        for (hr, cnt) in rows {
            hour_counts.insert(hr.to_string(), cnt);
        }
    }

    // 4. 总计统计 (总 session 数、总消息/请求数、首次日期)
    let totals_sql = format!(
        "SELECT count(DISTINCT session_id),
                count(*),
                min(strftime('%Y-%m-%d', datetime(created_at, 'unixepoch', 'localtime')))
         FROM proxy_request_logs
         {}",
        where_clause
    );

    let (total_sessions, total_messages, first_session_date): (u64, u64, Option<String>) = {
        let mut stmt = conn.prepare(&totals_sql).map_err(|e| e.to_string())?;
        let map_row = |row: &rusqlite::Row| -> rusqlite::Result<(u64, u64, Option<String>)> {
            let s_cnt: i64 = row.get(0)?;
            let m_cnt: i64 = row.get(1)?;
            let first_d: Option<String> = row.get(2)?;
            Ok((s_cnt.max(0) as u64, m_cnt.max(0) as u64, first_d))
        };

        if let Some(ref p) = param {
            stmt.query_row([p], map_row).unwrap_or((0, 0, None))
        } else {
            stmt.query_row([], map_row).unwrap_or((0, 0, None))
        }
    };

    Ok(StatsCache {
        version: 3,
        last_computed_date: Some(today.format("%Y-%m-%d").to_string()),
        daily_activity: vec![],
        daily_model_tokens,
        model_usage,
        total_sessions,
        total_messages,
        longest_session: None,
        first_session_date,
        hour_counts,
    })
}

/// 递归收集目录下所有 .jsonl 文件路径（包括 subagents/ 等子目录）
#[allow(dead_code)]
fn collect_jsonl_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_jsonl_files(&path, out);
        } else if path.extension().is_some_and(|ext| ext == "jsonl") {
            out.push(path);
        }
    }
}

/// 刷新统计缓存 - 遍历所有会话文件重新计算
#[allow(dead_code)]
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

        // 递归遍历项目中的所有 JSONL 文件（包括 subagents/ 子目录）
        let mut jsonl_files = Vec::new();
        collect_jsonl_files(&project_path, &mut jsonl_files);

        for file_path in &jsonl_files {
            // 解析 JSONL 文件
            if let Ok(file) = fs::File::open(file_path) {
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
                        let activity =
                            daily_activity_map
                                .entry(date_str.clone())
                                .or_insert(DailyActivity {
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
                    // Claude Code JSONL: usage 和 model 嵌套在 message 对象内（优先）
                    // 顶层 model 字段可能为无效值（如字面量 "model"），仅作回退
                    let message = json.get("message");
                    let usage = message
                        .and_then(|m| m.get("usage"))
                        .or_else(|| json.get("usage"));
                    let model = message
                        .and_then(|m| m.get("model"))
                        .and_then(|v| v.as_str())
                        .or_else(|| json.get("model").and_then(|v| v.as_str()))
                        .filter(|m| !m.is_empty() && *m != "model");

                    if let (Some(usage), Some(model)) = (usage, model) {
                        let input_tokens = usage
                            .get("input_tokens")
                            .and_then(|v| v.as_u64())
                            .unwrap_or(0);
                        let output_tokens = usage
                            .get("output_tokens")
                            .and_then(|v| v.as_u64())
                            .unwrap_or(0);
                        let cache_read = usage
                            .get("cache_read_input_tokens")
                            .and_then(|v| v.as_u64())
                            .unwrap_or(0);
                        let cache_creation = usage
                            .get("cache_creation_input_tokens")
                            .and_then(|v| v.as_u64())
                            .unwrap_or(0);

                        // 更新模型总体使用
                        let model_usage = cache
                            .model_usage
                            .entry(model.to_string())
                            .or_default();
                        model_usage.input_tokens += input_tokens;
                        model_usage.output_tokens += output_tokens;
                        model_usage.cache_read_input_tokens += cache_read;
                        model_usage.cache_creation_input_tokens += cache_creation;

                        // 更新每日模型 token
                        if let Some(date_str) = &date {
                            let daily_tokens = daily_tokens_map
                                .entry(date_str.clone())
                                .or_default();
                            *daily_tokens.entry(model.to_string()).or_insert(0) +=
                                input_tokens + output_tokens;
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
        .map(|(date, tokens_by_model)| DailyModelTokens {
            date,
            tokens_by_model,
        })
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
