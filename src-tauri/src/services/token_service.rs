use crate::models::token::{ApiToken, TokensConfig};
use std::fs;
use std::io;
use std::path::PathBuf;
use chrono::Utc;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
struct OldConfigToken {
    name: String,
    token: String,
    url: Option<String>,
    model: Option<String>,
    #[serde(rename = "customParams")]
    custom_params: Option<std::collections::HashMap<String, serde_json::Value>>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ModelInfo {
    id: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct ModelsResponse {
    data: Vec<ModelInfo>,
}

fn get_tokens_path() -> Result<PathBuf, io::Error> {
    let home = dirs::home_dir()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Home directory not found"))?;
    Ok(home.join(".claude-switch").join("tokens.json"))
}

fn get_claude_settings_path() -> Result<PathBuf, io::Error> {
    let home = dirs::home_dir()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Home directory not found"))?;
    Ok(home.join(".claude").join("settings.json"))
}

fn save_tokens(tokens: &[ApiToken]) -> Result<(), io::Error> {
    let tokens_path = get_tokens_path()?;
    let config = TokensConfig {
        tokens: tokens.to_vec(),
    };
    let content = serde_json::to_string_pretty(&config)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    fs::write(&tokens_path, content)?;
    Ok(())
}

fn normalize_optional_value(value: Option<&str>) -> Option<String> {
    value
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
        .map(|v| v.trim_end_matches('/').to_ascii_lowercase())
}

pub fn list_tokens() -> Result<Vec<ApiToken>, io::Error> {
    let tokens_path = get_tokens_path()?;

    if !tokens_path.exists() {
        return Ok(vec![]);
    }

    let content = fs::read_to_string(&tokens_path)?;
    let config: TokensConfig = serde_json::from_str(&content)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;

    // 校验当前使用的配置
    let mut tokens = config.tokens;
    verify_active_token(&mut tokens)?;

    Ok(tokens)
}

// 校验当前激活的 token 是否与 settings.json 一致
fn verify_active_token(tokens: &mut Vec<ApiToken>) -> Result<(), io::Error> {
    let original_active_state: Vec<bool> = tokens.iter().map(|token| token.is_active).collect();
    let settings_path = get_claude_settings_path()?;
    let mut active_index: Option<usize> = None;

    if settings_path.exists() {
        let settings_content = fs::read_to_string(&settings_path)?;
        let settings: serde_json::Value = serde_json::from_str(&settings_content)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;

        let env = settings.get("env");
        let current_api_key = env
            .and_then(|env| env.get("ANTHROPIC_AUTH_TOKEN"))
            .and_then(|v| v.as_str())
            .map(|v| v.trim())
            .filter(|v| !v.is_empty());

        if let Some(current_api_key) = current_api_key {
            let current_base_url = normalize_optional_value(
                env.and_then(|env| env.get("ANTHROPIC_BASE_URL"))
                    .and_then(|v| v.as_str()),
            );
            let current_sonnet_model = normalize_optional_value(
                env.and_then(|env| env.get("ANTHROPIC_DEFAULT_SONNET_MODEL"))
                    .and_then(|v| v.as_str()),
            );
            let current_opus_model = normalize_optional_value(
                env.and_then(|env| env.get("ANTHROPIC_DEFAULT_OPUS_MODEL"))
                    .and_then(|v| v.as_str()),
            );
            let current_haiku_model = normalize_optional_value(
                env.and_then(|env| env.get("ANTHROPIC_DEFAULT_HAIKU_MODEL"))
                    .and_then(|v| v.as_str()),
            );

            let exact_matches: Vec<usize> = tokens
                .iter()
                .enumerate()
                .filter_map(|(index, token)| {
                    let is_match = token.api_key == current_api_key
                        && normalize_optional_value(token.url.as_deref()) == current_base_url
                        && normalize_optional_value(token.default_sonnet_model.as_deref())
                            == current_sonnet_model
                        && normalize_optional_value(token.default_opus_model.as_deref())
                            == current_opus_model
                        && normalize_optional_value(token.default_haiku_model.as_deref())
                            == current_haiku_model;

                    if is_match {
                        Some(index)
                    } else {
                        None
                    }
                })
                .collect();

            if exact_matches.len() == 1 {
                active_index = exact_matches.first().copied();
            } else if !exact_matches.is_empty() {
                // 出现重复配置时，强制只保留第一个为激活态
                active_index = exact_matches.first().copied();
            } else {
                let api_key_matches: Vec<usize> = tokens
                    .iter()
                    .enumerate()
                    .filter_map(|(index, token)| {
                        if token.api_key == current_api_key {
                            Some(index)
                        } else {
                            None
                        }
                    })
                    .collect();

                if api_key_matches.len() == 1 {
                    active_index = api_key_matches.first().copied();
                }
            }
        }
    }

    for (index, token) in tokens.iter_mut().enumerate() {
        token.is_active = active_index == Some(index);
    }

    let has_active_change = tokens
        .iter()
        .zip(original_active_state.iter())
        .any(|(token, old_state)| token.is_active != *old_state);

    if has_active_change {
        save_tokens(tokens)?;
    }

    Ok(())
}

pub fn add_token(token: ApiToken) -> Result<(), io::Error> {
    let tokens_path = get_tokens_path()?;

    // 确保目录存在
    if let Some(parent) = tokens_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let mut tokens = list_tokens().unwrap_or_default();
    tokens.push(token);

    save_tokens(&tokens)?;
    Ok(())
}

pub fn switch_token(token_id: &str) -> Result<(), io::Error> {
    let mut tokens = list_tokens()?;

    // 找到要激活的 token
    let token_to_activate = tokens.iter_mut()
        .find(|t| t.id == token_id)
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Token not found"))?;

    // 获取配置信息
    let api_key = token_to_activate.api_key.clone();
    let url = token_to_activate.url.clone();
    let sonnet_model = token_to_activate.default_sonnet_model.clone();
    let opus_model = token_to_activate.default_opus_model.clone();
    let haiku_model = token_to_activate.default_haiku_model.clone();
    let custom_params = token_to_activate.custom_params.clone();

    // 更新所有 token 的 active 状态
    for token in tokens.iter_mut() {
        token.is_active = token.id == token_id;
        if token.is_active {
            token.last_used = Some(Utc::now());
        }
    }

    // 保存 tokens.json
    save_tokens(&tokens)?;

    // 更新 Claude settings.json
    let settings_path = get_claude_settings_path()?;
    let settings_content = fs::read_to_string(&settings_path)?;
    let mut settings: serde_json::Value = serde_json::from_str(&settings_content)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;

    // 确保 env 对象存在
    if !settings.is_object() || settings.get("env").is_none() {
        settings["env"] = serde_json::json!({});
    }

    // 获取 env 对象的可变引用
    let env = settings["env"].as_object_mut()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "env is not an object"))?;

