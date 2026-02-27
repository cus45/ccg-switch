use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyConfig {
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default = "default_host")]
    pub host: String,
    #[serde(default)]
    pub enabled: bool,
    #[serde(rename = "takeoverMode", default)]
    pub takeover_mode: bool,
    #[serde(rename = "authToken")]
    pub auth_token: Option<String>,
}

fn default_port() -> u16 { 8080 }
fn default_host() -> String { "0.0.0.0".to_string() }

impl Default for ProxyConfig {
    fn default() -> Self {
        Self {
            port: default_port(),
            host: default_host(),
            enabled: false,
            takeover_mode: false,
            auth_token: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CircuitBreakerConfig {
    #[serde(rename = "failureThreshold", default = "default_failure_threshold")]
    pub failure_threshold: u32,
    #[serde(rename = "recoveryTimeoutSecs", default = "default_recovery_timeout")]
    pub recovery_timeout_secs: u64,
    #[serde(rename = "halfOpenMaxRequests", default = "default_half_open_max")]
    pub half_open_max_requests: u32,
}

fn default_failure_threshold() -> u32 { 5 }
fn default_recovery_timeout() -> u64 { 60 }
fn default_half_open_max() -> u32 { 1 }

impl Default for CircuitBreakerConfig {
    fn default() -> Self {
        Self {
            failure_threshold: default_failure_threshold(),
            recovery_timeout_secs: default_recovery_timeout(),
            half_open_max_requests: default_half_open_max(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CircuitBreakerState {
    Closed,
    Open,
    HalfOpen,
}

impl Default for CircuitBreakerState {
    fn default() -> Self { Self::Closed }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderHealth {
    #[serde(rename = "providerId")]
    pub provider_id: String,
    pub state: CircuitBreakerState,
    #[serde(rename = "failureCount", default)]
    pub failure_count: u32,
    #[serde(rename = "lastFailure")]
    pub last_failure: Option<DateTime<Utc>>,
    #[serde(rename = "lastSuccess")]
    pub last_success: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthSnapshot {
    pub providers: Vec<ProviderHealth>,
    #[serde(rename = "updatedAt")]
    pub updated_at: DateTime<Utc>,
}
