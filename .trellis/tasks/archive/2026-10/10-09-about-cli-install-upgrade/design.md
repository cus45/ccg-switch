# Design — 关于页 CLI 工具一键安装/升级

## 后端：新服务 `src-tauri/src/services/tool_installer_service.rs`

### 命令白名单

```rust
pub enum ToolAction { Install, Upgrade }
fn resolve_command(tool: &str, action: ToolAction, install_kind: InstallKind) -> Result<CommandSpec, String>
struct CommandSpec { program: String, args: Vec<String>, display: String, needs_npm: bool }
```

- `InstallKind` 由检测得出：`Native`（claude 原生安装器路径 `~/.local/bin/claude` / `%USERPROFILE%\.local\bin\claude.exe`）、`Npm`（`npm root -g` 下存在包）、`Unknown`。升级时 npm 安装 → npm 命令；原生 → 原生安装器（`claude update` 也可，优先 `claude update`）。
- Windows 下 shell 类命令用 `powershell -NoProfile -ExecutionPolicy Bypass -Command "<script>"`；Unix 用 `bash -lc "<script>"`（`-l` 保证能读取用户 PATH 中的 npm / nvm）。
- 白名单外的 tool → `Err`。前端不能传命令字符串。

### Tauri 命令（在 `lib.rs` 的 `generate_handler!` 中注册）

| 命令 | 说明 |
|---|---|
| `get_tool_install_plan(tool, action) -> CommandSpec` | 给确认框展示命令；同时做 npm 前置检查（`needs_npm && !has_npm` → Err("npm_missing")） |
| `run_tool_install(tool, action) -> ()` | spawn 子进程；同一 tool 已在运行时返回 Err |
| `cancel_tool_install(tool)` | kill 子进程（Windows 用 `taskkill /T /F /PID`，以连带结束子进程树） |

### 事件

- `tool-install-log`：`{ tool, line, stream: "stdout"|"stderr" }`，逐行推送（tokio `BufReader::lines`）。
- `tool-install-finished`：`{ tool, success, exitCode, cancelled }`。结束后调用 `tool_version_service::get_tool_versions(Some([tool]), true, app)` 刷新，并复用现有的 `tool-versions-updated` 事件。

### 状态

`static RUNNING: Lazy<Mutex<HashMap<String, Child>>>`，结束 / 取消时移除。

### 环境

- 继承用户环境；Windows 设置 `CREATE_NO_WINDOW`（参考 `tool_version_service.rs` 现有常量）。
- 注意本机 `HTTP_PROXY=127.0.0.1:7897`（见 memory proxy-panel-overhaul）：子进程正常继承即可，**不要**清除代理变量。

## 前端

- `useAboutStore` 增加 `installing: Record<tool, {action, logs: string[], status}>`，在 `initEventListeners` 中监听两个新事件；日志最多保留 500 行。
- `ToolStatusGrid` 卡片：状态按钮（安装 / 升级到 x / 运行中 spinner + 取消），卡片下方展开 `ToolInstallLog`（等宽字体、自动滚动到底部、可折叠）。网格在日志展开时让该卡片 `col-span-full`，避免挤压。
- 确认：复用 `components/common/ModalDialog`，展示 `CommandSpec.display`。
- `npm_missing` 错误 → 提示并给出 nodejs.org 链接（`shell open`）。
- `InstallCommandPanel` 标题改为"手动安装命令"，补充 Windows 命令。

## 取舍

- 不做 WSL；不做卸载。
- 不复用 `chat/` daemon 执行通道，而是直接 `tokio::process::Command`，因为更简单，且与聊天生命周期解耦。

## 回滚

前端按钮是唯一入口；隐藏按钮即可回滚，后端命令保留无副作用。
