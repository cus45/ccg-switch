#![allow(dead_code)]
use crate::database::{lock_conn, Database};
use crate::models::app_type::AppType;
use crate::models::provider::Provider;
use chrono::Utc;
use indexmap::IndexMap;
use rusqlite::OptionalExtension;
use std::str::FromStr;

impl Database {
    /// 获取所有 Provider
    pub fn list_providers(&self) -> Result<Vec<Provider>, String> {
        let conn = lock_conn!(self.conn);
        let mut stmt = conn
            .prepare("SELECT id, name, app_type, api_key, url, default_sonnet_model, default_opus_model, default_haiku_model, default_reasoning_model, custom_params, settings_config, meta, icon, in_failover_queue, description, tags, is_active, created_at, last_used, proxy_config FROM providers ORDER BY sort_order ASC, name ASC")
            .map_err(|e| format!("Failed to prepare query: {e}"))?;

        let rows = stmt
            .query_map([], |row| {
                let custom_params_str: Option<String> = row.get(9)?;
                let settings_config_str: Option<String> = row.get(10)?;
                let meta_str: Option<String> = row.get(11)?;
                let tags_str: Option<String> = row.get(15)?;
                let proxy_config_str: Option<String> = row.get(19)?;

                Ok(Provider {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    app_type: AppType::from_str(&row.get::<_, String>(2)?)
                        .unwrap_or(AppType::Claude),
                    api_key: row.get(3)?,
                    url: row.get(4)?,
                    default_sonnet_model: row.get(5)?,
                    default_opus_model: row.get(6)?,
                    default_haiku_model: row.get(7)?,
                    default_reasoning_model: row.get(8)?,
                    custom_params: custom_params_str.and_then(|s| serde_json::from_str(&s).ok()),
                    settings_config: settings_config_str
                        .and_then(|s| serde_json::from_str(&s).ok()),
                    meta: meta_str.and_then(|s| serde_json::from_str(&s).ok()),
                    icon: row.get(12)?,
                    in_failover_queue: row.get(13)?,
                    description: row.get(14)?,
                    tags: tags_str
                        .and_then(|s| serde_json::from_str(&s).ok())
                        .unwrap_or_default(),
                    is_active: row.get(16)?,
                    created_at: chrono::DateTime::<Utc>::from_timestamp(row.get::<_, i64>(17)?, 0)
                        .unwrap_or_default(),
                    last_used: chrono::DateTime::<Utc>::from_timestamp(row.get::<_, i64>(18)?, 0)
                        .or_else(|| chrono::DateTime::<Utc>::from_timestamp(0, 0)),
                    proxy_config: proxy_config_str.and_then(|s| serde_json::from_str(&s).ok()),
                })
            })
            .map_err(|e| format!("Failed to query providers: {e}"))?;

        let mut providers = Vec::new();
        for row in rows {
            providers.push(row.map_err(|e| format!("Failed to read row: {e}"))?);
        }
        Ok(providers)
    }

    /// 获取单个 Provider
    pub fn get_provider(&self, id: &str) -> Result<Option<Provider>, String> {
        let conn = lock_conn!(self.conn);
        let provider = conn
            .query_row(
                "SELECT id, name, app_type, api_key, url, default_sonnet_model, default_opus_model, default_haiku_model, default_reasoning_model, custom_params, settings_config, meta, icon, in_failover_queue, description, tags, is_active, created_at, last_used, proxy_config FROM providers WHERE id = ?1",
                rusqlite::params![id],
                |row| {
                    let custom_params_str: Option<String> = row.get(9)?;
                    let settings_config_str: Option<String> = row.get(10)?;
                    let meta_str: Option<String> = row.get(11)?;
                    let tags_str: Option<String> = row.get(15)?;
                    let proxy_config_str: Option<String> = row.get(19)?;

                    Ok(Provider {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        app_type: AppType::from_str(&row.get::<_, String>(2)?).unwrap_or(AppType::Claude),
                        api_key: row.get(3)?,
                        url: row.get(4)?,
                        default_sonnet_model: row.get(5)?,
                        default_opus_model: row.get(6)?,
                        default_haiku_model: row.get(7)?,
                        default_reasoning_model: row.get(8)?,
                        custom_params: custom_params_str.and_then(|s| serde_json::from_str(&s).ok()),
                        settings_config: settings_config_str.and_then(|s| serde_json::from_str(&s).ok()),
                        meta: meta_str.and_then(|s| serde_json::from_str(&s).ok()),
                        icon: row.get(12)?,
                        in_failover_queue: row.get(13)?,
                        description: row.get(14)?,
                        tags: tags_str.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default(),
                        is_active: row.get(16)?,
                        created_at: chrono::DateTime::<Utc>::from_timestamp(row.get::<_, i64>(17)?, 0).unwrap_or_default(),
                        last_used: chrono::DateTime::<Utc>::from_timestamp(row.get::<_, i64>(18)?, 0).or_else(|| chrono::DateTime::<Utc>::from_timestamp(0, 0)),
                        proxy_config: proxy_config_str.and_then(|s| serde_json::from_str(&s).ok()),
                    })
                },
            )
            .optional()
            .map_err(|e| format!("Failed to get provider: {e}"))?;
        Ok(provider)
    }

