# Design — Claude Desktop Code 模式 API 配置（对齐 cc-switch v4）

用户决定（2026-10-09）："全部参考 cc-switch 项目的实现思路，对齐 cc-switch"。
参考：上游 `farion1231/cc-switch` origin/main `src-tauri/src/claude_desktop_config.rs`（本地 demo 仓库的工作区是旧版，没有该文件，已 `git fetch` 后阅读）。

## 上游思路（摘要）

- Claude Desktop 是**独立应用类型**（`AppType::ClaudeDesktop`），有自己的供应商列表。
- 切换到第三方供应商 = 写 Desktop 的 3P 配置库：
  - `Claude/claude_desktop_config.json` 与 `Claude-3p/claude_desktop_config.json`：`deploymentMode = "3p"`
  - `Claude-3p/configLibrary/<固定 PROFILE_ID>.json`：
    `inferenceProvider="gateway"`、`inferenceGatewayBaseUrl`、`inferenceGatewayApiKey`、`inferenceGatewayAuthScheme="bearer"`、
    可选 `inferenceModels`；策略键 `disableDeploymentModeChooser=true`、`coworkEgressAllowedHosts=["*"]` 仅在缺失时写入
  - `Claude-3p/configLibrary/_meta.json`：`entries` 中登记 `{id: PROFILE_ID, name}`，`appliedId = PROFILE_ID`
- 切回官方：`deploymentMode = "1p"`，从 `_meta.entries` 摘掉自己的条目，`appliedId` 指向剩下的第一个条目，profile 只清关键字段（保留用户在 Desktop 里改的设置）。
- 直连模式的模型名必须是 `claude-(sonnet|opus|haiku|fable)-*`，否则 Desktop 会整组拒收。
- 上游还有"代理模式"（经本地路由服务做模型映射，需要 gateway token 与 `/claude-desktop` 路由）。

## 本项目实现（MVP）

| 项 | 做法 | 与上游差异 |
|---|---|---|
| 应用类型 | 新增 `AppType::ClaudeDesktop`（`claudedesktop`），前端 `VISIBLE_APP_TYPES` 可见，不在 `PROXY_APP_TYPES` | 同 |
| 模式 | 只做**直连模式** | 代理模式（模型映射）不做，后续单独任务 |
| 模型 | 表单 Sonnet / Opus / Haiku 三栏，非空时必须是 claude-safe 名，写入 `inferenceModels` | 上游另有 fable 档与 1M 标记 |
| PROFILE_ID | 自有固定 ID `00000000-0000-4000-8000-00000000cc65`，名称 `CCG Switch` | 不复用上游 ID，避免与同机 cc-switch 抢同一条目 |
| 切回 | "恢复原配置"按钮：**还原首次接管前**的 `deploymentMode` 与 `appliedId`（备份在 `~/.ccg-switch/claude_desktop_backup.json`），无备份时退回上游行为 | 比上游更保守：本机用户本来就在 3P 模式用自己的条目，不能被强制切到 1p |
| Windows 路径 | 依次探测 MSIX `%LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\`、`%APPDATA%\`、`%LOCALAPPDATA%\` 下的 `Claude-3p` | 上游只看 `%LOCALAPPDATA%`；本机是 MSIX 安装，实际路径在 Packages 下 |
| macOS / Linux | `~/Library/Application Support/Claude(-3p)`；`$XDG_CONFIG_HOME` 或 `~/.config/Claude(-3p)` | 同（不处理 Flatpak 特例） |
| 写入安全 | 任一文件 JSON 解析失败 → 整体报错不写；单文件原子写（tmp + rename） | 上游有跨文件写前意图日志，本项目不做 |

## 接口

- 后端 `services/claude_desktop_config.rs`：`apply_provider`、`restore`、`get_status`、`is_claude_safe_model_id`。
- `provider_service::sync_provider_to_app_config` 增加 `ClaudeDesktop` 分支；删除当前激活的 Desktop 供应商时执行 `restore`。
- 命令：`get_claude_desktop_status`、`restore_claude_desktop`（同时把 DB 中 Desktop 供应商全部置为非激活）。
- 前端：`ClaudeDesktopPanel`（供应商页筛选到 Claude Desktop 时显示）：配置目录、是否已接管、当前网关地址、"需重启 Desktop 生效"提示、"恢复原配置"按钮。

## 验证

- 单测：三类路径解析、apply 写出的 4 个文件内容、保留用户条目与用户自定义键、restore 还原备份、claude-safe 校验、非法 JSON 不写。
- 手动：本机 MSIX Desktop 切换后重启，Code 模式发消息走新网关；点"恢复原配置"后回到用户原 `Default` 条目。
