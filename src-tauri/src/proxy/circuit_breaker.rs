#![allow(dead_code)]
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use chrono::Utc;

use crate::models::proxy::{
    CircuitBreakerConfig, CircuitBreakerState, HealthSnapshot, ProviderHealth,
};
use crate::services::storage::json_store;

// ── 内部状态 ─────────────────────────────────────────────

struct BreakerEntry {
    state: CircuitBreakerState,
    failure_count: u32,
    last_failure: Option<Instant>,
    last_success: Option<Instant>,
    open_since: Option<Instant>,
}

impl BreakerEntry {
    fn new() -> Self {
        Self {
            state: CircuitBreakerState::Closed,
            failure_count: 0,
            last_failure: None,
            last_success: None,
            open_since: None,
        }
    }
}

// ── 全局存储 ──────────────────────────────────────────────

fn global_breakers() -> &'static Arc<Mutex<HashMap<String, BreakerEntry>>> {
    static INSTANCE: OnceLock<Arc<Mutex<HashMap<String, BreakerEntry>>>> = OnceLock::new();
    INSTANCE.get_or_init(|| Arc::new(Mutex::new(HashMap::new())))
}

// ── 公开 API ──────────────────────────────────────────────

/// 默认熔断器配置
pub fn default_config() -> CircuitBreakerConfig {
    CircuitBreakerConfig::default()
}

/// 记录成功请求
pub fn record_success(provider_id: &str) {
    let mut map = global_breakers().lock().unwrap();
    let entry = map
        .entry(provider_id.to_string())
        .or_insert_with(BreakerEntry::new);

    entry.last_success = Some(Instant::now());

    if entry.state == CircuitBreakerState::HalfOpen {
        // HalfOpen + success → Closed，重置计数
        entry.state = CircuitBreakerState::Closed;
        entry.failure_count = 0;
        entry.open_since = None;
    }
}

/// 记录失败请求，返回新状态
pub fn record_failure(provider_id: &str, config: &CircuitBreakerConfig) -> CircuitBreakerState {
    let mut map = global_breakers().lock().unwrap();
    let entry = map
        .entry(provider_id.to_string())
        .or_insert_with(BreakerEntry::new);

    entry.last_failure = Some(Instant::now());
    entry.failure_count += 1;

    match entry.state {
        CircuitBreakerState::Closed => {
            if entry.failure_count >= config.failure_threshold {
                entry.state = CircuitBreakerState::Open;
                entry.open_since = Some(Instant::now());
            }
        }
        CircuitBreakerState::HalfOpen => {
            // HalfOpen + failure → 重回 Open
            entry.state = CircuitBreakerState::Open;
            entry.open_since = Some(Instant::now());
        }
        CircuitBreakerState::Open => {
            // 已处于 Open 状态，更新 open_since 延长恢复计时
            entry.open_since = Some(Instant::now());
        }
    }

    entry.state.clone()
}

/// 检查是否允许请求通过（考虑 HalfOpen 状态转换）
pub fn is_request_allowed(provider_id: &str, config: &CircuitBreakerConfig) -> bool {
    let mut map = global_breakers().lock().unwrap();
    let entry = map
        .entry(provider_id.to_string())
        .or_insert_with(BreakerEntry::new);

    match entry.state {
        CircuitBreakerState::Closed => true,
        CircuitBreakerState::Open => {
            // 检查是否已超过 recovery_timeout，若超过则转为 HalfOpen
            if let Some(open_since) = entry.open_since {
                let elapsed = open_since.elapsed();
                if elapsed >= Duration::from_secs(config.recovery_timeout_secs) {
                    entry.state = CircuitBreakerState::HalfOpen;
                    return true; // 允许一次探测请求
                }
            }
            false
        }
        CircuitBreakerState::HalfOpen => true,
    }
}

/// 获取 provider 当前状态
pub fn get_state(provider_id: &str) -> CircuitBreakerState {
    let map = global_breakers().lock().unwrap();
    map.get(provider_id)
        .map(|e| e.state.clone())
        .unwrap_or(CircuitBreakerState::Closed)
}

/// 持久化快照到文件（启动时或定期调用，非每次请求都写）
pub fn save_snapshot(snapshot_path: &Path) -> Result<(), std::io::Error> {
    let map = global_breakers().lock().unwrap();
    let providers: Vec<ProviderHealth> = map
        .iter()
        .map(|(id, entry)| {
            // Instant 不可序列化，转换为 chrono DateTime（近似值）
            let last_failure = entry.last_failure.map(|_| Utc::now());
            let last_success = entry.last_success.map(|_| Utc::now());
            ProviderHealth {
                provider_id: id.clone(),
                state: entry.state.clone(),
                failure_count: entry.failure_count,
                last_failure,
                last_success,
            }
        })
        .collect();

    let snapshot = HealthSnapshot {
        providers,
        updated_at: Utc::now(),
    };

    if let Some(parent) = snapshot_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    json_store::write_json(snapshot_path, &snapshot)
}

/// 从文件恢复快照（启动时调用，仅恢复 failure_count，状态重置为 Closed）
pub fn load_snapshot(snapshot_path: &Path) {
    if !snapshot_path.exists() {
        return;
    }

    let snapshot: HealthSnapshot = match json_store::read_json(snapshot_path) {
        Ok(s) => s,
        Err(_) => return,
    };

    let mut map = global_breakers().lock().unwrap();
    for health in snapshot.providers {
        let entry = map
            .entry(health.provider_id)
            .or_insert_with(BreakerEntry::new);
        // 恢复 failure_count，状态始终从 Closed 开始（防止重启后无法恢复）
        entry.failure_count = health.failure_count;
        entry.state = CircuitBreakerState::Closed;
    }
}