    /// 保存 Provider（INSERT OR REPLACE）
    pub fn upsert_provider(&self, provider: &Provider) -> Result<(), String> {
        let conn = lock_conn!(self.conn);
        let custom_params_str = provider
            .custom_params
            .as_ref()
            .and_then(|v| serde_json::to_string(v).ok());
        let settings_config_str = provider
            .settings_config
            .as_ref()
            .and_then(|v| serde_json::to_string(v).ok());
        let meta_str = provider
            .meta
            .as_ref()
            .and_then(|v| serde_json::to_string(v).ok());
        let tags_str = serde_json::to_string(&provider.tags).ok();
        let proxy_config_str = provider
            .proxy_config
            .as_ref()
            .and_then(|v| serde_json::to_string(v).ok());

        // 新增行排到队尾（MAX(sort_order)+1）；更新已有行时不触碰 sort_order，保持用户拖拽顺序
        conn.execute(
            "INSERT INTO providers (id, name, app_type, api_key, url, default_sonnet_model, default_opus_model, default_haiku_model, default_reasoning_model, custom_params, settings_config, meta, icon, in_failover_queue, description, tags, is_active, created_at, last_used, proxy_config, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM providers))
             ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                app_type = excluded.app_type,
                api_key = excluded.api_key,
                url = excluded.url,
                default_sonnet_model = excluded.default_sonnet_model,
                default_opus_model = excluded.default_opus_model,
                default_haiku_model = excluded.default_haiku_model,
                default_reasoning_model = excluded.default_reasoning_model,
                custom_params = excluded.custom_params,
                settings_config = excluded.settings_config,
                meta = excluded.meta,
                icon = excluded.icon,
                in_failover_queue = excluded.in_failover_queue,
                description = excluded.description,
                tags = excluded.tags,
                is_active = excluded.is_active,
                created_at = excluded.created_at,
                last_used = excluded.last_used,
                proxy_config = excluded.proxy_config",
            rusqlite::params![
                provider.id,
                provider.name,
                provider.app_type.as_str(),
                provider.api_key,
                provider.url,
                provider.default_sonnet_model,
                provider.default_opus_model,
                provider.default_haiku_model,
                provider.default_reasoning_model,
                custom_params_str,
                settings_config_str,
                meta_str,
                provider.icon,
                provider.in_failover_queue,
                provider.description,
                tags_str,
                provider.is_active,
                provider.created_at.timestamp(),
                provider.last_used.map(|dt| dt.timestamp()).unwrap_or(0),
                proxy_config_str,
            ],
        )
        .map_err(|e| format!("Failed to upsert provider: {e}"))?;
        Ok(())
    }

    /// 按给定 id 顺序重写 sort_order（0..n），用于拖拽排序持久化
    pub fn update_provider_sort_orders(&self, ordered_ids: &[String]) -> Result<(), String> {
        let mut conn = lock_conn!(self.conn);
        let tx = conn
            .transaction()
            .map_err(|e| format!("Failed to begin transaction: {e}"))?;
        for (index, id) in ordered_ids.iter().enumerate() {
            tx.execute(
                "UPDATE providers SET sort_order = ?1 WHERE id = ?2",
                rusqlite::params![index as i64, id],
            )
            .map_err(|e| format!("Failed to update sort order: {e}"))?;
        }
        tx.commit()
            .map_err(|e| format!("Failed to commit sort order: {e}"))?;
        Ok(())
    }

