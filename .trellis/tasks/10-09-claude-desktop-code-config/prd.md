# Claude Desktop Code 模式 API 配置

## 目标

让 Claude Desktop 应用中的 Claude Code（Code 模式/标签页）也能使用 ccg-switch 中当前激活的 Claude 供应商（Base URL、API Key、模型映射），切换供应商时一并生效。

## 已确认范围（2026-10-09）

- 只做 **Code 模式的 API 配置**；不管理 `claude_desktop_config.json` 中的 MCP 服务器。
- 参考项目 cc-switch **没有**此功能，没有可照搬的实现。

## 待调研问题（Phase 1.2，开始实现前必须有结论，写入 `research.md`）

1. Claude Desktop 的 Code 模式读取哪份配置？候选：
   - 共享 `~/.claude/settings.json` 的 `env`（如果是这样，现有切换已经生效，本任务退化为"验证 + 文档 + UI 提示"）；
   - Desktop 自己的配置 / 托管偏好（macOS `com.anthropic.claudefordesktop` plist、Windows 注册表或 `%APPDATA%\Claude\` 下的 JSON）中的第三方推理 / 网关设置；
   - 进程启动环境变量（需要从 ccg-switch 启动 Desktop 才能注入）。
2. Code 模式是否允许在已登录 Claude 账号的情况下改用 `ANTHROPIC_BASE_URL` + 自定义 key？是否有官方文档支持的入口？
3. 修改后是否需要重启 Desktop？能否检测 Desktop 是否在运行？
4. Windows / macOS 路径差异，Linux 是否支持。

调研方式：官方文档（context7 / 官网文档）+ 在本机安装的 Claude Desktop 上实测（改配置 → 在 Code 模式发一条消息 → 查看代理请求日志，确认是否打到了 ccg-switch 代理或目标 Base URL）。

## 需求（调研结论成立后）

1. 供应商页 Claude 标签下新增"同步到 Claude Desktop (Code)"开关（默认关闭），开启后切换 Claude 供应商时同时写入 Desktop 的配置入口。
2. 写入前备份原文件，只修改本应用负责的键，其余保持不变；关闭开关时还原 / 移除本应用写入的键。
3. 检测 Desktop 是否安装；未安装时开关置灰并提示。
4. 需要重启 Desktop 才生效时，给出提示（可选："重启 Claude Desktop"按钮）。
5. 与代理接管兼容：接管开启时写入的是本地代理地址。

## 验收标准

- [ ] `research.md` 给出配置入口结论，并附实测证据（日志 / 截图说明）。
- [ ] 若入口就是 `~/.claude/settings.json`：在关于或供应商页加说明，任务以"已验证无需改动"结束，不新增代码。
- [ ] 若需要独立入口：开关开启 → 切换供应商 → Desktop Code 模式请求走新供应商（实测）；关闭开关 → 配置还原。
- [ ] Windows 实测通过；macOS 路径逻辑有单测。
- [ ] i18n 文案中英齐全。

## 风险

- Desktop 的配置入口可能未公开 / 随版本变化 → 如果调研结论是"没有受支持的入口"，本任务应终止，并向用户说明，而不是写入未文档化的私有键。
