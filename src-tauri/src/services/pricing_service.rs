use crate::database::dao::usage_logs::ModelPricingRow;
use crate::database::Database;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 从 models.dev 返回的供应商数据模型
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct ModelsDevProvider {
    pub id: Option<String>,
    pub name: Option<String>,
    #[serde(default)]
    pub models: HashMap<String, ModelsDevModel>,
}

/// 从 models.dev 返回的模型数据模型
#[derive(Debug, Deserialize)]
pub struct ModelsDevModel {
    pub id: Option<String>,
    pub name: Option<String>,
    pub cost: Option<ModelsDevCost>,
}

/// 模型计费 (USD per 1M tokens)
#[derive(Debug, Deserialize)]
pub struct ModelsDevCost {
    pub input: Option<f64>,
    pub output: Option<f64>,
    pub cache_read: Option<f64>,
    pub cache_write: Option<f64>,
}

/// 导入定价结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPricingResult {
    pub total_fetched: usize,
    pub imported: usize,
    pub updated: usize,
    pub skipped: usize,
}

/// 格式化价格，保留有效小数并去除多余尾随 0
fn format_cost(cost: f64) -> String {
    if cost <= 0.0 {
        return "0".to_string();
    }
    let s = format!("{:.6}", cost);
    let s = s.trim_end_matches('0').trim_end_matches('.');
    if s.is_empty() {
        "0".to_string()
    } else {
        s.to_string()
    }
}

/// 官方主流供应商（具有官方权威定价，优先覆盖第三方/聚合商的价格）
const OFFICIAL_PROVIDERS: &[&str] = &[
    "anthropic", "openai", "google", "deepseek", "mistral",
    "meta", "qwen", "moonshot", "zhipuai", "minimax", "xai", "cohere",
];

/// 从 models.dev 获取公开模型定价并导入数据库
pub async fn fetch_and_import_models_dev_pricing(
    db: &Database,
    overwrite_existing: bool,
    custom_url: Option<String>,
) -> Result<ImportPricingResult, String> {
    let url = custom_url.as_deref().unwrap_or("https://models.dev/api.json?type=all");

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let resp = client
        .get(url)
        .header("User-Agent", "CCG-Switch/1.8.0")
        .send()
        .await
        .map_err(|e| format!("Failed to request models.dev: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("models.dev returned HTTP status: {}", resp.status()));
    }

    let provider_map = resp
        .json::<HashMap<String, ModelsDevProvider>>()
        .await
        .map_err(|e| format!("Failed to parse models.dev JSON: {e}"))?;

    let models_map = parse_models_dev_payload(provider_map);

    let total_fetched = models_map.len();
    if total_fetched == 0 {
        return Ok(ImportPricingResult {
            total_fetched: 0,
            imported: 0,
            updated: 0,
            skipped: 0,
        });
    }

    let items: Vec<(String, String, ModelPricingRow)> = models_map
        .into_iter()
        .map(|(id, (name, row))| (id, name, row))
        .collect();

    let (imported, updated, skipped) = db.batch_upsert_model_pricing(&items, overwrite_existing)?;

    Ok(ImportPricingResult {
        total_fetched,
        imported,
        updated,
        skipped,
    })
}

/// 解析 models.dev 数据，并按优先级进行官方覆盖
pub fn parse_models_dev_payload(
    provider_map: HashMap<String, ModelsDevProvider>,
) -> HashMap<String, (String, ModelPricingRow)> {
    let mut models_map: HashMap<String, (String, ModelPricingRow)> = HashMap::new();

    let mut non_official = Vec::new();
    let mut official = Vec::new();

    for (p_id, p) in provider_map {
        let is_off = OFFICIAL_PROVIDERS.iter().any(|&o| o.eq_ignore_ascii_case(&p_id));
        if is_off {
            official.push(p);
        } else {
            non_official.push(p);
        }
    }

    let process_provider = |p: ModelsDevProvider, map: &mut HashMap<String, (String, ModelPricingRow)>| {
        for (m_key, m) in p.models {
            let cost = match m.cost {
                Some(c) if c.input.is_some() || c.output.is_some() => c,
                _ => continue,
            };

            let model_id = m.id.unwrap_or(m_key);
            let display_name = m.name.unwrap_or_else(|| model_id.clone());

            let row = ModelPricingRow {
                input_cost_per_million: format_cost(cost.input.unwrap_or(0.0)),
                output_cost_per_million: format_cost(cost.output.unwrap_or(0.0)),
                cache_read_cost_per_million: format_cost(cost.cache_read.unwrap_or(0.0)),
                cache_creation_cost_per_million: format_cost(cost.cache_write.unwrap_or(0.0)),
            };

            map.insert(model_id, (display_name, row));
        }
    };

    for p in non_official {
        process_provider(p, &mut models_map);
    }
    for p in official {
        process_provider(p, &mut models_map);
    }

    models_map
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_cost() {
        assert_eq!(format_cost(0.0), "0");
        assert_eq!(format_cost(3.0), "3");
        assert_eq!(format_cost(0.15), "0.15");
        assert_eq!(format_cost(0.000001), "0.000001");
        assert_eq!(format_cost(0.000123), "0.000123");
    }

    #[test]
    fn test_parse_models_dev_payload_official_overrides() {
        let mut mock_providers = HashMap::new();

        // Non-official aggregator provides claude-3-5-sonnet with higher price
        let mut agg_models = HashMap::new();
        agg_models.insert(
            "claude-3-5-sonnet".to_string(),
            ModelsDevModel {
                id: Some("claude-3-5-sonnet".to_string()),
                name: Some("Claude 3.5 Sonnet Aggregator".to_string()),
                cost: Some(ModelsDevCost {
                    input: Some(4.0),
                    output: Some(20.0),
                    cache_read: None,
                    cache_write: None,
                }),
            },
        );
        mock_providers.insert(
            "aggregator".to_string(),
            ModelsDevProvider {
                id: Some("aggregator".to_string()),
                name: Some("Aggregator".to_string()),
                models: agg_models,
            },
        );

        // Official anthropic provides claude-3-5-sonnet with standard price
        let mut anthropic_models = HashMap::new();
        anthropic_models.insert(
            "claude-3-5-sonnet-20241022".to_string(),
            ModelsDevModel {
                id: Some("claude-3-5-sonnet".to_string()),
                name: Some("Claude 3.5 Sonnet".to_string()),
                cost: Some(ModelsDevCost {
                    input: Some(3.0),
                    output: Some(15.0),
                    cache_read: Some(0.3),
                    cache_write: Some(3.75),
                }),
            },
        );
        mock_providers.insert(
            "anthropic".to_string(),
            ModelsDevProvider {
                id: Some("anthropic".to_string()),
                name: Some("Anthropic".to_string()),
                models: anthropic_models,
            },
        );

        let parsed = parse_models_dev_payload(mock_providers);
        assert_eq!(parsed.len(), 1);
        let (display_name, row) = parsed.get("claude-3-5-sonnet").unwrap();
        assert_eq!(display_name, "Claude 3.5 Sonnet");
        assert_eq!(row.input_cost_per_million, "3");
        assert_eq!(row.output_cost_per_million, "15");
        assert_eq!(row.cache_read_cost_per_million, "0.3");
        assert_eq!(row.cache_creation_cost_per_million, "3.75");
    }
}

