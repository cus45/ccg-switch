<div align="center">
  <img src="public/logo.png" alt="CCG Switch Logo" width="120" />

  # CCG Switch

  **Claude · Codex · Gemini 统一配置管理与增强工具**

  [![Website](https://img.shields.io/badge/🌐-Website-orange?logo=github-pages)](https://cus45.github.io/ccg-switch/)
  [![Tauri App](https://img.shields.io/badge/Tauri-v2-active?logo=tauri&color=FFC131)](#)
  [![React](https://img.shields.io/badge/React-19-blue?logo=react)](#)
  [![Rust](https://img.shields.io/badge/Rust-Backend-orange?logo=rust)](#)
  [![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)

  [English](#english) | [简体中文](#简体中文)

</div>

---

<span id="简体中文"></span>
## 📝 简介 (Introduction)

**CCG Switch** 是一个强大的跨平台桌面级配置管理工具。它最初设计为 `Claude Code` 的辅助管理器，现已扩展支持管理 Claude、Codex、Gemini 等主流大模型 CLI 工具的环境配置、服务商切换、系统级本地代理与 Prompt 预设。

无论你是独立开发者还是多项目维护者，CCG Switch 都能让你无缝切换 API 密钥环境，彻底告别频繁手动修改终端环境变量的痛苦。

## ✨ 核心特性 

- 🚀 **零配置切换**: 一键在多个服务商（如 Anthropic 官方、Azure、第三方中转）之间切换 API Keys 和代理地址。
- 🔌 **系统级本地代理**: 内置 Rust 编写的轻量级本地代理转发服务器 (HTTP Proxy Server)，支持自动拦截、替换和测速 API 请求，专为国内受限网络环境设计。
- 🧩 **MCP 服务器集成**: 支持图形化添加并配置 MCP (Model Context Protocol) 插件，可视化管理上下文能力。
- 🔮 **Prompt 预设池**: 预置多种角色 Prompt，并支持工作区级别的快速分发与应用。
- 📊 **可视化数据面板**: 统一监控 Tokens 消耗、工具调用次数与接口响应延迟。
- 🎨 **极致的 UI/UX**: 全面响应式设计，支持系统跟随的暗黑模式，并可自由配置顶栏/侧栏导航布局。

## 📦 安装与下载

前往 [GitHub Releases](https://github.com/cus45/ccg-switch/releases) 页面下载适合你系统的安装包：

- **Windows**: 下载 `.exe` (NSIS安装向导) 或 `.msi`
- **macOS**: 下载 `.dmg` (支持 Apple Silicon & Intel)
- **Linux**: 下载 `.deb` 或 `.AppImage`

## 🛠️ 技术栈

本项目基于业内最前沿的跨平台技术栈构建：

* **Frontend**: [React 19](https://react.dev/), [Vite](https://vitejs.dev/), [Tailwind CSS](https://tailwindcss.com/)
* **Backend**: [Rust](https://www.rust-lang.org/), [Tauri v2](https://v2.tauri.app/) (高性能且包体积极小的桌面端框架)
* **Misc**: Zustand (状态管理), i18next (响应式国际化支持)

## 💻 开发者指南

### 环境依赖
- [Node.js](https://nodejs.org/) (v20+)
- [Rust Toolchain](https://www.rust-lang.org/tools/install)

### 本地运行

```bash
# 1. 克隆代码库
git clone https://github.com/cus45/ccg-switch.git

# 2. 进入项目目录
cd ccg-switch

# 3. 安装前端依赖
npm install

# 4. 启动开发环境 (包含 Vite 热重载 + Tauri 后端)
npm run tauri dev
```

### 构建生产包
```bash
npm run tauri build
```
*(构建输出位于 `src-tauri/target/release/bundle/` 目录下)*

## 📄 许可证 (License)

本项目采用 [MIT License](LICENSE) 协议开源。欢迎自由使用、修改与分发，甚至用于商业项目。

---

<span id="english"></span>
## 📝 Summary (English)

**CCG Switch** is a universal configuration manager for AI CLI tools like Claude Code, Codex, and Gemini. It provides a seamless cross-platform GUI to manage API keys, local proxies, Model Context Protocol (MCP) servers, and workspace configurations without ever touching dotfiles again.

### Features
- **One-click Provider Switching**: Quickly swap between official endpoints and custom proxies.
- **Built-in Rust HTTP Proxy**: Overcome network restrictions with a high-performance local forwarder.
- **MCP Server Management**: Add, configure, and monitor MCP capabilities via a clean UI.
- **Cross-Platform**: Near-native performance on Windows, macOS, and Linux thanks to Tauri v2.

[Download the latest release here](https://github.com/cus45/ccg-switch/releases).

---

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=qincasin/ccg-switch&type=Date)](https://star-history.com/#qincasin/ccg-switch&Date)