    // 更新 API Key
    env.insert("ANTHROPIC_AUTH_TOKEN".to_string(), serde_json::Value::String(api_key));

    // 更新或删除 URL
    if let Some(url_value) = url {
        env.insert("ANTHROPIC_BASE_URL".to_string(), serde_json::Value::String(url_value));
    } else {
        env.remove("ANTHROPIC_BASE_URL");
    }

    // 更新或删除默认模型
    if let Some(sonnet) = sonnet_model {
        env.insert("ANTHROPIC_DEFAULT_SONNET_MODEL".to_string(), serde_json::Value::String(sonnet));
    } else {
        env.remove("ANTHROPIC_DEFAULT_SONNET_MODEL");
    }

    if let Some(opus) = opus_model {
        env.insert("ANTHROPIC_DEFAULT_OPUS_MODEL".to_string(), serde_json::Value::String(opus));
    } else {
        env.remove("ANTHROPIC_DEFAULT_OPUS_MODEL");
    }

    if let Some(haiku) = haiku_model {
        env.insert("ANTHROPIC_DEFAULT_HAIKU_MODEL".to_string(), serde_json::Value::String(haiku));
    } else {
        env.remove("ANTHROPIC_DEFAULT_HAIKU_MODEL");
    }

    // 合并自定义参数到 env
    if let Some(params) = custom_params {
        for (key, value) in params {
            env.insert(key, value);
        }
    }

    // 保持原有格式写入（保留缩进和顺序）
    let updated_content = serde_json::to_string_pretty(&settings)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    fs::write(&settings_path, updated_content)?;

    Ok(())
}

pub fn update_token(token_id: &str, updated_token: ApiToken) -> Result<(), io::Error> {
    let mut tokens = list_tokens()?;

    // 查找并更新 token
    let token = tokens.iter_mut()
        .find(|t| t.id == token_id)
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Token not found"))?;

    // 保留原有的 id、isActive、createdAt
    token.name = updated_token.name;
    token.api_key = updated_token.api_key;
    token.url = updated_token.url;
    token.default_sonnet_model = updated_token.default_sonnet_model;
    token.default_opus_model = updated_token.default_opus_model;
    token.default_haiku_model = updated_token.default_haiku_model;
    token.custom_params = updated_token.custom_params;
    token.description = updated_token.description;
    // last_used 不更新

    // 保存更新后的列表
    save_tokens(&tokens)?;

    Ok(())
}

pub fn delete_token(token_id: &str) -> Result<(), io::Error> {
    let mut tokens = list_tokens()?;

    tokens.retain(|t| t.id != token_id);

    save_tokens(&tokens)?;
    Ok(())
}

pub fn move_token(token_id: &str, target_index: usize) -> Result<(), io::Error> {
    let mut tokens = list_tokens()?;
    let current_index = tokens
        .iter()
        .position(|token| token.id == token_id)
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Token not found"))?;

    if current_index == target_index {
        return Ok(());
    }

    let token = tokens.remove(current_index);
    let insert_index = target_index.min(tokens.len());
    tokens.insert(insert_index, token);

    save_tokens(&tokens)?;
    Ok(())
}

pub async fn fetch_models(base_url: String, api_key: String) -> Result<Vec<String>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let url = if base_url.ends_with('/') {
        format!("{}v1/models", base_url)
    } else {
        format!("{}/v1/models", base_url)
    };

    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!("API returned status: {}", response.status()));
    }

    let models_response: ModelsResponse = response
        .json()
        .await
        .map_err(|e| e.to_string())?;

    Ok(models_response.data.into_iter().map(|m| m.id).collect())
}
