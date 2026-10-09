# 修复审查发现的缺陷

来源：2026-10-09 项目审查。所有问题均已对照代码确认。

## 需求

1. **Prompt 启用不丢失手写内容**：`PromptServiceV2` 启用某个预设时，若当前没有已启用的预设而 live 文件（CLAUDE.md / AGENTS.md / GEMINI.md / OpenCode AGENTS.md）有内容、且与库内任何预设内容都不相同，先把它存为一条新预设「原有内容（自动备份 时间）」再覆盖。（对齐 cc-switch："启用前会先把文件里原有的内容存回提示词库"）
2. **通用供应商可用**：`universal_provider_service` 改为基于数据库（`add_provider_to_db` / `switch_provider_in_db`），不再调用空实现；供应商页增加「通用供应商」入口，挂载已有的 `UniversalProviderPanel`，应用成功后刷新列表。
3. **托盘显示当前供应商**：`tray.rs` 从 `AppState.db` 读取各应用激活的供应商（不再用空实现），只列可见应用。
4. **首次改写配置前备份**：切换供应商写入各应用 live 配置文件前，若该文件存在且尚未备份，复制到 `~/.ccg-switch/backups/live/<app>/<文件名>`（只备份一次，保留最原始的版本）。Claude Desktop 已有独立备份，不重复。
5. **图标统一**：`public/app-icon.png` 换成应用图标；favicon 改用该 PNG；删除不再引用的 `public/app-icon.svg`、`public/logo.png`。
6. **清理**：删除旧版空实现（`provider_service::list_providers` 等 8 个兼容函数）与无调用方的 `proxy/failover_switch.rs`。

## 验收

- [ ] Rust 单测：首次启用预设时原文件内容被存为新预设；内容与已有预设相同时不重复存。
- [ ] Rust 单测：通用供应商为每个目标应用写入一条 DB 记录；备份只在首次写入时生成且不被后续覆盖。
- [ ] 托盘菜单能显示各应用当前供应商名称。
- [ ] 供应商页能打开通用供应商面板并成功添加。
- [ ] `cargo test`、`npm test`、`npm run build` 通过；空实现函数已无引用并删除。
