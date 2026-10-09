# 扩展 OpenCode 与 Claude Desktop(Code) 配置方式（父任务）

## 背景

参考 `C:\guodevelop\demo\cc-switch`（commit 47435bd6），在 ccg-switch 中补齐两类应用的配置切换能力：

1. **OpenCode**：后端已有 `AppType::OpenCode`，前端 `VISIBLE_APP_TYPES` 将其标为"已废弃"并隐藏。需恢复为一等公民。
2. **Claude Desktop 的 Code 模式**：让 Claude Desktop 内置的 Claude Code 也能使用本应用切换的第三方供应商（Base URL / Key / 模型）。参考项目**没有**该能力，需要先调研。

## 子任务

| 子任务 | 内容 | 确定性 |
|---|---|---|
| `10-09-opencode-provider-mcp` | OpenCode 供应商切换 + MCP 同步（全量，对齐 cc-switch `opencode_config.rs`） | 高，有参考实现 |
| `10-09-claude-desktop-code-config` | Claude Desktop Code 模式 API 配置 | 低，需先调研配置入口 |

## 已确认决策（2026-10-09）

- Claude Desktop 范围 = "Desktop 内 Code 模式的 API 配置"，**不**管理 `claude_desktop_config.json` 的 MCP。
- OpenCode 范围 = 供应商 + MCP 全量。

## 父任务验收

- 两个子任务各自验收通过。
- 两个子任务不得破坏 Claude/Codex/Gemini 现有切换、代理接管、MCP 同步行为。
