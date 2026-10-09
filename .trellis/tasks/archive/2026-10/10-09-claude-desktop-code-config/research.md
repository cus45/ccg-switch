# Research — Claude Desktop Code 模式的 API 配置入口

调研日期：2026-10-09，本机 Windows 11，Claude Desktop（MSIX 安装，包名 `Claude_pzs8sxrjxfjjc`，内置 claude-code 2.1.111）

## 结论

Desktop 的 Code 模式 **不读** `~/.claude/settings.json` 的 env 来决定上游；它跟随 Desktop 的
**第三方（3P）部署模式**配置。入口如下：

| 文件（MSIX 安装，位于 `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\`） | 作用 |
|---|---|
| `Claude-3p\claude_desktop_config.json` → `deploymentMode: "3p"` | 启用 3P 配置档（独立于 `Claude\` 官方登录档） |
| `Claude-3p\configLibrary\_meta.json` → `{ appliedId, entries: [{id, name}] }` | 配置库索引与当前生效项 |
| `Claude-3p\configLibrary\<uuid>.json` → `{ inferenceProvider: "gateway", inferenceGatewayBaseUrl, inferenceGatewayApiKey }` | 一条网关配置 |

非 MSIX 安装推测为 `%APPDATA%\Claude-3p\`（macOS：`~/Library/Application Support/Claude-3p/`），**未实测**。

## 证据

- 本机 `configLibrary` 已有一条用户在 Desktop 界面建的 `Default` 条目：`inferenceProvider=gateway`，Base URL 为一个第三方中转（Key 已脱敏，未读取）。
- `Claude-3p\logs\main.log`：
  - `[custom-3p] Credentials loaded from enterprise config { provider: 'gateway', mcpServerCount: 0 }`
  - `[custom-3p] 3P mode active { provider: 'gateway' }`
  - Code 会话启动时传递的环境变量列表中包含 `ANTHROPIC_BASE_URL`（Desktop 把网关注入给内置的 claude-code）。
- `Claude-3p\claude-code\2.1.111\`、`claude-code-sessions\` 存在：Code 模式运行在 3P 档内。

## 文档状态

- context7 中的 Claude 平台文档**没有**这组键的说明；日志把它称为 "enterprise config"，键名
  （`inferenceProvider` / `inferenceGatewayBaseUrl` / `inferenceGatewayApiKey`）看起来是企业托管配置的键。
  我**没有**找到对 `configLibrary` 文件格式本身的公开文档，它是 Desktop 内部存储格式，可能随版本变化。

## 方案选项（需用户决定）

A. **写入配置库（推荐，如接受风险）**：新增 / 更新一条名为 `ccg-switch` 的条目（固定 uuid 存在本应用配置里），
   切换 Claude 供应商时写入 Base URL + Key，并把 `_meta.appliedId` 指向它；关闭开关时把 `appliedId` 还原为原值。
   不改动用户自己的条目。需要重启 Desktop 生效。风险：内部格式变化会导致写入无效（不会破坏 Desktop，最坏是配置不生效）。
B. **只做提示**：在供应商页展示当前供应商的 Base URL / Key，并提示用户到 Desktop「设置 → 配置库」手动粘贴。零风险、无自动化。
C. **终止任务**。

## 实测待办（选 A 后）

1. 写入条目 → 重启 Desktop → Code 模式发一条消息 → 在 ccg-switch 代理日志 / 中转后台确认请求到达。
2. 关闭开关 → `appliedId` 还原 → 重启后回到用户原条目。
