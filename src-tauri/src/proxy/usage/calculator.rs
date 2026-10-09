//! 请求成本计算
//!
//! 用 `rust_decimal` 做定点计算 —— 单价常带 3-4 位小数、成本要长期累加，
//! f64 在这种场景下会漂移。

use super::parser::TokenUsage;
use rust_decimal::Decimal;
use std::str::FromStr;

/// 成本明细（USD）。分项均为**不含倍率**的基础成本。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CostBreakdown {
    pub input_cost: Decimal,
    pub output_cost: Decimal,
    pub cache_read_cost: Decimal,
    pub cache_creation_cost: Decimal,
    /// 分项之和 × 倍率
    pub total_cost: Decimal,
}

/// 模型单价（USD per 1M tokens）
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelPricing {
    pub input_cost_per_million: Decimal,
    pub output_cost_per_million: Decimal,
    pub cache_read_cost_per_million: Decimal,
    pub cache_creation_cost_per_million: Decimal,
}

impl ModelPricing {
    /// 从 DB 里的 Decimal 字符串构造；任一字段非法即失败
    pub fn from_strings(
        input: &str,
        output: &str,
        cache_read: &str,
        cache_creation: &str,
    ) -> Result<Self, rust_decimal::Error> {
        Ok(Self {
            input_cost_per_million: Decimal::from_str(input)?,
            output_cost_per_million: Decimal::from_str(output)?,
            cache_read_cost_per_million: Decimal::from_str(cache_read)?,
            cache_creation_cost_per_million: Decimal::from_str(cache_creation)?,
        })
    }
}

pub struct CostCalculator;

impl CostCalculator {
    /// 计算成本
    ///
    /// 两条口径必须保持不变，否则账单会错：
    ///
    /// 1. **input 侧扣掉缓存命中**：`billable_input = input_tokens - cache_read_tokens`。
    ///    Anthropic 的 `input_tokens` 已包含缓存命中部分，不扣就是双重计费。
    /// 2. **倍率只作用于最终总价**：分项存基础成本，便于展示"原价 + 倍率"。
    pub fn calculate(
        usage: &TokenUsage,
        pricing: &ModelPricing,
        cost_multiplier: Decimal,
    ) -> CostBreakdown {
        Self::calculate_with_cache_semantics(usage, pricing, cost_multiplier, false)
    }

    /// 按 app_type 选择输入 token 语义后计算成本（与参考项目 cc-switch 新版一致）
    ///
    /// Claude / Anthropic 的 `input_tokens` 本来就是新鲜输入，不含缓存，不能再扣；
    /// Codex（OpenAI Responses）与 Gemini 的输入字段包含缓存读写，要先扣掉再按输入价计费。
    pub fn calculate_for_app(
        app_type: &str,
        usage: &TokenUsage,
        pricing: &ModelPricing,
        cost_multiplier: Decimal,
    ) -> CostBreakdown {
        Self::calculate_with_cache_semantics(
            usage,
            pricing,
            cost_multiplier,
            is_cache_inclusive_app(app_type),
        )
    }

    fn calculate_with_cache_semantics(
        usage: &TokenUsage,
        pricing: &ModelPricing,
        cost_multiplier: Decimal,
        input_includes_cache: bool,
    ) -> CostBreakdown {
        let million = Decimal::from(1_000_000u32);

        let billable_input = if input_includes_cache {
            usage
                .input_tokens
                .saturating_sub(usage.cache_read_tokens)
                .saturating_sub(usage.cache_creation_tokens)
        } else {
            usage.input_tokens
        };

        let input_cost = Decimal::from(billable_input) * pricing.input_cost_per_million / million;
        let output_cost =
            Decimal::from(usage.output_tokens) * pricing.output_cost_per_million / million;
        let cache_read_cost =
            Decimal::from(usage.cache_read_tokens) * pricing.cache_read_cost_per_million / million;
        let cache_creation_cost = Decimal::from(usage.cache_creation_tokens)
            * pricing.cache_creation_cost_per_million
            / million;

        let base_total = input_cost + output_cost + cache_read_cost + cache_creation_cost;

        CostBreakdown {
            input_cost,
            output_cost,
            cache_read_cost,
            cache_creation_cost,
            total_cost: base_total * cost_multiplier,
        }
    }

