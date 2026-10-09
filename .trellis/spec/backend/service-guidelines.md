# 服务层规范

## 概述

服务层（`services/`）承载核心业务逻辑，是三层架构中最厚的一层。命令层委托给服务层，服务层调用数据库 DAO、外部 API 和文件系统。

---

## 命名约定

| 项目 | 规范 | 示例 |
|------|------|------|
| 文件名 | `<domain>_service.rs` | `provider_service.rs` |
| 函数名 | `snake_case`，语义化动词开头 | `list_providers_from_db`, `add_provider_to_db` |
| 模块声明 | 在 `services/mod.rs` 中 `pub mod` | `pub mod provider_service;` |

---

## 服务函数签名模式

### 依赖数据库的服务函数

通过 `&Arc<Database>` 传入数据库引用（不持有所有权）：

**实际代码** (`src-tauri/src/services/provider_service.rs:53-73`):
```rust
use crate::database::Database;
use crate::models::app_type::AppType;
use crate::models::provider::Provider;
use std::sync::Arc;

/// 列出指定应用的 providers（从数据库读取）
pub fn list_providers_from_db(db: &Arc<Database>, app: AppType) -> Result<Vec<Provider>, String> {
    let all = db.list_providers()?;
    Ok(all.into_iter().filter(|p| p.app_type == app).collect())
}

/// 列出所有应用的 providers（从数据库读取）
pub fn list_all_providers_from_db(db: &Arc<Database>) -> Result<Vec<Provider>, String> {
    db.list_providers()
}

/// 获取单个 provider（从数据库读取）
pub fn get_provider_from_db(db: &Arc<Database>, id: &str) -> Result<Provider, String> {
    db.get_provider(id)?
        .ok_or_else(|| format!("Provider {} not found", id))
}

/// 添加 provider（写入数据库）
pub fn add_provider_to_db(db: &Arc<Database>, provider: Provider) -> Result<(), String> {
    db.upsert_provider(&provider)
}
```

---

## 业务逻辑组织

### 模式：读取-修改-写回 + 副作用

服务层负责协调多个步骤，包括数据库操作和外部副作用（如同步配置文件）。

**实际代码** (`src-tauri/src/services/provider_service.rs:76-98`):
```rust
/// 更新 provider（更新数据库并同步 active provider 到应用配置）
pub fn update_provider_in_db(
    db: &Arc<Database>,
    id: &str,
    updated: Provider,
) -> Result<(), String> {
    // 1. 先获取原有记录，保留 is_active 和 created_at
    let existing = db
        .get_provider(id)?
        .ok_or_else(|| format!("Provider {} not found", id))?;

    // 2. 合并字段（保留不可变字段）
    let mut provider = updated;
    provider.is_active = existing.is_active;
    provider.created_at = existing.created_at;

    // 3. 写回数据库
    db.upsert_provider(&provider)?;

    // 4. 副作用：如果是 active provider，立即同步到应用配置
    if provider.is_active {
        sync_provider_to_app_config(&provider).map_err(|e| e.to_string())?;
    }

    Ok(())
}
```

> **Convention**: 更新操作要保留服务端管理的字段（`is_active`, `created_at`），不让前端覆盖。

---

## 路径处理约定

### 私有路径辅助函数

服务内部的路径获取封装为私有函数，使用 `dirs::home_dir()`：

**实际代码** (`src-tauri/src/services/provider_service.rs:12-22`):
```rust
fn get_data_dir() -> Result<PathBuf, io::Error> {
    let home = dirs::home_dir()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Home directory not found"))?;
    Ok(home.join(".ccg-switch"))
}

fn get_claude_settings_path() -> Result<PathBuf, io::Error> {
    let home = dirs::home_dir()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Home directory not found"))?;
    Ok(home.join(".claude").join("settings.json"))
}
```

**规则**:
- 不硬编码路径分隔符，用 `PathBuf::join`
- 用 `dirs::home_dir()` 获取家目录
- 路径常量（如配置文件名）用 `const` 表配置

**配置表模式** (`src-tauri/src/services/provider_service.rs:32-41`):
```rust
const CLAUDE_FILES: &[(&str, &str)] = &[(".claude/settings.json", "{}")];
const CODEX_FILES: &[(&str, &str)] = &[(".codex/auth.json", "{}"), (".codex/config.toml", "")];
const GEMINI_FILES: &[(&str, &str)] = &[(".gemini/.env", "")];

let file_configs = match app {
    AppType::Claude => CLAUDE_FILES,
    AppType::Codex => CODEX_FILES,
    AppType::Gemini => GEMINI_FILES,
    _ => &[],
};
```

---

## 文件写入：原子写

### 必须使用原子写入

修改用户配置文件时，使用 `storage::atomic_io` 避免写入中断导致文件损坏。

**实际代码** (`src-tauri/src/services/storage/atomic_io.rs:7-23`):
```rust
/// 原子写入 JSON 数据到文件（先写 .tmp 再 rename）
pub fn atomic_write_json<T: Serialize>(path: &Path, data: &T) -> io::Result<()> {
    let content = serde_json::to_string_pretty(data)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    atomic_write_bytes(path, content.as_bytes())
}

/// 原子写入字节数据到文件
pub fn atomic_write_bytes(path: &Path, data: &[u8]) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;  // 确保父目录存在
    }
    let tmp_path = path.with_extension("tmp");
    fs::write(&tmp_path, data)?;       // 1. 写临时文件
    fs::rename(&tmp_path, path)?;      // 2. 原子重命名
    Ok(())
}
```

> **Gotcha**: 直接 `fs::write` 到目标文件，若进程崩溃会留下半写文件。原子写入通过"写临时文件 + rename"保证要么完整写入要么不变。

