<div align="center">
  <img src="src-tauri/icons/icon.png" alt="CCG Switch Logo" width="120" />

  # CCG Switch

  **Claude Code · Codex · Gemini · OpenCode · Claude Desktop 统一配置管理与增强工具**

  [![Website](https://img.shields.io/badge/🌐-Website-orange?logo=github-pages)](https://cus45.github.io/ccg-switch/)
  [![Release](https://img.shields.io/github/v/release/cus45/ccg-switch?logo=github)](https://github.com/cus45/ccg-switch/releases)
  [![Tauri App](https://img.shields.io/badge/Tauri-v2-active?logo=tauri&color=FFC131)](#)
  [![React](https://img.shields.io/badge/React-19-blue?logo=react)](#)
  [![Rust](https://img.shields.io/badge/Rust-Backend-orange?logo=rust)](#)
  [![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)

  [English](#english) | [简体中文](#简体中文)

</div>

---

<span id="简体中文"></span>
## 📝 简介

**CCG Switch** 是一个跨平台桌面应用，用图形界面统一管理主流 AI 编程工具的配置：服务商与 API Key 切换、本地代理与故障转移、MCP 服务器、Prompt 预设、技能与子代理，并提供用量统计和内置对话界面。

支持的应用：

| 应用 | 服务商切换 | MCP | Prompt | 技能 | 使用统计 |
|------|:---:|:---:|:---:|:---:|:---:|
| Claude Code | ✅ | ✅ | ✅ | ✅ | ✅ |
| Codex | ✅ | ✅ | ✅ | ✅ | ✅ |
| Gemini CLI | ✅ | ✅ | ✅ | ✅ | ✅ |
| OpenCode | ✅ | ✅ | ✅ | ✅ | ✅ |
| Claude Desktop（Chat / Code 模式） | ✅ | — | — | — | — |

再也不用手动改 `settings.json`、`config.toml`、`.env` 和环境变量。

## ✨ 功能

- 🔀 **服务商切换**：一键切换 Anthropic 官方、第三方中转等服务商，自动写入各应用的配置文件；支持连通性测试、获取模型列表、配置预览（切换前查看完整 diff）、拖拽排序和标签。
- 🖥️ **Claude Desktop 第三方网关**：把服务商写入 Claude Desktop 的第三方（3P）配置库，让 Desktop 的 Chat / Code 模式使用自定义网关；首次接管前自动备份，可一键恢复原配置。
- 🧩 **OpenCode 支持**：服务商以累加方式写入 `~/.config/opencode/opencode.json`，不覆盖你自己的 `model` / `theme` 等设置。
- 🔌 **本地代理与故障转移**：内置 Rust 本地代理，可一键接管 Claude / Codex / Gemini 的请求；支持故障转移队列、流式增量转发和请求记账。
- 📊 **使用统计**：汇总请求数、费用、Token、缓存命中率，趋势图与请求日志 / 服务商 / 模型三张明细表；没走代理的用量也能从 Claude、Codex 会话文件和 OpenCode 本地数据库自动采集。支持自定义模型定价。
- 💬 **对话**：内置 Claude Code / Codex 对话界面，支持多会话标签、侧边分屏、文件浏览与改动审查、权限审批。
- 🧰 **MCP 服务器**：图形化增删改 MCP 服务器，按应用分别开关并同步到各自配置，可从现有配置导入。
- 📝 **Prompt 预设**：管理并切换 `CLAUDE.md` / `AGENTS.md` / `GEMINI.md` 等全局指令文件。
- 🎯 **技能与子代理**：安装、扫描导入技能（支持 GitHub 仓库），按应用开关同步；管理自定义子代理。
- 🛠️ **工具安装与升级**：在「设置 → 关于」检测 Claude Code / Codex / Gemini CLI / OpenCode 的版本，一键安装或升级并实时查看输出。
- 💾 **备份与同步**：配置导入 / 导出、本地备份、WebDAV 备份。
- 🎨 **界面**：亮色 / 暗色主题、中英文、系统托盘、开机自启、深链接导入。

## 📦 安装与下载

前往 [GitHub Releases](https://github.com/cus45/ccg-switch/releases) 下载适合你系统的安装包：

- **Windows**：`.exe`（NSIS 安装向导）或 `.msi`
- **macOS**：`.dmg`（支持 Apple Silicon 与 Intel）
- **Linux**：`.deb` 或 `.AppImage`

## 🛠️ 技术栈

- **前端**：[React 19](https://react.dev/)、TypeScript、[Vite](https://vitejs.dev/)、[Tailwind CSS](https://tailwindcss.com/) + DaisyUI、Zustand、TanStack Query、i18next、Recharts
- **后端**：[Rust](https://www.rust-lang.org/)、[Tauri v2](https://v2.tauri.app/)、SQLite（rusqlite）、reqwest

## 💻 开发者指南

### 环境依赖

- [Node.js](https://nodejs.org/) v20+
- [Rust 工具链](https://www.rust-lang.org/tools/install)

### 本地运行

```bash
git clone https://github.com/cus45/ccg-switch.git
cd ccg-switch
npm install

# 开发模式（Vite 热重载 + Tauri 后端）
npm run tauri dev
```

> 修改 Rust 代码后需要重启 `npm run tauri dev`，前端改动会自动热更新。

### 测试与构建

```bash
npm test                                          # 前端单元测试（Vitest）
cargo test --manifest-path src-tauri/Cargo.toml   # 后端单元测试
npm run tauri build                               # 生产构建，产物在 src-tauri/target/release/bundle/
```

### 发布版本

```bash
# 预演：不改文件、不提交、不推送
npm run release:dry -- 1.8.1 patch "修复描述"

# 正式发布：更新版本号与 Changelog → 运行测试与构建 → 提交 → 打 tag → 推送，触发 GitHub Actions 打包
npm run release -- 1.8.1 patch "修复描述"
```

详见 [scripts/README.md](scripts/README.md)。

## 📄 许可证

本项目采用 [MIT License](LICENSE) 开源。

---

<span id="english"></span>
## 📝 Summary (English)

**CCG Switch** is a cross-platform desktop app that manages the configuration of AI coding tools — **Claude Code, Codex, Gemini CLI, OpenCode and Claude Desktop** — from one GUI, so you never have to hand-edit dotfiles or environment variables again.

### Features

- **Provider switching**: Swap between official endpoints and third-party relays in one click; each app's config files are written for you, with connectivity tests, model discovery and a diff preview before switching.
- **Claude Desktop gateway**: Writes your provider into Claude Desktop's third-party (3P) config library so its Chat / Code modes use a custom gateway; the original setup is backed up and can be restored in one click.
- **OpenCode support**: Providers are added to `~/.config/opencode/opencode.json` without touching your own `model` / `theme` settings.
- **Local proxy & failover**: A built-in Rust proxy can take over Claude / Codex / Gemini traffic, with a failover queue, incremental streaming and request accounting.
- **Usage statistics**: Requests, cost, tokens and cache hit rate with trends and detail tables. Usage that bypasses the proxy is collected from Claude / Codex session files and OpenCode's local database.
- **Chat**: Built-in Claude Code / Codex chat UI with session tabs, side-by-side chats, file browsing, change review and permission approval.
- **MCP, Prompts, Skills & Sub-agents**: Manage MCP servers, global instruction files, skills and sub-agents per app.
- **Tool install & upgrade**: Detect, install or upgrade Claude Code / Codex / Gemini CLI / OpenCode from *Settings → About* with live output.
- **Backup & sync**: Import / export, local backups and WebDAV.

[Download the latest release](https://github.com/cus45/ccg-switch/releases).

---

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=cus45/ccg-switch&type=Date)](https://star-history.com/#cus45/ccg-switch&Date)