    /// 定价缺失时返回 `None`，调用方按 0 成本落库并告警 —— 不阻断请求
    pub fn try_calculate(
        usage: &TokenUsage,
        pricing: Option<&ModelPricing>,
        cost_multiplier: Decimal,
    ) -> Option<CostBreakdown> {
        pricing.map(|p| Self::calculate(usage, p, cost_multiplier))
    }

    /// `try_calculate` 的按应用语义版本
    pub fn try_calculate_for_app(
        app_type: &str,
        usage: &TokenUsage,
        pricing: Option<&ModelPricing>,
        cost_multiplier: Decimal,
    ) -> Option<CostBreakdown> {
        pricing.map(|p| Self::calculate_for_app(app_type, usage, p, cost_multiplier))
    }
}

/// 存储的 `input_tokens` 已包含缓存读写的应用
///
/// 计费（本文件）与统计（`dao/usage_logs.rs` 的新鲜输入归一 SQL）必须共用这一份，
/// 新增应用时只改这里。默认按 Claude 语义（不含缓存）处理更安全：
/// 漏加时表现为命中率偏低，比静默多扣输入更容易被发现。
pub const CACHE_INCLUSIVE_APP_TYPES: &[&str] = &["codex", "gemini"];

/// `app_type` 的存储 `input_tokens` 是否已包含缓存
pub fn is_cache_inclusive_app(app_type: &str) -> bool {
    CACHE_INCLUSIVE_APP_TYPES.contains(&app_type)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pricing() -> ModelPricing {
        // Claude Sonnet 4.5 档：3 / 15 / 0.30 / 3.75
        ModelPricing::from_strings("3.0", "15.0", "0.30", "3.75").unwrap()
    }

    fn usage(input: u32, output: u32, cache_read: u32, cache_creation: u32) -> TokenUsage {
        TokenUsage {
            input_tokens: input,
            output_tokens: output,
            cache_read_tokens: cache_read,
            cache_creation_tokens: cache_creation,
            model: None,
        }
    }

    fn dec(s: &str) -> Decimal {
        Decimal::from_str(s).unwrap()
    }

    #[test]
    fn claude_input_is_fresh_and_not_reduced_by_cache() {
        // Claude 的 input_tokens 本来就不含缓存：输入按原值计费，缓存另算
        let cost = CostCalculator::calculate_for_app(
            "claude",
            &usage(1000, 500, 200, 100),
            &pricing(),
            dec("1"),
        );

        // 1000 * 3.0 / 1M = 0.003 —— 不扣缓存
        assert_eq!(cost.input_cost, dec("0.003"));
        // 500 * 15.0 / 1M = 0.0075
        assert_eq!(cost.output_cost, dec("0.0075"));
        // 200 * 0.30 / 1M = 0.00006
        assert_eq!(cost.cache_read_cost, dec("0.00006"));
        // 100 * 3.75 / 1M = 0.000375
        assert_eq!(cost.cache_creation_cost, dec("0.000375"));
        assert_eq!(cost.total_cost, dec("0.010935"));
    }

    #[test]
    fn claude_typical_cache_heavy_request_keeps_fresh_input_cost() {
        // 典型 Claude Code 请求：新鲜输入极少、缓存命中极多。
        // 旧公式 input - cache_read 会饱和到 0，把这 10 个 token 的输入费吃掉
        let cost = CostCalculator::calculate_for_app(
            "claude",
            &usage(10, 0, 28_000, 0),
            &pricing(),
            dec("1"),
        );
        assert_eq!(cost.input_cost, dec("0.00003"));
    }

    #[test]
    fn codex_input_includes_cache_and_is_reduced() {
        // Codex / OpenAI 的 input_tokens 含缓存命中：扣掉后才是新鲜输入
        let cost = CostCalculator::calculate_for_app(
            "codex",
            &usage(1000, 0, 600, 0),
            &pricing(),
            dec("1"),
        );
        // (1000 - 600) * 3.0 / 1M = 0.0012
        assert_eq!(cost.input_cost, dec("0.0012"));
        assert_eq!(cost.cache_read_cost, dec("0.00018"));
    }

    #[test]
    fn cache_inclusive_full_hit_has_zero_input_cost() {
        // 全部命中缓存：input 侧应为 0，只按缓存读取价计费
        let cost = CostCalculator::calculate_for_app(
            "gemini",
            &usage(1000, 0, 1000, 0),
            &pricing(),
            dec("1"),
        );
        assert_eq!(cost.input_cost, Decimal::ZERO);
        assert_eq!(cost.cache_read_cost, dec("0.0003"));
        assert_eq!(cost.total_cost, dec("0.0003"));
    }

    #[test]
    fn cache_inclusive_cache_exceeding_input_saturates_to_zero() {
        // 异常上游数据不能让 billable_input 下溢
        let cost = CostCalculator::calculate_for_app(
            "codex",
            &usage(100, 0, 500, 0),
            &pricing(),
            dec("1"),
        );
        assert_eq!(cost.input_cost, Decimal::ZERO);
    }

    #[test]
    fn multiplier_applies_only_to_total() {
        let cost = CostCalculator::calculate(&usage(1000, 0, 0, 0), &pricing(), dec("1.5"));

        // 分项是基础价，不含倍率
        assert_eq!(cost.input_cost, dec("0.003"));
        // 总价 = 0.003 × 1.5
        assert_eq!(cost.total_cost, dec("0.0045"));
    }

    #[test]
    fn total_equals_sum_of_parts_times_multiplier() {
        let multiplier = dec("2.5");
        let cost = CostCalculator::calculate(&usage(1234, 567, 89, 12), &pricing(), multiplier);

        let sum = cost.input_cost + cost.output_cost + cost.cache_read_cost + cost.cache_creation_cost;
        assert_eq!(cost.total_cost, sum * multiplier);
    }

    #[test]
    fn zero_multiplier_yields_zero_total_but_keeps_parts() {
        let cost = CostCalculator::calculate(&usage(1000, 500, 0, 0), &pricing(), Decimal::ZERO);
        assert_eq!(cost.total_cost, Decimal::ZERO);
        assert!(cost.input_cost > Decimal::ZERO, "分项仍是基础价");
    }

    #[test]
    fn decimal_avoids_float_drift_on_small_values() {
        // 单 token 的小数位必须完整保留，不能被浮点吞掉
        let p = ModelPricing::from_strings("0.075", "0.30", "0.01875", "0.075").unwrap();
        let cost = CostCalculator::calculate(&usage(1, 1, 0, 1), &p, dec("1"));

        assert_eq!(cost.input_cost, dec("0.000000075"));
        assert_eq!(cost.output_cost, dec("0.0000003"));
        assert_eq!(cost.cache_creation_cost, dec("0.000000075"));
    }

    #[test]
    fn zero_usage_costs_nothing() {
        let cost = CostCalculator::calculate(&usage(0, 0, 0, 0), &pricing(), dec("1"));
        assert_eq!(cost.total_cost, Decimal::ZERO);
    }

    #[test]
    fn try_calculate_returns_none_without_pricing() {
        assert!(CostCalculator::try_calculate(&usage(1000, 500, 0, 0), None, dec("1")).is_none());
    }

    #[test]
    fn try_calculate_delegates_when_pricing_present() {
        let p = pricing();
        let cost = CostCalculator::try_calculate(&usage(1000, 0, 0, 0), Some(&p), dec("1")).unwrap();
        assert_eq!(cost.input_cost, dec("0.003"));
    }

    #[test]
    fn from_strings_rejects_malformed_price() {
        assert!(ModelPricing::from_strings("abc", "15", "0", "0").is_err());
    }
}