---

## 错误返回约定

### service 层的两种返回风格

| 风格 | 使用场景 |
|------|---------|
| `Result<T, String>` | 直接被命令层调用的服务函数（与命令返回类型一致） |
| `Result<T, AppError>` | 内部辅助函数、需要结构化错误的场景，命令层用 `.map_err(\|e\| e.to_string())` 转换 |
| `Result<T, io::Error>` | 纯文件操作辅助函数 |

**示例对照**:
```rust
// 直接给命令用 → String
pub fn list_all_providers_from_db(db: &Arc<Database>) -> Result<Vec<Provider>, String> {
    db.list_providers()
}

// 内部 IO 辅助 → io::Error，命令层转换
pub fn get_provider_config_files(app: AppType) -> Result<Vec<(String, String)>, io::Error> {
    // ...
}
// 命令层：provider_service::get_provider_config_files(app_type).map_err(|e| e.to_string())
```

---

## 模型转换

### From trait 用于模型转换

跨模型转换实现 `From`，便于复用：

**实际代码** (`src-tauri/src/models/provider.rs:74-99`):
```rust
impl From<ApiToken> for Provider {
    fn from(token: ApiToken) -> Self {
        Provider {
            id: token.id,
            name: token.name,
            app_type: AppType::Claude,  // 默认值
            api_key: token.api_key,
            // ... 字段映射
            in_failover_queue: false,
            proxy_config: None,
        }
    }
}
```

---

## 常见错误

### ❌ 错误：service 直接写 SQL
```rust
pub fn list_providers_from_db(db: &Arc<Database>) -> Result<Vec<Provider>, String> {
    let conn = db.conn.lock().unwrap();  // ❌ SQL 应在 dao 层
    let mut stmt = conn.prepare("SELECT * FROM providers").unwrap();
    // ...
}
```

### ✅ 正确：service 调用 dao 方法
```rust
pub fn list_providers_from_db(db: &Arc<Database>, app: AppType) -> Result<Vec<Provider>, String> {
    let all = db.list_providers()?;  // ✅ dao 方法
    Ok(all.into_iter().filter(|p| p.app_type == app).collect())
}
```

---

### ❌ 错误：直接 fs::write 配置文件
```rust
pub fn save_config(config: &Config) -> io::Result<()> {
    let content = serde_json::to_string(config)?;
    std::fs::write(&path, content)  // ❌ 非原子，崩溃会损坏文件
}
```

### ✅ 正确：原子写入
```rust
pub fn save_config(config: &Config) -> io::Result<()> {
    atomic_write_json(&path, config)  // ✅ 原子写入
}
```

---

### ❌ 错误：更新时让前端覆盖服务端字段
```rust
pub fn update_provider_in_db(db: &Arc<Database>, id: &str, updated: Provider) -> Result<(), String> {
    db.upsert_provider(&updated)  // ❌ is_active / created_at 被前端值覆盖
}
```

### ✅ 正确：保留服务端管理字段
```rust
pub fn update_provider_in_db(db: &Arc<Database>, id: &str, updated: Provider) -> Result<(), String> {
    let existing = db.get_provider(id)?.ok_or_else(|| format!("Provider {} not found", id))?;
    let mut provider = updated;
    provider.is_active = existing.is_active;      // ✅ 保留
    provider.created_at = existing.created_at;    // ✅ 保留
    db.upsert_provider(&provider)
}
```

---

## 参考

- 服务实现: `src-tauri/src/services/provider_service.rs`
- 原子写入: `src-tauri/src/services/storage/atomic_io.rs`
- 数据库 DAO 规范: [database-guidelines.md](./database-guidelines.md)
- 错误处理: [error-handling.md](./error-handling.md)
- 数据路径: `CLAUDE.md` 第 86-95 行

## OpenCode config (additive mode)

`services/opencode_config.rs` owns `~/.config/opencode/opencode.json` (same path on Windows).
Like cc-switch, every OpenCode provider is written to `provider.<providerId>` on add/update/switch and
removed on delete; top-level `model` / `small_model` / `theme` belong to the user and are never touched. MCP sync
(`mcp/opencode.rs`) writes only `mcp.<id>`. Every other key is preserved (read → modify → atomic
write). A file that fails to parse (e.g. JSONC with comments) is an error — never overwrite it.
OpenCode is not a proxy-takeover app (`TAKEOVER_APPS` / frontend `PROXY_APP_TYPES` exclude it).
Health checks pick the wire protocol from `meta.npm` (`check_protocol` in `stream_check_service.rs`).

## Claude Desktop 3P config

`services/claude_desktop_config.rs` (approach mirrors upstream cc-switch v4) makes Claude Desktop's
Chat/Code modes use a custom gateway by writing Desktop's 3P **config library**: our fixed entry
`configLibrary/00000000-0000-4000-8000-00000000cc65.json` (`inferenceProvider=gateway`, base URL, key,
`inferenceModels`), registered in `_meta.json` with `appliedId` pointing at it, and
`deploymentMode="3p"` in both `Claude/` and `Claude-3p/claude_desktop_config.json`.
- Model names must be `claude-(sonnet|opus|haiku|fable)-*` or Desktop rejects the whole list.
- First takeover backs up the previous `appliedId` / deployment modes to
  `~/.ccg-switch/claude_desktop_backup.json`; restore puts them back (users may already run 3P with
  their own entry — never force `1p` when a backup exists). Never modify the user's own entries.
- Windows: probe MSIX `%LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming`, then `%APPDATA%`, then
  `%LOCALAPPDATA%` for `Claude-3p`. Changes apply after Desktop restarts.
- Only direct mode is implemented; upstream's proxy (model-mapping) mode is not.
