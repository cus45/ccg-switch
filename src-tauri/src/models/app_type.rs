#![allow(dead_code)]
use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AppType {
    Claude,
    Codex,
    Gemini,
    OpenCode,
    OpenClaw,
    /// Claude Desktop（Chat / Code 模式）的第三方网关配置
    #[serde(rename = "claudedesktop")]
    ClaudeDesktop,
}

impl AppType {
    pub fn as_str(&self) -> &str {
        match self {
            AppType::Claude => "claude",
            AppType::Codex => "codex",
            AppType::Gemini => "gemini",
            AppType::OpenCode => "opencode",
            AppType::OpenClaw => "openclaw",
            AppType::ClaudeDesktop => "claudedesktop",
        }
    }

    /// additive 模式的应用会将配置追加到现有设置，而非替换
    pub fn is_additive_mode(&self) -> bool {
        matches!(self, AppType::Codex | AppType::Gemini)
    }

    /// 各应用对应的配置文件名
    pub fn config_file_name(&self) -> &str {
        match self {
            AppType::Claude => "settings.json",
            AppType::Codex => "codex.json",
            AppType::Gemini => "gemini.json",
            AppType::OpenCode => "opencode.json",
            AppType::OpenClaw => "openclaw.json",
            AppType::ClaudeDesktop => "claude_desktop_config.json",
        }
    }

    /// 各应用的环境变量前缀
    pub fn env_prefix(&self) -> &str {
        match self {
            AppType::Claude => "ANTHROPIC",
            AppType::Codex => "CODEX",
            AppType::Gemini => "GEMINI",
            AppType::OpenCode => "OPENCODE",
            AppType::OpenClaw => "OPENCLAW",
            AppType::ClaudeDesktop => "ANTHROPIC",
        }
    }

    /// 所有应用类型
    pub fn all() -> &'static [AppType] {
        &[
            AppType::Claude,
            AppType::Codex,
            AppType::Gemini,
            AppType::OpenCode,
            AppType::OpenClaw,
            AppType::ClaudeDesktop,
        ]
    }
}

impl fmt::Display for AppType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

impl FromStr for AppType {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "claude" => Ok(AppType::Claude),
            "codex" => Ok(AppType::Codex),
            "gemini" => Ok(AppType::Gemini),
            "opencode" => Ok(AppType::OpenCode),
            "openclaw" => Ok(AppType::OpenClaw),
            "claudedesktop" => Ok(AppType::ClaudeDesktop),
            _ => Err(format!("Unknown app type: {}", s)),
        }
    }
}
