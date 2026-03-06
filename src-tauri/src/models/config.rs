use serde::{Deserialize, Serialize};

fn default_sidebar_position() -> String {
    "left".to_string()
}

fn default_preferred_terminal() -> String {
    "powershell".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub theme: String,
    pub language: String,
    #[serde(default = "default_sidebar_position", rename = "sidebarPosition")]
    pub sidebar_position: String,
    #[serde(default = "default_preferred_terminal", rename = "preferredTerminal")]
    pub preferred_terminal: String,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            theme: "light".to_string(),
            language: "zh".to_string(),
            sidebar_position: "left".to_string(),
            preferred_terminal: "powershell".to_string(),
        }
    }
}