    /// 删除 Provider
    pub fn delete_provider(&self, id: &str) -> Result<bool, String> {
        let conn = lock_conn!(self.conn);
        let affected = conn
            .execute("DELETE FROM providers WHERE id = ?1", rusqlite::params![id])
            .map_err(|e| format!("Failed to delete provider: {e}"))?;
        Ok(affected > 0)
    }

    /// 设置 Provider 激活状态（保留兼容）
    #[allow(dead_code)]
    pub fn set_active_provider(&self, id: &str, is_active: bool) -> Result<(), String> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "UPDATE providers SET is_active = ?1 WHERE id = ?2",
            rusqlite::params![is_active, id],
        )
        .map_err(|e| format!("Failed to set provider active: {e}"))?;
        Ok(())
    }

    /// 设置 Provider 最后使用时间（保留兼容）
    #[allow(dead_code)]
    pub fn set_provider_last_used(&self, id: &str, last_used: i64) -> Result<(), String> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "UPDATE providers SET last_used = ?1 WHERE id = ?2",
            rusqlite::params![last_used, id],
        )
        .map_err(|e| format!("Failed to set provider last_used: {e}"))?;
        Ok(())
    }

    /// 获取指定应用类型的所有 Provider
    pub fn list_providers_by_app(&self, app_type: &str) -> Result<Vec<Provider>, String> {
        let conn = lock_conn!(self.conn);
        let mut stmt = conn
            .prepare("SELECT id, name, app_type, api_key, url, default_sonnet_model, default_opus_model, default_haiku_model, default_reasoning_model, custom_params, settings_config, meta, icon, in_failover_queue, description, tags, is_active, created_at, last_used, proxy_config FROM providers WHERE app_type = ?1 ORDER BY sort_order ASC, name ASC")
            .map_err(|e| format!("Failed to prepare query: {e}"))?;

        let rows = stmt
            .query_map(rusqlite::params![app_type], |row| {
                let custom_params_str: Option<String> = row.get(9)?;
                let settings_config_str: Option<String> = row.get(10)?;
                let meta_str: Option<String> = row.get(11)?;
                let tags_str: Option<String> = row.get(15)?;
                let proxy_config_str: Option<String> = row.get(19)?;

                Ok(Provider {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    app_type: AppType::from_str(&row.get::<_, String>(2)?)
                        .unwrap_or(AppType::Claude),
                    api_key: row.get(3)?,
                    url: row.get(4)?,
                    default_sonnet_model: row.get(5)?,
                    default_opus_model: row.get(6)?,
                    default_haiku_model: row.get(7)?,
                    default_reasoning_model: row.get(8)?,
                    custom_params: custom_params_str.and_then(|s| serde_json::from_str(&s).ok()),
                    settings_config: settings_config_str
                        .and_then(|s| serde_json::from_str(&s).ok()),
                    meta: meta_str.and_then(|s| serde_json::from_str(&s).ok()),
                    icon: row.get(12)?,
                    in_failover_queue: row.get(13)?,
                    description: row.get(14)?,
                    tags: tags_str
                        .and_then(|s| serde_json::from_str(&s).ok())
                        .unwrap_or_default(),
                    is_active: row.get(16)?,
                    created_at: chrono::DateTime::<Utc>::from_timestamp(row.get::<_, i64>(17)?, 0)
                        .unwrap_or_default(),
                    last_used: chrono::DateTime::<Utc>::from_timestamp(row.get::<_, i64>(18)?, 0)
                        .or_else(|| chrono::DateTime::<Utc>::from_timestamp(0, 0)),
                    proxy_config: proxy_config_str.and_then(|s| serde_json::from_str(&s).ok()),
                })
            })
            .map_err(|e| format!("Failed to query providers by app: {e}"))?;

        let mut providers = Vec::new();
        for row in rows {
            providers.push(row.map_err(|e| format!("Failed to read row: {e}"))?);
        }
        Ok(providers)
    }

    /// 获取指定应用类型的单个 Provider
    pub fn get_provider_by_app(
        &self,
        id: &str,
        app_type: &str,
    ) -> Result<Option<Provider>, String> {
        let conn = lock_conn!(self.conn);
        let provider = conn
            .query_row(
                "SELECT id, name, app_type, api_key, url, default_sonnet_model, default_opus_model, default_haiku_model, default_reasoning_model, custom_params, settings_config, meta, icon, in_failover_queue, description, tags, is_active, created_at, last_used, proxy_config FROM providers WHERE id = ?1 AND app_type = ?2",
                rusqlite::params![id, app_type],
                |row| {
                    let custom_params_str: Option<String> = row.get(9)?;
                    let settings_config_str: Option<String> = row.get(10)?;
                    let meta_str: Option<String> = row.get(11)?;
                    let tags_str: Option<String> = row.get(15)?;
                    let proxy_config_str: Option<String> = row.get(19)?;

                    Ok(Provider {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        app_type: AppType::from_str(&row.get::<_, String>(2)?).unwrap_or(AppType::Claude),
                        api_key: row.get(3)?,
                        url: row.get(4)?,
                        default_sonnet_model: row.get(5)?,
                        default_opus_model: row.get(6)?,
                        default_haiku_model: row.get(7)?,
                        default_reasoning_model: row.get(8)?,
                        custom_params: custom_params_str.and_then(|s| serde_json::from_str(&s).ok()),
                        settings_config: settings_config_str.and_then(|s| serde_json::from_str(&s).ok()),
                        meta: meta_str.and_then(|s| serde_json::from_str(&s).ok()),
                        icon: row.get(12)?,
                        in_failover_queue: row.get(13)?,
                        description: row.get(14)?,
                        tags: tags_str.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default(),
                        is_active: row.get(16)?,
                        created_at: chrono::DateTime::<Utc>::from_timestamp(row.get::<_, i64>(17)?, 0).unwrap_or_default(),
                        last_used: chrono::DateTime::<Utc>::from_timestamp(row.get::<_, i64>(18)?, 0).or_else(|| chrono::DateTime::<Utc>::from_timestamp(0, 0)),
                        proxy_config: proxy_config_str.and_then(|s| serde_json::from_str(&s).ok()),
                    })
                },
            )
            .optional()
            .map_err(|e| format!("Failed to get provider by app: {e}"))?;
        Ok(provider)
    }

    /// 获取指定应用类型的当前激活 Provider ID
    pub fn get_current_provider_id(&self, app_type: &str) -> Result<Option<String>, String> {
        let conn = lock_conn!(self.conn);
        let id: Option<String> = conn
            .query_row(
                "SELECT id FROM providers WHERE app_type = ?1 AND is_active = 1 LIMIT 1",
                rusqlite::params![app_type],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| format!("Failed to get current provider id: {e}"))?;
        Ok(id)
    }

    /// 设置指定应用类型的当前激活 Provider
    ///
    /// 先将同 app_type 的所有 Provider 设为非激活，再将目标 Provider 设为激活
    pub fn set_current_provider_by_app(&self, app_type: &str, id: &str) -> Result<(), String> {
        let conn = lock_conn!(self.conn);
        // 先将同 app_type 的所有 Provider 设为非激活
        conn.execute(
            "UPDATE providers SET is_active = 0 WHERE app_type = ?1",
            rusqlite::params![app_type],
        )
        .map_err(|e| format!("Failed to deactivate providers: {e}"))?;

        // 再将目标 Provider 设为激活
        conn.execute(
            "UPDATE providers SET is_active = 1 WHERE id = ?1 AND app_type = ?2",
            rusqlite::params![id, app_type],
        )
        .map_err(|e| format!("Failed to activate provider: {e}"))?;
        Ok(())
    }

    /// 获取指定应用类型的所有 Provider，以 IndexMap 返回（按 id 索引）
    pub fn get_all_providers_map(
        &self,
        app_type: &str,
    ) -> Result<IndexMap<String, Provider>, String> {
        let providers = self.list_providers_by_app(app_type)?;
        let mut map = IndexMap::new();
        for provider in providers {
            map.insert(provider.id.clone(), provider);
        }
        Ok(map)
    }
}
