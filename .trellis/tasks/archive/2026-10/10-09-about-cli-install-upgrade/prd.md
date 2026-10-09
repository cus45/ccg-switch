# 关于页 CLI 工具一键安装/升级

## 目标

在设置 → 关于的"本地环境检查"卡片（`src/components/settings/about/ToolStatusGrid.tsx`）上，为 Claude Code / Codex / Gemini CLI / OpenCode 提供一键**安装**（未安装时）与**升级**（有新版本时），不再只让用户复制命令去终端执行。

## 参考与现状

- cc-switch `AboutSection.tsx` 只有版本检测 + 复制安装命令；本需求是在其基础上增强。
- 现有：`tool_version_service.rs` 已能检测本地版本与远程最新版本（`ToolVersion { version, latestVersion }`），并通过 `tool-versions-updated` 事件推送；`InstallCommandPanel.tsx` 展示可复制的命令。
- 应用自身更新（`updater_service.rs` + `UpdateBanner`）已存在，**不在本任务范围内**。

## 需求

1. 每个工具卡片按状态显示按钮：
   - 未安装 → "安装"
   - 已安装且 `latestVersion` 更新 → "升级到 x.y.z"
   - 已是最新 → 不显示按钮（保留绿色对勾）
2. 安装/升级命令（每个平台一套，集中定义在后端）：
   - Claude Code：优先官方原生安装器（macOS/Linux：`curl -fsSL https://claude.ai/install.sh | bash`；Windows：`irm https://claude.ai/install.ps1 | iex`）；如果检测到是 npm 全局安装，则升级用 `npm i -g @anthropic-ai/claude-code@latest`。
   - Codex：`npm i -g @openai/codex@latest`
   - Gemini CLI：`npm i -g @google/gemini-cli@latest`
   - OpenCode：macOS/Linux `curl -fsSL https://opencode.ai/install | bash`；Windows `npm i -g opencode-ai@latest`。
3. 依赖前置检查：需要 npm 的命令在 npm 不存在时，提示先安装 Node.js（链接到官网），不执行。
4. 执行过程：
   - 后台执行，按行通过事件推送输出，卡片下方展开日志区域（可折叠，最多保留最近 N 行）；
   - 同一时刻同一工具只允许一个任务；可取消（kill 子进程）；
   - Windows 使用 `CREATE_NO_WINDOW`，不弹出控制台；
   - 完成后强制刷新该工具版本（`get_tool_versions(force)`）并显示成功/失败 toast；失败时保留日志和退出码。
5. 安全：命令只能从后端白名单中按 `(tool, action, platform)` 选取，前端只传工具名和动作，不能传任意命令字符串。
6. 安装执行前弹出确认框，展示即将执行的完整命令。
7. `InstallCommandPanel` 保留作为手动备用（文案改为"手动安装命令"）。
8. i18n 中英齐全。

## 验收标准

- [ ] 未安装工具显示"安装"，有新版本的显示"升级到 x"，最新的不显示按钮。
- [ ] 点击 → 确认框展示命令 → 执行 → 日志实时滚动 → 结束后版本刷新。
- [ ] 无 npm 时 npm 类命令被拦截并给出指引。
- [ ] 取消可终止进程，UI 回到空闲状态。
- [ ] Windows 实测：执行时不弹黑窗口；Codex 升级成功后版本号更新。
- [ ] 后端拒绝白名单外的 tool/action（单测）。
- [ ] `cargo test`、`npm run build` 通过。

## 非目标

- 应用自身的更新流程改造。
- WSL 环境的安装（cc-switch 有 WSL shell 选择器，本期不做）。
- 卸载功能。
